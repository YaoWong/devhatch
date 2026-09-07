use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::Arc,
    time::Duration,
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use super::environment::{node24_path, public_url};
use super::manager::PidRecord;
use super::{Operation, PORT, WebAppManager};

pub(super) enum PidRecordState {
    Missing,
    Stale,
    Invalid,
    Valid(PidRecord),
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ManagedProcessState {
    Missing,
    Invalid,
    Alive,
}

fn managed_process_state_decision(
    child_alive: bool,
    persisted_alive: bool,
    persisted_invalid: bool,
) -> ManagedProcessState {
    if persisted_invalid {
        ManagedProcessState::Invalid
    } else if child_alive || persisted_alive {
        ManagedProcessState::Alive
    } else {
        ManagedProcessState::Missing
    }
}

impl WebAppManager {
    pub async fn start(self: &Arc<Self>) -> Result<(), String> {
        let _guard = self
            .begin_operation(Operation::Start)
            .map_err(str::to_string)?;
        tokio::select! {
            result = async {
                let _operation = self.operation_lock.lock().await;
                self.recover_interrupted_publish_locked().await?;
                self.start_locked().await
            } => result,
            _ = self.wait_for_shutdown() => Err(super::OPERATION_CONFLICT.into()),
        }
    }

    pub(super) async fn start_locked(&self) -> Result<(), String> {
        if !self.installed() {
            return Err("OpenDesign is not installed".into());
        }
        match self.managed_process_state() {
            ManagedProcessState::Alive => {
                if self.refresh_running().await {
                    return Ok(());
                }
                return Err("OpenDesign process is already running but is not ready".into());
            }
            ManagedProcessState::Invalid => {
                return Err("OpenDesign PID record is invalid; manual cleanup is required".into());
            }
            ManagedProcessState::Missing => {}
        }
        if TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, PORT)).is_err() {
            return Err(format!("Port {PORT} is already in use"));
        }
        let node = node24_path().ok_or_else(|| "Node.js 24 is required".to_string())?;
        let logs = self.root.join("logs");
        fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(logs.join("open-design.log"))
            .map_err(|error| error.to_string())?;
        let stderr = log.try_clone().map_err(|error| error.to_string())?;
        let app = self
            .app_dir()
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let script = app
            .join("apps/daemon/dist/cli.js")
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let mut command = std::process::Command::new(node);
        crate::process::configure_std_command(&mut command);
        command
            .arg(&script)
            .arg("--no-open")
            .current_dir(&app)
            .env("NODE_ENV", "production")
            .env("NODE_OPTIONS", "--max-old-space-size=512")
            .env("OD_BIND_HOST", "127.0.0.1")
            .env("OD_PORT", PORT.to_string())
            .env("OD_WEB_PORT", PORT.to_string())
            .env("OD_DATA_DIR", self.root.join("data"))
            .env("OD_ALLOWED_ORIGINS", public_url())
            .env_remove("BYTE_API_API_KEY")
            .env_remove("BYTE_API_PROVIDER_ID")
            .env_remove("OPENCODE_CONFIG")
            .env_remove("OPENCODE_CONFIG_CONTENT")
            .env_remove("OPENCODE_CONFIG_DIR")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr));
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let identity = match self.child_record(&child, &app, &script) {
            Ok(identity) => identity,
            Err(error) => {
                terminate_child(&mut child);
                return Err(error);
            }
        };
        if let Err(error) = self.persist_child_identity(&identity) {
            terminate_child(&mut child);
            return Err(error);
        }
        *self
            .child_identity
            .lock()
            .expect("web app child identity lock poisoned") = Some(identity);
        *self.child.lock().expect("web app child lock poisoned") = Some(child);
        self.set_progress("starting", 95, None);
        for _ in 0..90 {
            if self.is_shutting_down() {
                return Err("OpenDesign shutdown interrupted start".into());
            }
            if self.refresh_running().await {
                self.set_progress("running", 100, None);
                return Ok(());
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                _ = self.shutdown_started.notified() => {}
            }
        }
        self.stop_locked().await;
        Err("OpenDesign did not become ready within 90 seconds".into())
    }

    fn child_record(&self, child: &Child, app: &Path, script: &Path) -> Result<PidRecord, String> {
        Ok(PidRecord {
            pid: child.id(),
            starttime: process_starttime(child.id())
                .ok_or_else(|| "Unable to identify OpenDesign process".to_string())?,
            script: script.to_path_buf(),
            root: app.to_path_buf(),
        })
    }

    fn persist_child_identity(&self, identity: &PidRecord) -> Result<(), String> {
        fs::create_dir_all(self.root.join("run")).map_err(|error| error.to_string())?;
        let value = serde_json::to_vec(identity).map_err(|error| error.to_string())?;
        atomic_write_file(&self.pid_path(), &value).map_err(|error| error.to_string())
    }

    pub async fn stop(self: &Arc<Self>) -> Result<(), String> {
        let _guard = self
            .begin_operation(Operation::Stop)
            .map_err(str::to_string)?;
        tokio::select! {
            result = async {
                let _operation = self.operation_lock.lock().await;
                self.recover_interrupted_publish_locked().await?;
                self.stop_locked_result().await
            } => result,
            _ = self.wait_for_shutdown() => Err(super::OPERATION_CONFLICT.into()),
        }
    }

    pub(super) async fn stop_locked(&self) {
        let _ = self.stop_locked_result().await;
    }

    pub(super) async fn stop_locked_result(&self) -> Result<(), String> {
        let persisted = match self.persisted_process_state() {
            PidRecordState::Valid(record) => Some(record),
            PidRecordState::Missing | PidRecordState::Stale => None,
            PidRecordState::Invalid => {
                return Err("OpenDesign PID record is invalid; manual cleanup is required".into());
            }
        };
        let memory_pid = self
            .child
            .lock()
            .expect("web app child lock poisoned")
            .as_ref()
            .map(Child::id);
        let persisted_direct = persisted
            .as_ref()
            .is_some_and(|record| memory_pid == Some(record.pid));
        let memory_record = self
            .child_identity
            .lock()
            .expect("web app child identity lock poisoned")
            .clone()
            .filter(|record| memory_pid == Some(record.pid))
            .filter(|record| {
                persisted
                    .as_ref()
                    .is_none_or(|saved| saved.pid != record.pid)
            });
        let mut records = Vec::new();
        if let Some(record) = persisted {
            records.push((record, persisted_direct));
        }
        if let Some(record) = memory_record {
            records.push((record, true));
        }
        let process_groups = records
            .iter()
            .map(|(record, _)| process_group(record.pid) == Some(record.pid))
            .collect::<Vec<_>>();
        for ((record, direct), process_group) in records.iter().zip(&process_groups) {
            signal_record(record, libc::SIGTERM, *process_group, *direct)?;
        }
        for _ in 0..25 {
            self.reap_child();
            if records
                .iter()
                .zip(&process_groups)
                .all(|((record, direct), group)| record_stopped(record, *group, *direct))
            {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        self.reap_child();
        for ((record, direct), process_group) in records.iter().zip(&process_groups) {
            signal_record(record, libc::SIGKILL, *process_group, *direct)?;
        }
        for _ in 0..50 {
            self.reap_child();
            if records
                .iter()
                .zip(&process_groups)
                .all(|((record, direct), group)| record_stopped(record, *group, *direct))
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.reap_child();
        if records
            .iter()
            .zip(&process_groups)
            .any(|((record, direct), group)| !record_stopped(record, *group, *direct))
        {
            return Err(
                "OpenDesign process could not be stopped; manual cleanup is required".into(),
            );
        }
        let _ = fs::remove_file(self.pid_path());
        if self.installed() {
            self.set_progress("stopped", 100, None);
        }
        Ok(())
    }

    fn reap_child(&self) {
        let mut child = self.child.lock().expect("web app child lock poisoned");
        let exited = child
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().flatten().is_some());
        if exited {
            let identity = self
                .child_identity
                .lock()
                .expect("web app child identity lock poisoned")
                .clone();
            let group_alive = identity
                .and_then(|record| {
                    crate::process::ChildIdentity::from_known(record.pid, record.starttime)
                })
                .is_some_and(|identity| crate::process::owned_group_alive(identity, true));
            if !group_alive {
                child.take();
                self.child_identity
                    .lock()
                    .expect("web app child identity lock poisoned")
                    .take();
            }
        }
    }

    pub async fn shutdown(self: &Arc<Self>) {
        self.shutting_down
            .store(true, std::sync::atomic::Ordering::Release);
        self.shutdown_started.notify_waiters();
        let task = self
            .install_task
            .lock()
            .expect("install task lock poisoned")
            .take();
        if let Some(task) = task {
            task.abort();
            let _ = task.await;
        }
        if tokio::time::timeout(Duration::from_secs(5), self.wait_for_operation())
            .await
            .is_err()
        {
            self.force_stop_managed_process();
            return;
        }
        let Ok(operation) =
            tokio::time::timeout(Duration::from_secs(2), self.operation_lock.lock()).await
        else {
            self.force_stop_managed_process();
            return;
        };
        let _ = tokio::time::timeout(Duration::from_secs(5), self.stop_locked_result()).await;
        self.force_stop_managed_process();
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            self.recover_interrupted_publish_locked(),
        )
        .await;
        self.cleanup_staging_locked();
        drop(operation);
    }

    fn force_stop_managed_process(&self) {
        let persisted = match self.persisted_process_state() {
            PidRecordState::Valid(record) => Some(record),
            PidRecordState::Missing | PidRecordState::Stale | PidRecordState::Invalid => None,
        };
        let persisted_group = persisted
            .as_ref()
            .is_some_and(|record| process_group(record.pid) == Some(record.pid));
        let memory = self
            .child_identity
            .lock()
            .expect("web app child identity lock poisoned")
            .clone()
            .filter(|record| {
                self.child
                    .lock()
                    .expect("web app child lock poisoned")
                    .as_ref()
                    .is_some_and(|child| child.id() == record.pid)
            });
        let memory_group = memory
            .as_ref()
            .is_some_and(|record| process_group(record.pid) == Some(record.pid));
        for (record, process_group) in persisted
            .iter()
            .zip(std::iter::once(persisted_group))
            .chain(memory.iter().zip(std::iter::once(memory_group)))
        {
            let _ = signal_record(record, libc::SIGKILL, process_group, true);
        }
        let mut child = self.child.lock().expect("web app child lock poisoned");
        if let Some(child) = child.as_mut() {
            terminate_child(child);
        }
        child.take();
        self.child_identity
            .lock()
            .expect("web app child identity lock poisoned")
            .take();
        let _ = fs::remove_file(self.pid_path());
    }

    pub(super) fn managed_process_state(&self) -> ManagedProcessState {
        let mut child = self.child.lock().expect("web app child lock poisoned");
        let child_alive = if let Some(process) = child.as_mut() {
            match process.try_wait() {
                Ok(None) | Err(_) => true,
                Ok(Some(_)) => {
                    child.take();
                    false
                }
            }
        } else {
            false
        };
        drop(child);
        let persisted = self.persisted_process_state();
        managed_process_state_decision(
            child_alive,
            matches!(persisted, PidRecordState::Valid(_)),
            matches!(persisted, PidRecordState::Invalid),
        )
    }

    pub(super) fn has_managed_process(&self) -> Result<bool, String> {
        match self.managed_process_state() {
            ManagedProcessState::Alive => Ok(true),
            ManagedProcessState::Missing => Ok(false),
            ManagedProcessState::Invalid => {
                Err("OpenDesign PID record is invalid; manual cleanup is required".into())
            }
        }
    }

    pub(super) async fn refresh_running(&self) -> bool {
        let exited = self
            .child
            .lock()
            .expect("web app child lock poisoned")
            .as_mut()
            .is_some_and(|child| child.try_wait().ok().flatten().is_some());
        if exited {
            self.child
                .lock()
                .expect("web app child lock poisoned")
                .take();
            self.child_identity
                .lock()
                .expect("web app child identity lock poisoned")
                .take();
            let _ = fs::remove_file(self.pid_path());
            if self.installed() {
                self.set_progress("stopped", 100, None);
            }
            return false;
        }
        let owned = self
            .child
            .lock()
            .expect("web app child lock poisoned")
            .as_ref()
            .is_some()
            || self
                .persisted_process()
                .as_ref()
                .is_some_and(process_matches);
        if !owned {
            return false;
        }
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(1))
            .build()
        {
            Ok(client) => client,
            Err(_) => return false,
        };
        client
            .get(format!("http://127.0.0.1:{PORT}/api/ready"))
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
    }
}

fn atomic_write_file(path: &Path, value: &[u8]) -> io::Result<()> {
    atomic_write_file_with(
        path,
        |file| {
            file.write_all(value)?;
            file.sync_all()
        },
        |source, destination| fs::rename(source, destination),
    )
}

fn atomic_write_file_with<F, R>(path: &Path, write: F, rename: R) -> io::Result<()>
where
    F: FnOnce(&mut fs::File) -> io::Result<()>,
    R: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid target name"))?;
    let temporary = parent.join(format!(".{name}.tmp-{}", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temporary)?;
    let result = (|| {
        write(&mut file)?;
        drop(file);
        rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn terminate_child(child: &mut Child) {
    crate::process::terminate_std_child(child, Duration::from_millis(250));
}

fn process_exists(pid: u32) -> bool {
    PathBuf::from(format!("/proc/{pid}")).exists()
}

#[derive(Debug, PartialEq, Eq)]
enum StopDecision {
    Signal,
    Stopped,
}

fn stop_decision(matches_record: bool) -> StopDecision {
    if matches_record {
        StopDecision::Signal
    } else {
        StopDecision::Stopped
    }
}

fn record_stopped(record: &PidRecord, process_group: bool, direct_child_owned: bool) -> bool {
    if process_group {
        let Some(identity) =
            crate::process::ChildIdentity::from_known(record.pid, record.starttime)
        else {
            return true;
        };
        !crate::process::owned_group_alive(identity, direct_child_owned)
    } else {
        stop_decision(process_matches(record)) == StopDecision::Stopped
    }
}

fn signal_record(
    record: &PidRecord,
    signal: i32,
    process_group: bool,
    direct_child_owned: bool,
) -> Result<(), String> {
    if !process_group && record_stopped(record, false, direct_child_owned) {
        return Ok(());
    }
    #[cfg(unix)]
    {
        let Some(identity) =
            crate::process::ChildIdentity::from_known(record.pid, record.starttime)
        else {
            return Err("Invalid OpenDesign process identity".into());
        };
        let sent = if process_group {
            if direct_child_owned {
                crate::process::signal_owned_child(identity, signal)
            } else {
                crate::process::signal_owned(identity, signal)
            }
        } else if identity.is_current() {
            let Ok(pid) = i32::try_from(record.pid) else {
                return Err("Invalid OpenDesign process ID".into());
            };
            unsafe { libc::kill(pid, signal) == 0 }
        } else {
            true
        };
        if !sent && (!process_group && !record_stopped(record, false, direct_child_owned)) {
            return Err(format!(
                "Unable to signal OpenDesign process {}",
                record.pid
            ));
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (signal, process_group);
    }
    Ok(())
}

pub(super) fn persisted_process_state(pid_path: &Path, app_dir: &Path) -> PidRecordState {
    let value = match fs::read_to_string(pid_path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return PidRecordState::Missing;
        }
        Err(_) => return PidRecordState::Invalid,
    };
    if let Ok(process) = serde_json::from_str::<PidRecord>(&value) {
        if !process_exists(process.pid) {
            return PidRecordState::Stale;
        }
        return if process_matches(&process) {
            PidRecordState::Valid(process)
        } else {
            PidRecordState::Invalid
        };
    }
    let Some(pid) = value.trim().parse().ok() else {
        return PidRecordState::Invalid;
    };
    if !process_exists(pid) {
        return PidRecordState::Stale;
    }
    let process = (|| {
        let root = app_dir.canonicalize().ok()?;
        let script = root.join("apps/daemon/dist/cli.js").canonicalize().ok()?;
        let process = PidRecord {
            pid,
            starttime: process_starttime(pid)?,
            script,
            root,
        };
        process_identity_matches(&process).then_some(process)
    })();
    process.map_or(PidRecordState::Invalid, PidRecordState::Valid)
}

pub(super) fn process_starttime(pid: u32) -> Option<u64> {
    process_stat(pid)?.split_whitespace().nth(19)?.parse().ok()
}

#[cfg(unix)]
fn process_group(pid: u32) -> Option<u32> {
    process_stat(pid)?.split_whitespace().nth(2)?.parse().ok()
}

fn process_stat(pid: u32) -> Option<String> {
    fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()?
        .rsplit_once(") ")
        .map(|(_, stat)| stat.to_string())
}

pub(super) fn process_matches(process: &PidRecord) -> bool {
    process_starttime(process.pid) == Some(process.starttime) && process_identity_matches(process)
}

pub(super) fn process_identity_matches(process: &PidRecord) -> bool {
    let cwd = fs::read_link(format!("/proc/{}/cwd", process.pid))
        .ok()
        .and_then(|path| path.canonicalize().ok());
    if cwd.as_ref() != Some(&process.root) {
        return false;
    }
    let command = match fs::read(format!("/proc/{}/cmdline", process.pid)) {
        Ok(command) => command,
        Err(_) => return false,
    };
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        command
            .split(|byte| *byte == 0)
            .any(|argument| argument == process.script.as_os_str().as_bytes())
    }
    #[cfg(not(unix))]
    {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ManagedProcessState, StopDecision, atomic_write_file, atomic_write_file_with,
        managed_process_state_decision, stop_decision,
    };
    use std::{fs, io::Write, os::unix::fs::PermissionsExt};

    fn root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("devhatch-pid-{}", uuid::Uuid::new_v4()))
    }

    fn temporary_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
        fs::read_dir(root)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with(".open-design.pid.tmp-"))
            })
            .collect()
    }

    #[test]
    fn atomic_write_succeeds_with_mode_600() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let target = root.join("open-design.pid");
        atomic_write_file(&target, b"new").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(temporary_files(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn atomic_write_failure_preserves_existing_and_removes_temp() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let target = root.join("open-design.pid");
        fs::write(&target, b"old").unwrap();
        let result = atomic_write_file_with(
            &target,
            |file| {
                file.write_all(b"partial")?;
                Err(std::io::Error::other("write failed"))
            },
            |source, destination| fs::rename(source, destination),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");
        assert!(temporary_files(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn atomic_rename_failure_preserves_existing_and_removes_temp() {
        let root = root();
        fs::create_dir_all(&root).unwrap();
        let target = root.join("open-design.pid");
        fs::write(&target, b"old").unwrap();
        let result = atomic_write_file_with(
            &target,
            |file| {
                file.write_all(b"new")?;
                file.sync_all()
            },
            |_, _| Err(std::io::Error::other("rename failed")),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(&target).unwrap(), b"old");
        assert!(temporary_files(&root).is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn managed_state_is_alive_without_readiness() {
        assert_eq!(
            managed_process_state_decision(true, false, false),
            ManagedProcessState::Alive
        );
        assert_eq!(
            managed_process_state_decision(false, true, false),
            ManagedProcessState::Alive
        );
    }

    #[test]
    fn invalid_live_record_blocks_operations() {
        assert_eq!(
            managed_process_state_decision(false, false, true),
            ManagedProcessState::Invalid
        );
        assert_eq!(
            managed_process_state_decision(true, false, true),
            ManagedProcessState::Invalid
        );
    }

    #[test]
    fn matching_record_may_be_signalled() {
        assert_eq!(stop_decision(true), StopDecision::Signal);
    }

    #[test]
    fn mismatched_record_is_already_stopped() {
        assert_eq!(stop_decision(false), StopDecision::Stopped);
    }
}
