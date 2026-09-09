use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use super::environment::{Prerequisites, prerequisites as detect_prerequisites, public_url};
use super::{ID, NAME, Operation, OperationGuard, Progress, UpdateState, VERSION, WebAppManager};

const PREREQUISITES_TTL: Duration = Duration::from_secs(30);
const PREREQUISITES_RETRY_DELAY: Duration = Duration::from_secs(5);

pub(super) struct PrerequisitesCache {
    value: Prerequisites,
    refresh_after: Instant,
    refreshing: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WebAppView {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    installed: bool,
    installing: bool,
    updating: bool,
    checking_for_update: bool,
    operation: Option<&'static str>,
    update_available: bool,
    progress: u8,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    running: bool,
    phase: &'static str,
    version: Option<String>,
    current_revision: Option<String>,
    remote_revision: Option<String>,
    latest_version: Option<String>,
    url: Option<String>,
    install_path: String,
    error: Option<String>,
    prerequisites: Prerequisites,
}

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct PidRecord {
    pub(super) pid: u32,
    pub(super) starttime: u64,
    pub(super) script: std::path::PathBuf,
    pub(super) root: std::path::PathBuf,
}

impl WebAppManager {
    pub fn new(data_dir: &Path) -> Self {
        Self::with_prerequisite_probe(data_dir, detect_prerequisites)
    }

    fn with_prerequisite_probe(data_dir: &Path, prerequisite_probe: fn() -> Prerequisites) -> Self {
        Self::with_prerequisites(data_dir, prerequisite_probe(), prerequisite_probe)
    }

    fn with_prerequisites(
        data_dir: &Path,
        prerequisites: Prerequisites,
        prerequisite_probe: fn() -> Prerequisites,
    ) -> Self {
        Self {
            root: data_dir.join("webapps/open-design"),
            prerequisites: std::sync::Arc::new(tokio::sync::Mutex::new(PrerequisitesCache {
                value: prerequisites,
                refresh_after: Instant::now() + PREREQUISITES_TTL,
                refreshing: false,
            })),
            prerequisite_probe,
            progress: std::sync::RwLock::new(Progress {
                phase: "not-installed",
                percent: 0,
                downloaded_bytes: None,
                total_bytes: None,
                error: None,
            }),
            update: std::sync::RwLock::new(UpdateState::default()),
            child: std::sync::Mutex::new(None),
            child_identity: std::sync::Mutex::new(None),
            operation_lock: tokio::sync::Mutex::new(()),
            operation: std::sync::atomic::AtomicU8::new(0),
            operation_complete: tokio::sync::Notify::new(),
            shutdown_started: tokio::sync::Notify::new(),
            shutting_down: std::sync::atomic::AtomicBool::new(false),
            install_task: std::sync::Mutex::new(None),
        }
    }

    pub(super) async fn view(&self) -> WebAppView {
        let prerequisites = self.prerequisites().await;
        let installed = self.installed();
        let running = self.refresh_running().await;
        let progress = self
            .progress
            .read()
            .expect("web app progress lock poisoned")
            .clone();
        let phase = if running {
            "running"
        } else if installed && progress.phase == "not-installed" {
            "stopped"
        } else {
            progress.phase
        };
        let update = self.update.read().expect("web app update lock poisoned");
        WebAppView {
            id: ID,
            name: NAME,
            description: "Design with AI agents in a local visual workspace",
            installed,
            installing: matches!(
                phase,
                "preparing" | "downloading" | "installing" | "building"
            ),
            updating: matches!(phase, "updating" | "installing-update" | "building-update"),
            checking_for_update: update.checking,
            operation: self.operation_name(),
            update_available: update.available,
            progress: progress.percent,
            downloaded_bytes: progress.downloaded_bytes,
            total_bytes: progress.total_bytes,
            running,
            phase,
            version: installed.then(|| self.installed_version()),
            current_revision: update.current_revision.clone(),
            remote_revision: update.remote_revision.clone(),
            latest_version: update.latest_version.clone(),
            url: running.then(public_url),
            install_path: self.root.display().to_string(),
            error: progress.error,
            prerequisites,
        }
    }

    async fn prerequisites(&self) -> Prerequisites {
        let mut cache = self.prerequisites.lock().await;
        let value = cache.value;
        if Instant::now() < cache.refresh_after || cache.refreshing {
            return value;
        }
        cache.refreshing = true;
        drop(cache);
        let prerequisites = self.prerequisites.clone();
        let prerequisite_probe = self.prerequisite_probe;
        tokio::spawn(async move {
            let refreshed = tokio::time::timeout(
                Duration::from_secs(5),
                tokio::task::spawn_blocking(prerequisite_probe),
            )
            .await
            .ok()
            .and_then(Result::ok);
            let mut cache = prerequisites.lock().await;
            cache.refreshing = false;
            if let Some(refreshed) = refreshed {
                cache.value = refreshed;
                cache.refresh_after = Instant::now() + PREREQUISITES_TTL;
            } else {
                cache.refresh_after = Instant::now() + PREREQUISITES_RETRY_DELAY;
            }
        });
        value
    }

    pub(super) fn installed_version(&self) -> String {
        fs::read(self.app_dir().join("package.json"))
            .ok()
            .and_then(|content| serde_json::from_slice::<serde_json::Value>(&content).ok())
            .and_then(|package| package.get("version")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| VERSION.to_string())
    }

    pub(super) async fn remote_version(&self) -> Result<String, String> {
        let package = self
            .git_output(["show", "origin/HEAD:package.json"])
            .await?;
        serde_json::from_str::<serde_json::Value>(&package)
            .ok()
            .and_then(|package| package.get("version")?.as_str().map(str::to_owned))
            .ok_or_else(|| "Unable to read the latest OpenDesign version".to_string())
    }

    pub(super) async fn git_output<const N: usize>(
        &self,
        args: [&str; N],
    ) -> Result<String, String> {
        self.git_output_at(&self.app_dir(), args).await
    }

    pub(super) async fn git_output_at<const N: usize>(
        &self,
        path: &Path,
        args: [&str; N],
    ) -> Result<String, String> {
        let output = crate::process::command_output(
            tokio::process::Command::new("git")
                .args(args)
                .current_dir(path),
            std::time::Duration::from_secs(30),
            512 * 1024,
        )
        .await?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub(super) fn installed(&self) -> bool {
        self.app_dir().join("apps/daemon/dist/cli.js").is_file()
            && self.app_dir().join("apps/web/out/index.html").is_file()
    }

    pub(super) fn app_dir(&self) -> std::path::PathBuf {
        self.root.join("app")
    }

    pub(super) fn pid_path(&self) -> std::path::PathBuf {
        self.root.join("run/open-design.pid")
    }

    pub(super) fn persisted_process(&self) -> Option<PidRecord> {
        match self.persisted_process_state() {
            super::process::PidRecordState::Valid(process) => Some(process),
            super::process::PidRecordState::Stale => {
                let _ = fs::remove_file(self.pid_path());
                None
            }
            super::process::PidRecordState::Missing | super::process::PidRecordState::Invalid => {
                None
            }
        }
    }

    pub(super) fn persisted_process_state(&self) -> super::process::PidRecordState {
        super::process::persisted_process_state(&self.pid_path(), &self.app_dir())
    }

    pub(super) fn begin_operation(
        self: &std::sync::Arc<Self>,
        operation: Operation,
    ) -> Result<OperationGuard, &'static str> {
        if self
            .shutting_down
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(super::OPERATION_CONFLICT);
        }
        self.operation
            .compare_exchange(
                0,
                operation as u8,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .map_err(|_| super::OPERATION_CONFLICT)?;
        let guard = OperationGuard {
            manager: self.clone(),
        };
        if self
            .shutting_down
            .load(std::sync::atomic::Ordering::Acquire)
        {
            drop(guard);
            return Err(super::OPERATION_CONFLICT);
        }
        Ok(guard)
    }

    pub(super) fn is_shutting_down(&self) -> bool {
        self.shutting_down
            .load(std::sync::atomic::Ordering::Acquire)
    }

    pub(super) async fn wait_for_shutdown(&self) {
        loop {
            let started = self.shutdown_started.notified();
            if self.is_shutting_down() {
                return;
            }
            started.await;
        }
    }

    pub(super) async fn wait_for_operation(&self) {
        loop {
            let completed = self.operation_complete.notified();
            if self.operation.load(std::sync::atomic::Ordering::Acquire) == 0 {
                return;
            }
            completed.await;
        }
    }

    pub(super) fn operation_name(&self) -> Option<&'static str> {
        match self.operation.load(std::sync::atomic::Ordering::Acquire) {
            1 => Some(Operation::Install.name()),
            2 => Some(Operation::Update.name()),
            3 => Some(Operation::Check.name()),
            4 => Some(Operation::Start.name()),
            5 => Some(Operation::Stop.name()),
            _ => None,
        }
    }

    pub(super) fn set_progress(&self, phase: &'static str, percent: u8, error: Option<String>) {
        *self
            .progress
            .write()
            .expect("web app progress lock poisoned") = Progress {
            phase,
            percent,
            downloaded_bytes: None,
            total_bytes: None,
            error,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::{Duration, WebAppManager};
    use crate::web_app::{OPERATION_CONFLICT, Operation, environment::Prerequisites};
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Instant,
    };

    static PREREQUISITE_PROBES: AtomicUsize = AtomicUsize::new(0);

    fn changed_prerequisites() -> Prerequisites {
        PREREQUISITE_PROBES.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(50));
        Prerequisites {
            git: false,
            node24: true,
            corepack: true,
        }
    }

    #[tokio::test]
    async fn view_serves_stale_prerequisites_while_refreshing_once() {
        PREREQUISITE_PROBES.store(0, Ordering::SeqCst);
        let data =
            std::env::temp_dir().join(format!("devhatch-prerequisites-{}", uuid::Uuid::new_v4()));
        let initial = Prerequisites {
            git: true,
            node24: false,
            corepack: false,
        };
        let manager = WebAppManager::with_prerequisites(&data, initial, changed_prerequisites);

        assert_eq!(manager.view().await.prerequisites, initial);
        assert_eq!(PREREQUISITE_PROBES.load(Ordering::SeqCst), 0);
        manager.prerequisites.lock().await.refresh_after = Instant::now();
        let refreshed = Prerequisites {
            git: false,
            node24: true,
            corepack: true,
        };

        assert_eq!(manager.view().await.prerequisites, initial);
        assert_eq!(manager.view().await.prerequisites, initial);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if !manager.prerequisites.lock().await.refreshing {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(manager.view().await.prerequisites, refreshed);
        assert_eq!(PREREQUISITE_PROBES.load(Ordering::SeqCst), 1);
    }

    fn manager() -> Arc<WebAppManager> {
        Arc::new(WebAppManager::new(
            &std::env::temp_dir().join(format!("devhatch-operation-{}", uuid::Uuid::new_v4())),
        ))
    }

    #[test]
    fn operation_state_rejects_every_concurrent_operation() {
        let manager = manager();
        let guard = manager.begin_operation(Operation::Install).unwrap();
        assert_eq!(manager.operation_name(), Some("install"));
        for operation in [
            Operation::Install,
            Operation::Update,
            Operation::Check,
            Operation::Start,
            Operation::Stop,
        ] {
            assert_eq!(
                manager.begin_operation(operation).err(),
                Some(OPERATION_CONFLICT)
            );
        }
        drop(guard);
        assert_eq!(manager.operation_name(), None);
    }

    #[tokio::test]
    async fn shutdown_blocks_new_operations_and_waits_for_active_start() {
        let manager = manager();
        let guard = manager.begin_operation(Operation::Start).unwrap();
        let shutdown_manager = manager.clone();
        let shutdown = tokio::spawn(async move { shutdown_manager.shutdown().await });
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !manager.is_shutting_down() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            manager.begin_operation(Operation::Stop).err(),
            Some(OPERATION_CONFLICT)
        );
        assert!(!shutdown.is_finished());
        drop(guard);
        tokio::time::timeout(std::time::Duration::from_secs(1), shutdown)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(manager.operation_name(), None);
    }

    #[test]
    fn operation_state_is_released_by_guard() {
        let manager = manager();
        drop(manager.begin_operation(Operation::Update).unwrap());
        let guard = manager.begin_operation(Operation::Start).unwrap();
        assert_eq!(manager.operation_name(), Some("start"));
        drop(guard);
    }
}
