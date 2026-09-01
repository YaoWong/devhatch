use super::{ProgressReporter, RepositoryProgress};
use crate::{Error, Result, Skillink};
use std::{
    env, fs,
    path::PathBuf,
    process::{Output, Stdio},
    sync::OnceLock,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::Semaphore,
};

const DEFAULT_GIT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const GIT_OUTPUT_LIMIT: usize = 512 * 1024;
const DEFAULT_GIT_CONCURRENCY: usize = 2;

impl Skillink {
    pub(super) async fn clone_repository(
        &self,
        url: &str,
        git_ref: Option<&str>,
        local: bool,
        progress: Option<ProgressReporter>,
    ) -> Result<(String, PathBuf)> {
        let timeout = git_timeout();
        let deadline = tokio::time::Instant::now() + timeout;
        let _permit = tokio::time::timeout(timeout, git_semaphore().acquire())
            .await
            .map_err(|_| Error::Git("git command timed out".into()))?
            .map_err(|_| Error::Git("git concurrency limiter closed".into()))?;
        let checkout = self.staging_path();
        let mut command = Command::new("git");
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", "")
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .args([
                "-c",
                "protocol.allow=never",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "filter.lfs.smudge=",
                "-c",
                "filter.lfs.required=false",
            ]);
        if local {
            command.args(["-c", "protocol.file.allow=always"]);
        } else {
            command
                .env("GIT_ALLOW_PROTOCOL", "http:https:ssh")
                .env(
                    "GIT_SSH_COMMAND",
                    "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes",
                )
                .args([
                    "-c",
                    "protocol.http.allow=always",
                    "-c",
                    "protocol.https.allow=always",
                    "-c",
                    "protocol.ssh.allow=always",
                ]);
        }
        command.args(["clone", "--no-tags", "--progress"]);
        if !local && git_shallow() {
            command.args(["--depth", "1"]);
        }
        if let Some(git_ref) = git_ref {
            command.args(["--branch", git_ref]);
        }
        command.arg("--").arg(url).arg(&checkout);
        if let Some(progress) = &progress {
            progress(RepositoryProgress {
                stage: "cloning",
                progress: 0,
                downloaded_bytes: None,
                total_bytes: None,
            });
        }
        let duration = remaining(deadline)?;
        let output = run_git_command_with_progress(&mut command, duration, progress).await;
        let output = match output {
            Ok(output) => output,
            Err(error) => {
                let _ = fs::remove_dir_all(&checkout);
                return Err(error);
            }
        };
        if !output.status.success() {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git(git_error(&output)));
        }
        let mut command = Command::new("git");
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .args(["-C"])
            .arg(&checkout)
            .args(["rev-parse", "HEAD"]);
        let duration = match remaining(deadline) {
            Ok(duration) => duration,
            Err(error) => {
                let _ = fs::remove_dir_all(&checkout);
                return Err(error);
            }
        };
        let output = match run_git_command(&mut command, duration).await {
            Ok(output) => output,
            Err(error) => {
                let _ = fs::remove_dir_all(&checkout);
                return Err(error);
            }
        };
        if !output.status.success() {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git(git_error(&output)));
        }
        let commit = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if !valid_commit(&commit) {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git("git returned an invalid commit hash".into()));
        }
        if let Err(error) = fs::remove_dir_all(checkout.join(".git")) {
            let _ = fs::remove_dir_all(&checkout);
            return Err(error.into());
        }
        Ok((commit, checkout))
    }
}

fn git_semaphore() -> &'static Semaphore {
    static SEMAPHORE: OnceLock<Semaphore> = OnceLock::new();
    SEMAPHORE.get_or_init(|| {
        let permits = env::var("SKILLINK_GIT_CONCURRENCY")
            .ok()
            .and_then(|value| value.parse().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_GIT_CONCURRENCY);
        Semaphore::new(permits)
    })
}

fn git_timeout() -> Duration {
    env::var("SKILLINK_GIT_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|seconds| *seconds > 0)
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_GIT_TIMEOUT)
}

fn git_shallow() -> bool {
    env::var("SKILLINK_GIT_SHALLOW").as_deref() == Ok("1")
}

fn remaining(deadline: tokio::time::Instant) -> Result<Duration> {
    deadline
        .checked_duration_since(tokio::time::Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or_else(|| Error::Git("git command timed out".into()))
}

async fn run_git_command(command: &mut Command, duration: Duration) -> Result<Output> {
    run_git_command_with_progress(command, duration, None).await
}

async fn run_git_command_with_progress(
    command: &mut Command,
    duration: Duration,
    progress: Option<ProgressReporter>,
) -> Result<Output> {
    command.env_remove("DEVHATCH_ADMIN_PASSWORD");
    command.env_remove("DEVHATCH_ADMIN_PASSWORD_FILE");
    #[cfg(unix)]
    command.process_group(0);
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let pid = child.id();
    let mut stdout = tokio::spawn(read_limited(child.stdout.take()));
    let mut stderr = tokio::spawn(read_git_stderr(child.stderr.take(), progress));
    let collection = async {
        let status = child.wait().await?;
        let (stdout, stderr) = tokio::join!(&mut stdout, &mut stderr);
        let stdout = stdout.map_err(|error| Error::Git(error.to_string()))??;
        let stderr = stderr.map_err(|error| Error::Git(error.to_string()))??;
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    };
    match tokio::time::timeout(duration, collection).await {
        Ok(output) => output,
        Err(_) => {
            terminate_process_group(pid, libc::SIGTERM);
            stdout.abort();
            stderr.abort();
            let cleanup = async {
                tokio::time::sleep(Duration::from_millis(250)).await;
                terminate_process_group(pid, libc::SIGKILL);
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = stdout.await;
                let _ = stderr.await;
            };
            let _ = tokio::time::timeout(Duration::from_secs(2), cleanup).await;
            Err(Error::Git("git command timed out".into()))
        }
    }
}

async fn read_git_stderr<R>(
    reader: Option<R>,
    progress: Option<ProgressReporter>,
) -> Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let Some(mut reader) = reader else {
        return Ok(Vec::new());
    };
    let mut output = Vec::new();
    let mut record = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        append_bounded(&mut output, &buffer[..count]);
        for &byte in &buffer[..count] {
            if matches!(byte, b'\r' | b'\n') {
                emit_progress(&record, progress.as_ref());
                record.clear();
            } else if record.len() < 4096 {
                record.push(byte);
            }
        }
    }
    emit_progress(&record, progress.as_ref());
    Ok(output)
}

fn emit_progress(record: &[u8], reporter: Option<&ProgressReporter>) {
    if let Some(reporter) = reporter
        && let Some(progress) = parse_git_progress(&String::from_utf8_lossy(record))
    {
        reporter(progress);
    }
}

fn parse_git_progress(record: &str) -> Option<RepositoryProgress> {
    let record = record.trim();
    let (label, stage, start, span) = [
        ("Counting objects:", "counting", 0_u8, 10_u8),
        ("Compressing objects:", "compressing", 10, 10),
        ("Receiving objects:", "receiving", 20, 45),
        ("Resolving deltas:", "resolving", 65, 10),
        ("Updating files:", "updating-files", 75, 5),
    ]
    .into_iter()
    .find(|(label, _, _, _)| record.contains(label))?;
    let phase = record.split_once(label)?.1;
    let percent = phase
        .split_whitespace()
        .find_map(|part| part.strip_suffix('%')?.parse::<u8>().ok())?
        .min(100);
    let downloaded_bytes = (stage == "receiving")
        .then(|| parse_downloaded_bytes(record))
        .flatten();
    let total_bytes = downloaded_bytes
        .filter(|_| percent > 0)
        .map(|bytes| bytes.saturating_mul(100) / u64::from(percent));
    Some(RepositoryProgress {
        stage,
        progress: start + (u16::from(span) * u16::from(percent) / 100) as u8,
        downloaded_bytes,
        total_bytes,
    })
}

fn parse_downloaded_bytes(record: &str) -> Option<u64> {
    let before_rate = record.split('|').next()?;
    let mut values = before_rate.split_whitespace().rev();
    let unit = values.next()?.trim_end_matches(',');
    let amount = values.next()?.trim_end_matches(',');
    parse_git_size(amount, unit)
}

fn parse_git_size(amount: &str, unit: &str) -> Option<u64> {
    let amount: f64 = amount.parse().ok()?;
    let multiplier = match unit {
        "bytes" | "B" => 1_f64,
        "KiB" => 1024_f64,
        "MiB" => 1024_f64 * 1024_f64,
        "GiB" => 1024_f64 * 1024_f64 * 1024_f64,
        _ => return None,
    };
    Some((amount * multiplier) as u64)
}

fn append_bounded(output: &mut Vec<u8>, bytes: &[u8]) {
    if bytes.len() >= GIT_OUTPUT_LIMIT {
        output.clear();
        output.extend_from_slice(&bytes[bytes.len() - GIT_OUTPUT_LIMIT..]);
        return;
    }
    let excess = output
        .len()
        .saturating_add(bytes.len())
        .saturating_sub(GIT_OUTPUT_LIMIT);
    if excess > 0 {
        output.drain(..excess);
    }
    output.extend_from_slice(bytes);
}

async fn read_limited<R>(reader: Option<R>) -> Result<Vec<u8>>
where
    R: AsyncRead + Unpin,
{
    let Some(mut reader) = reader else {
        return Ok(Vec::new());
    };
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        append_bounded(&mut output, &buffer[..count]);
    }
    Ok(output)
}

#[cfg(unix)]
fn terminate_process_group(pid: Option<u32>, signal: i32) {
    if let Some(pid) = pid.and_then(|pid| i32::try_from(pid).ok()) {
        unsafe {
            libc::kill(-pid, signal);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_: Option<u32>, _: i32) {}

fn git_error(output: &Output) -> String {
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if message.is_empty() {
        format!("git exited with {}", output.status)
    } else {
        message
    }
}

pub(super) fn valid_commit(commit: &str) -> bool {
    commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_git_progress_records() {
        assert_eq!(
            parse_git_progress("remote: Counting objects:  50% (10/20)"),
            Some(RepositoryProgress {
                stage: "counting",
                progress: 5,
                downloaded_bytes: None,
                total_bytes: None,
            })
        );
        assert_eq!(
            parse_git_progress("Receiving objects:  50% (100/200), 12.50 MiB | 2.00 MiB/s"),
            Some(RepositoryProgress {
                stage: "receiving",
                progress: 42,
                downloaded_bytes: Some(13_107_200),
                total_bytes: Some(26_214_400),
            })
        );
        assert_eq!(
            parse_git_progress("Resolving deltas: 100% (20/20), done."),
            Some(RepositoryProgress {
                stage: "resolving",
                progress: 75,
                downloaded_bytes: None,
                total_bytes: None,
            })
        );
        assert!(parse_git_progress("Cloning into 'repo'...").is_none());
    }

    #[tokio::test]
    async fn parses_cr_and_lf_terminated_records() {
        use std::sync::{Arc, Mutex};

        let observed = Arc::new(Mutex::new(Vec::new()));
        let sink = observed.clone();
        let reporter: ProgressReporter =
            Arc::new(move |progress| sink.lock().unwrap().push(progress));
        let bytes =
            b"Counting objects: 100% (1/1)\rReceiving objects: 100% (1/1), 1 KiB | 1 KiB/s\n";
        read_git_stderr(Some(&bytes[..]), Some(reporter))
            .await
            .unwrap();
        let observed = observed.lock().unwrap();
        assert_eq!(observed.len(), 2);
        assert_eq!(observed[0].stage, "counting");
        assert_eq!(observed[1].stage, "receiving");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_helper_times_out() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30"]);
        let started = std::time::Instant::now();
        assert!(matches!(
            run_git_command(&mut command, Duration::from_millis(20)).await,
            Err(Error::Git(message)) if message.contains("timed out")
        ));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_helper_times_out_when_descendant_holds_stdout() {
        let mut command = Command::new("sh");
        command.args(["-c", "sleep 30 &"]);
        let started = std::time::Instant::now();
        assert!(matches!(
            run_git_command(&mut command, Duration::from_millis(20)).await,
            Err(Error::Git(message)) if message.contains("timed out")
        ));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
