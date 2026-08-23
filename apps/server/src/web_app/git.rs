use std::process::Stdio;

use tokio::{io::AsyncReadExt, process::Command};

use super::WebAppManager;

impl WebAppManager {
    pub(super) async fn run_git_progress(
        &self,
        command: &mut Command,
        start_percent: u8,
        end_percent: u8,
    ) -> Result<(), String> {
        command
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Unable to read Git progress".to_string())?;
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let count = stderr
                .read(&mut buffer)
                .await
                .map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            output.extend_from_slice(&buffer[..count]);
            let text = String::from_utf8_lossy(&output);
            if let Some(line) = text
                .rsplit(['\r', '\n'])
                .find(|line| line.contains("Receiving objects:"))
                && let Some((git_percent, downloaded_bytes)) = parse_git_progress(line)
            {
                let percent = start_percent
                    + ((end_percent - start_percent) as u16 * git_percent as u16 / 100) as u8;
                let total_bytes = (git_percent > 0)
                    .then_some(downloaded_bytes)
                    .flatten()
                    .map(|bytes| bytes.saturating_mul(100) / u64::from(git_percent));
                let mut progress = self
                    .progress
                    .write()
                    .expect("web app progress lock poisoned");
                progress.percent = percent;
                progress.downloaded_bytes = downloaded_bytes;
                progress.total_bytes = total_bytes;
            }
        }
        let status = child.wait().await.map_err(|error| error.to_string())?;
        if status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output);
        let message = command_error(&stderr);
        Err(if message.is_empty() {
            format!("Command failed with {status}")
        } else {
            message
        })
    }

    pub(super) async fn run_install_command(&self, command: &mut Command) -> Result<(), String> {
        command
            .kill_on_drop(true)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        let output = command.output().await.map_err(|error| error.to_string())?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = command_error(&stderr);
        Err(if message.is_empty() {
            format!("Command failed with {}", output.status)
        } else {
            message
        })
    }
}

fn command_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_git_progress(line: &str) -> Option<(u8, Option<u64>)> {
    let percent = line
        .split_whitespace()
        .find_map(|part| part.strip_suffix('%')?.parse().ok())?;
    let downloaded_bytes = line.split('|').next().and_then(|part| {
        let mut values = part.split_whitespace().rev();
        let unit = values.next()?;
        let amount = values.next()?;
        parse_git_size(&format!("{amount}{unit}"))
    });
    Some((percent, downloaded_bytes))
}

fn parse_git_size(value: &str) -> Option<u64> {
    let split = value.find(|character: char| !character.is_ascii_digit() && character != '.')?;
    let amount: f64 = value[..split].parse().ok()?;
    let multiplier = match value[split..].trim() {
        "bytes" | "B" => 1_f64,
        "KiB" => 1024_f64,
        "MiB" => 1024_f64 * 1024_f64,
        "GiB" => 1024_f64 * 1024_f64 * 1024_f64,
        _ => return None,
    };
    Some((amount * multiplier) as u64)
}

#[cfg(test)]
mod tests {
    use super::parse_git_progress;

    #[test]
    fn parses_git_download_progress() {
        assert_eq!(
            parse_git_progress("Receiving objects:  50% (100/200), 12.50 MiB | 2.00 MiB/s"),
            Some((50, Some(13_107_200)))
        );
    }
}
