use std::{io, process::Output, time::Duration};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ChildIdentity {
    pid: u32,
    #[cfg(unix)]
    starttime: u64,
}

impl ChildIdentity {
    pub(crate) fn capture(pid: u32) -> Option<Self> {
        if pid == 0 || i32::try_from(pid).is_err() {
            return None;
        }
        #[cfg(unix)]
        {
            Some(Self {
                pid,
                starttime: process_starttime(pid)?,
            })
        }
        #[cfg(not(unix))]
        {
            Some(Self { pid })
        }
    }

    pub(crate) fn from_known(pid: u32, starttime: u64) -> Option<Self> {
        if pid == 0 || i32::try_from(pid).is_err() {
            return None;
        }
        #[cfg(unix)]
        {
            Some(Self { pid, starttime })
        }
        #[cfg(not(unix))]
        {
            let _ = starttime;
            Some(Self { pid })
        }
    }

    pub(crate) fn is_current(self) -> bool {
        #[cfg(unix)]
        {
            process_starttime(self.pid) == Some(self.starttime)
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}

#[cfg(unix)]
fn process_starttime(pid: u32) -> Option<u64> {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()?
        .rsplit_once(") ")?
        .1
        .split_whitespace()
        .nth(19)?
        .parse()
        .ok()
}

#[cfg(unix)]
fn process_group(pid: u32) -> Option<u32> {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()?
        .rsplit_once(") ")?
        .1
        .split_whitespace()
        .nth(2)?
        .parse()
        .ok()
}

pub(crate) fn configure_std_command(command: &mut std::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
}

pub(crate) fn configure_tokio_command(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    command.process_group(0);
    command.kill_on_drop(true);
}

pub(crate) fn signal_owned(identity: ChildIdentity, signal: i32) -> bool {
    signal_owned_inner(identity, signal, false)
}

pub(crate) fn signal_owned_child(identity: ChildIdentity, signal: i32) -> bool {
    signal_owned_inner(identity, signal, true)
}

pub(crate) fn owned_group_alive(identity: ChildIdentity, direct_child_owned: bool) -> bool {
    if !identity.is_current() && !direct_child_owned {
        return false;
    }
    #[cfg(unix)]
    {
        if identity.is_current() && process_group(identity.pid) != Some(identity.pid) {
            return false;
        }
        let Ok(pid) = i32::try_from(identity.pid) else {
            return false;
        };
        unsafe { libc::kill(-pid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = direct_child_owned;
        identity.is_current()
    }
}

fn signal_owned_inner(identity: ChildIdentity, signal: i32, direct_child_owned: bool) -> bool {
    if !identity.is_current() && !direct_child_owned {
        return false;
    }
    #[cfg(unix)]
    {
        if identity.is_current() && process_group(identity.pid) != Some(identity.pid) {
            return false;
        }
        let Ok(pid) = i32::try_from(identity.pid) else {
            return false;
        };
        unsafe { libc::kill(-pid, signal) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = (signal, direct_child_owned);
        false
    }
}

pub(crate) fn terminate_std_child(child: &mut std::process::Child, grace: Duration) {
    let identity = ChildIdentity::capture(child.id());
    #[cfg(unix)]
    if let Some(identity) = identity {
        let _ = signal_owned(identity, libc::SIGTERM);
    }
    #[cfg(not(unix))]
    let _ = child.kill();
    let deadline = std::time::Instant::now() + grace;
    while std::time::Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    #[cfg(unix)]
    if let Some(identity) = identity {
        let _ = signal_owned(identity, libc::SIGKILL);
    }
    let _ = child.kill();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.try_wait();
}

pub(crate) struct ProcessGuard(Option<ChildIdentity>);

impl ProcessGuard {
    pub(crate) fn new(identity: Option<ChildIdentity>) -> Self {
        Self(identity)
    }

    pub(crate) fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for ProcessGuard {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(identity) = self.0 {
            let _ = signal_owned(identity, libc::SIGKILL);
        }
    }
}

pub(crate) async fn command_output(
    command: &mut tokio::process::Command,
    duration: Duration,
    output_limit: usize,
) -> Result<Output, String> {
    use std::process::Stdio;

    configure_tokio_command(command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let identity = child.id().and_then(ChildIdentity::capture);
    let mut guard = ProcessGuard::new(identity);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_task = tokio::spawn(read_limited(stdout, output_limit));
    let stderr_task = tokio::spawn(read_limited(stderr, output_limit));
    let status = match tokio::time::timeout(duration, child.wait()).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => {
            #[cfg(unix)]
            if let Some(identity) = identity {
                let _ = signal_owned(identity, libc::SIGTERM);
                tokio::time::sleep(Duration::from_millis(250)).await;
                if child.try_wait().ok().flatten().is_none() {
                    let _ = signal_owned(identity, libc::SIGKILL);
                }
            }
            let _ = child.kill().await;
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            return Err("Command timed out".into());
        }
    };
    guard.disarm();
    let stdout = stdout_task.await.map_err(|error| error.to_string())??;
    let stderr = stderr_task.await.map_err(|error| error.to_string())??;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

async fn read_limited<R>(reader: Option<R>, limit: usize) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;

    let Some(mut reader) = reader else {
        return Ok(Vec::new());
    };
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Ok(output);
        }
        let remaining = limit.saturating_sub(output.len());
        output.extend_from_slice(&buffer[..count.min(remaining)]);
    }
}

pub(crate) fn io_error(error: String) -> io::Error {
    io::Error::other(error)
}

#[cfg(all(test, unix))]
mod tests {
    use super::{ChildIdentity, configure_std_command, signal_owned};
    use std::{process::Command, time::Duration};

    #[test]
    fn signal_owned_kills_process_tree() {
        let root = std::env::temp_dir().join(format!("devhatch-process-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let child_pid_path = root.join("child.pid");
        let mut command = Command::new("/bin/sh");
        configure_std_command(&mut command);
        let mut leader = command
            .arg("-c")
            .arg(format!(
                "trap '' TERM; sleep 300 & echo $! > '{}'; wait",
                child_pid_path.display()
            ))
            .spawn()
            .unwrap();
        let leader_pid = leader.id();
        let identity = ChildIdentity::capture(leader_pid).unwrap();
        let child_pid = wait_for_pid(&child_pid_path);
        assert!(signal_owned(identity, libc::SIGKILL));
        leader.wait().unwrap();
        wait_until_gone(leader_pid);
        wait_until_gone(child_pid);
        assert!(!std::path::Path::new(&format!("/proc/{leader_pid}")).exists());
        assert!(!std::path::Path::new(&format!("/proc/{child_pid}")).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    fn wait_for_pid(path: &std::path::Path) -> u32 {
        for _ in 0..100 {
            if let Ok(value) = std::fs::read_to_string(path)
                && let Ok(pid) = value.trim().parse()
            {
                return pid;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("child pid was not written");
    }

    fn wait_until_gone(pid: u32) {
        for _ in 0..100 {
            if !std::path::Path::new(&format!("/proc/{pid}")).exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
