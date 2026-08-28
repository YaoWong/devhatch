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
        command.args(["clone", "--no-tags"]);
        if !local && git_shallow() {
            command.args(["--depth", "1"]);
        }
        if let Some(git_ref) = git_ref {
            command.args(["--branch", git_ref]);
        }
        command.arg("--").arg(url).arg(&checkout);
        let duration = remaining(deadline)?;
        let output = run_git_command(&mut command, duration).await;
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
    let mut stderr = tokio::spawn(read_limited(child.stderr.take()));
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
        let remaining = GIT_OUTPUT_LIMIT.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..count.min(remaining)]);
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
