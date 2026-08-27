use std::{ffi::OsStr, fs, future::Future, path::Path, sync::Arc};

use tokio::process::Command;

use super::environment::{executable_on_path, node24_path, prefixed_path, sibling_executable};
use super::{MANAGED_BRANCH, Operation, REPOSITORY, REVISION, WebAppManager};

impl WebAppManager {
    pub fn begin_install(self: &Arc<Self>) -> Result<(), &'static str> {
        let guard = self.begin_operation(Operation::Install)?;
        let mut task_slot = self
            .install_task
            .lock()
            .expect("install task lock poisoned");
        if self.is_shutting_down() {
            return Err(super::OPERATION_CONFLICT);
        }
        if task_slot.as_ref().is_some_and(|task| !task.is_finished()) {
            return Err(super::OPERATION_CONFLICT);
        }
        task_slot.take();
        if self.installed() && !self.root.join("app.update-backup").exists() {
            return Err("WEB_APP_ALREADY_INSTALLED");
        }
        {
            let mut progress = self
                .progress
                .write()
                .expect("web app progress lock poisoned");
            progress.phase = "preparing";
            progress.percent = 3;
            progress.downloaded_bytes = None;
            progress.total_bytes = None;
            progress.error = None;
        }
        let (start, ready) = tokio::sync::oneshot::channel();
        let manager = self.clone();
        let task = tokio::spawn(async move {
            let _ = ready.await;
            let operation_manager = manager.clone();
            run_install_task(
                manager,
                guard,
                async move { operation_manager.install().await },
            )
            .await;
        });
        *task_slot = Some(task);
        let _ = start.send(());
        Ok(())
    }

    pub async fn check_update(self: &Arc<Self>) -> Result<(), String> {
        let _guard = self
            .begin_operation(Operation::Check)
            .map_err(str::to_string)?;
        tokio::select! {
            result = self.check_update_operation() => result,
            _ = self.wait_for_shutdown() => Err(super::OPERATION_CONFLICT.into()),
        }
    }

    async fn check_update_operation(&self) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.recover_interrupted_publish_locked().await?;
        if !self.installed() {
            return Err("OpenDesign is not installed".into());
        }
        self.update
            .write()
            .expect("web app update lock poisoned")
            .checking = true;
        let result = async {
            let app = self.app_dir();
            self.run_install_command(
                Command::new("git")
                    .args(["fetch", "--prune", "origin"])
                    .current_dir(&app),
            )
            .await?;
            let current = self.git_output(["rev-parse", "HEAD"]).await?;
            let remote = self.git_output(["rev-parse", "origin/HEAD"]).await?;
            let latest_version = self.remote_version().await?;
            let update_available = current != remote;
            let mut update = self.update.write().expect("web app update lock poisoned");
            update.current_revision = Some(current);
            update.remote_revision = Some(remote);
            update.latest_version = Some(latest_version);
            update.available = update_available;
            Ok(())
        }
        .await;
        self.update
            .write()
            .expect("web app update lock poisoned")
            .checking = false;
        result
    }

    pub fn begin_update(self: &Arc<Self>) -> Result<(), &'static str> {
        let guard = self.begin_operation(Operation::Update)?;
        let mut task_slot = self
            .install_task
            .lock()
            .expect("install task lock poisoned");
        if self.is_shutting_down() {
            return Err(super::OPERATION_CONFLICT);
        }
        if task_slot.as_ref().is_some_and(|task| !task.is_finished()) {
            return Err(super::OPERATION_CONFLICT);
        }
        task_slot.take();
        if !self.installed() && !self.root.join("app.update-backup").exists() {
            return Err("WEB_APP_NOT_INSTALLED");
        }
        {
            let mut progress = self
                .progress
                .write()
                .expect("web app progress lock poisoned");
            progress.phase = "updating";
            progress.percent = 10;
            progress.downloaded_bytes = None;
            progress.total_bytes = None;
            progress.error = None;
        }
        let (start, ready) = tokio::sync::oneshot::channel();
        let manager = self.clone();
        let task = tokio::spawn(async move {
            let _ = ready.await;
            let operation_manager = manager.clone();
            run_install_task(
                manager,
                guard,
                async move { operation_manager.update().await },
            )
            .await;
        });
        *task_slot = Some(task);
        let _ = start.send(());
        Ok(())
    }

    async fn update(&self) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.recover_interrupted_publish_locked().await?;
        if !self.installed() {
            return Err("OpenDesign is not installed".into());
        }
        let node = node24_path().ok_or_else(|| "Node.js 24 is required".to_string())?;
        let corepack = sibling_executable(&node, "corepack")
            .ok_or_else(|| "Corepack is required".to_string())?;
        let app = self.app_dir();
        if !self.git_output(["status", "--porcelain"]).await?.is_empty() {
            return Err("OpenDesign has local changes; update was cancelled".into());
        }
        let was_running = self.has_managed_process()?;
        if was_running {
            self.stop_locked_result().await?;
        }
        let staging = self.root.join("app.update-staging");
        let backup = self.root.join("app.update-backup");
        let update_result = async {
            remove_directory_if_exists(&staging)?;
            self.set_progress("updating", 10, None);
            self.run_git_progress(
                Command::new("git")
                    .args(["clone", "--progress", "--no-hardlinks", "--no-checkout"])
                    .arg(&app)
                    .arg(&staging),
                10,
                25,
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["remote", "set-url", "origin", REPOSITORY])
                    .current_dir(&staging),
            )
            .await?;
            self.run_git_progress(
                Command::new("git")
                    .args(["fetch", "--progress", "--prune", "origin"])
                    .current_dir(&staging),
                25,
                40,
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["checkout", "-B", MANAGED_BRANCH, "origin/HEAD"])
                    .current_dir(&staging),
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["branch", "--set-upstream-to", "origin/HEAD", MANAGED_BRANCH])
                    .current_dir(&staging),
            )
            .await?;
            self.build_staging(&staging, &node, &corepack, true).await?;
            let revision = self.git_output_at(&staging, ["rev-parse", "HEAD"]).await?;
            let published = publish_directory(&staging, &app, &backup)?;
            Ok((published, revision))
        }
        .await;
        let (published, revision) = match update_result {
            Ok(result) => result,
            Err(update) => {
                let update = cleanup_failed_staging(&self.root, &staging, update);
                return if was_running {
                    match self.start_locked().await {
                        Ok(()) => Err(update),
                        Err(restart) => Err(format!("{update}; restart failed: {restart}")),
                    }
                } else {
                    Err(update)
                };
            }
        };
        if was_running && let Err(new_start) = self.start_locked().await {
            if let Err(stop) = self.stop_locked_result().await {
                return Err(format!(
                    "new version start failed: {new_start}; new version stop failed: {stop}"
                ));
            }
            let restore = rollback_publish(&app, &backup);
            let old_start = if restore.is_ok() {
                self.start_locked().await
            } else {
                Ok(())
            };
            let mut error = format!("new version start failed: {new_start}");
            if let Err(restore) = restore {
                error.push_str(&format!("; old version restore failed: {restore}"));
            }
            if let Err(old_start) = old_start {
                error.push_str(&format!("; old version start failed: {old_start}"));
            }
            return Err(error);
        }
        finalize_publish(published, &backup)?;
        let mut update = self.update.write().expect("web app update lock poisoned");
        update.current_revision = Some(revision.clone());
        update.remote_revision = Some(revision);
        update.latest_version = Some(self.installed_version());
        update.available = false;
        self.set_progress(if was_running { "running" } else { "stopped" }, 100, None);
        Ok(())
    }

    async fn install(&self) -> Result<(), String> {
        let _operation = self.operation_lock.lock().await;
        self.recover_interrupted_publish_locked().await?;
        if self.installed() {
            return Err("OpenDesign is already installed".into());
        }
        if self.has_managed_process()? {
            return Err("OpenDesign process is running".into());
        }
        let node = node24_path().ok_or_else(|| "Node.js 24 is required".to_string())?;
        let corepack = sibling_executable(&node, "corepack")
            .ok_or_else(|| "Corepack is required".to_string())?;
        if executable_on_path("git").is_none() {
            return Err("Git is required".into());
        }
        fs::create_dir_all(&self.root).map_err(|error| error.to_string())?;
        let staging = self.root.join("app.update-staging");
        remove_staging_directory(&self.root, &staging)?;
        let install_result = async {
            self.set_progress("downloading", 10, None);
            self.run_git_progress(
                Command::new("git")
                    .args([
                        "clone",
                        "--progress",
                        "--filter=blob:none",
                        "--no-checkout",
                        REPOSITORY,
                    ])
                    .arg(&staging),
                10,
                40,
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["checkout", "-B", MANAGED_BRANCH, REVISION])
                    .current_dir(&staging),
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["branch", "--set-upstream-to", "origin/HEAD", MANAGED_BRANCH])
                    .current_dir(&staging),
            )
            .await?;
            self.build_staging(&staging, &node, &corepack, false)
                .await?;
            let app = self.app_dir();
            let backup = self.root.join("app.update-backup");
            let published = publish_directory(&staging, &app, &backup)?;
            finalize_publish(published, &backup)
        }
        .await;
        if let Err(error) = install_result {
            return Err(cleanup_failed_staging(&self.root, &staging, error));
        }
        fs::create_dir_all(self.root.join("data")).map_err(|error| error.to_string())?;
        self.set_progress("stopped", 100, None);
        Ok(())
    }

    pub(super) fn cleanup_staging_locked(&self) {
        let _ = remove_staging_directory(&self.root, &self.root.join("app.update-staging"));
        cleanup_discarded_directories(&self.root);
    }

    pub(super) async fn recover_interrupted_publish_locked(&self) -> Result<(), String> {
        cleanup_discarded_directories(&self.root);
        let backup = self.root.join("app.update-backup");
        if backup.exists() {
            match self.persisted_process_state() {
                super::process::PidRecordState::Valid(_) => {
                    self.stop_locked_result().await?;
                }
                super::process::PidRecordState::Stale => {
                    fs::remove_file(self.pid_path()).map_err(|error| error.to_string())?;
                }
                super::process::PidRecordState::Invalid => {
                    return Err(
                        "OpenDesign PID record is invalid; manual cleanup is required before recovery"
                            .into(),
                    );
                }
                super::process::PidRecordState::Missing => {}
            }
            let memory_pid = self
                .child
                .lock()
                .expect("web app child lock poisoned")
                .as_ref()
                .map(std::process::Child::id);
            if memory_pid.is_some() {
                self.stop_locked_result().await?;
            }
        }
        recover_interrupted_publish(
            &self.app_dir(),
            &backup,
            &self.root.join("app.update-staging"),
        )
    }

    async fn build_staging(
        &self,
        staging: &std::path::Path,
        node: &std::path::Path,
        corepack: &std::path::Path,
        update: bool,
    ) -> Result<(), String> {
        let path = prefixed_path(node);
        self.set_progress(
            if update {
                "installing-update"
            } else {
                "installing"
            },
            45,
            None,
        );
        self.run_install_command(
            Command::new(corepack)
                .args(["pnpm@10.33.2", "install", "--frozen-lockfile"])
                .env("PATH", &path)
                .current_dir(staging),
        )
        .await?;
        self.set_progress(
            if update {
                "building-update"
            } else {
                "building"
            },
            70,
            None,
        );
        self.run_install_command(
            Command::new(corepack)
                .args(["pnpm@10.33.2", "--filter", "@open-design/daemon", "build"])
                .env("PATH", &path)
                .current_dir(staging),
        )
        .await?;
        self.set_progress(
            if update {
                "building-update"
            } else {
                "building"
            },
            85,
            None,
        );
        self.run_install_command(
            Command::new(corepack)
                .args(["pnpm@10.33.2", "--filter", "@open-design/web", "build"])
                .env("PATH", &path)
                .current_dir(staging),
        )
        .await?;
        if !staging.join("apps/daemon/dist/cli.js").is_file()
            || !staging.join("apps/web/out/index.html").is_file()
        {
            return Err("OpenDesign build artifacts are incomplete".into());
        }
        Ok(())
    }
}

async fn run_install_task<F>(
    manager: Arc<WebAppManager>,
    guard: super::OperationGuard,
    operation: F,
) where
    F: Future<Output = Result<(), String>>,
{
    let result = operation.await;
    drop(guard);
    if let Err(error) = result {
        manager.set_progress("failed", 0, Some(error));
    }
}

fn remove_directory_if_exists(path: &std::path::Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn remove_staging_directory(root: &Path, staging: &Path) -> Result<(), String> {
    if staging.parent() != Some(root)
        || staging.file_name() != Some(OsStr::new("app.update-staging"))
    {
        return Err("OpenDesign staging path is not managed".into());
    }
    let metadata = match fs::symlink_metadata(staging) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err("OpenDesign staging path is not a managed directory".into());
    }
    fs::remove_dir_all(staging).map_err(|error| error.to_string())
}

fn cleanup_failed_staging(root: &Path, staging: &Path, error: String) -> String {
    match remove_staging_directory(root, staging) {
        Ok(()) => error,
        Err(cleanup) => format!("{error}; staging cleanup failed: {cleanup}"),
    }
}

#[derive(Clone, Copy)]
struct PublishedDirectory {
    backup_retained: bool,
}

fn publish_directory(
    staging: &std::path::Path,
    current: &std::path::Path,
    backup: &std::path::Path,
) -> Result<PublishedDirectory, String> {
    if backup.exists() {
        return Err("OpenDesign update backup already exists".into());
    }
    let had_current = current.exists();
    if had_current {
        fs::rename(current, backup).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(staging, current) {
        if had_current {
            return match fs::rename(backup, current) {
                Ok(()) => Err(error.to_string()),
                Err(rollback) => Err(format!("{error}; rollback failed: {rollback}")),
            };
        }
        return Err(error.to_string());
    }
    Ok(PublishedDirectory {
        backup_retained: had_current,
    })
}

const DISCARD_PREFIX: &str = "app.update-discard-";

fn finalize_publish(published: PublishedDirectory, backup: &Path) -> Result<(), String> {
    finalize_publish_with(published, backup, |source, destination| {
        fs::rename(source, destination)
    })
}

fn finalize_publish_with<F>(
    published: PublishedDirectory,
    backup: &Path,
    rename: F,
) -> Result<(), String>
where
    F: FnOnce(&Path, &Path) -> std::io::Result<()>,
{
    if !published.backup_retained {
        return Ok(());
    }
    let parent = backup
        .parent()
        .ok_or_else(|| "OpenDesign update backup has no parent directory".to_string())?;
    let discard = parent.join(format!("{DISCARD_PREFIX}{}", uuid::Uuid::new_v4()));
    rename(backup, &discard).map_err(|error| error.to_string())?;
    remove_discarded_directory(parent, &discard);
    Ok(())
}

fn cleanup_discarded_directories(root: &Path) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !discard_name(&name) {
            continue;
        }
        remove_discarded_directory(root, &entry.path());
    }
}

fn discard_name(name: &OsStr) -> bool {
    name.to_str()
        .and_then(|name| name.strip_prefix(DISCARD_PREFIX))
        .is_some_and(|suffix| uuid::Uuid::parse_str(suffix).is_ok())
}

fn remove_discarded_directory(root: &Path, path: &Path) {
    if path.parent() != Some(root) || !path.file_name().is_some_and(discard_name) {
        return;
    }
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        let _ = fs::remove_dir_all(path);
    }
}

fn rollback_publish(current: &std::path::Path, backup: &std::path::Path) -> Result<(), String> {
    if !backup.exists() {
        return Err("OpenDesign update backup is missing".into());
    }
    let stale = current.with_file_name("app.update-stale");
    remove_directory_if_exists(&stale)?;
    if current.exists() {
        fs::rename(current, &stale).map_err(|error| error.to_string())?;
    }
    if let Err(error) = fs::rename(backup, current) {
        if stale.exists() {
            return match fs::rename(&stale, current) {
                Ok(()) => Err(error.to_string()),
                Err(restore) => Err(format!("{error}; failed app restore: {restore}")),
            };
        }
        return Err(error.to_string());
    }
    let _ = fs::remove_dir_all(stale);
    Ok(())
}

fn recover_interrupted_publish(
    current: &std::path::Path,
    backup: &std::path::Path,
    staging: &std::path::Path,
) -> Result<(), String> {
    if let Some(root) = current.parent() {
        cleanup_discarded_directories(root);
    }
    if backup.exists() {
        rollback_publish(current, backup)?;
    }
    let _ = fs::remove_dir_all(staging);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        PublishedDirectory, cleanup_discarded_directories, cleanup_failed_staging,
        finalize_publish, finalize_publish_with, publish_directory, recover_interrupted_publish,
        rollback_publish, run_install_task,
    };
    use crate::web_app::{Operation, WebAppManager, manager::PidRecord};
    use std::{fs, sync::Arc};

    fn root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("devhatch-publish-{}", uuid::Uuid::new_v4()))
    }

    fn write_version(path: &std::path::Path, version: &str) {
        fs::create_dir_all(path).unwrap();
        fs::write(path.join("version"), version).unwrap();
    }

    fn version(path: &std::path::Path) -> String {
        fs::read_to_string(path.join("version")).unwrap()
    }

    #[test]
    fn failed_install_cleanup_removes_managed_staging() {
        let root = root();
        let staging = root.join("app.update-staging");
        write_version(&staging, "partial");
        assert_eq!(
            cleanup_failed_staging(&root, &staging, "clone failed".into()),
            "clone failed"
        );
        assert!(!staging.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_install_cleanup_does_not_remove_non_directory() {
        let root = root();
        let staging = root.join("app.update-staging");
        fs::create_dir_all(&root).unwrap();
        fs::write(&staging, "owned elsewhere").unwrap();
        let error = cleanup_failed_staging(&root, &staging, "build failed".into());
        assert!(error.starts_with("build failed; staging cleanup failed:"));
        assert_eq!(fs::read_to_string(&staging).unwrap(), "owned elsewhere");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn failed_install_cleanup_does_not_remove_symlink() {
        use std::os::unix::fs::symlink;

        let root = root();
        let outside = root.with_file_name(format!("devhatch-outside-{}", uuid::Uuid::new_v4()));
        let staging = root.join("app.update-staging");
        write_version(&outside, "outside");
        fs::create_dir_all(&root).unwrap();
        symlink(&outside, &staging).unwrap();
        let error = cleanup_failed_staging(&root, &staging, "checkout failed".into());
        assert!(error.starts_with("checkout failed; staging cleanup failed:"));
        assert!(staging.exists());
        assert_eq!(version(&outside), "outside");
        let _ = fs::remove_file(staging);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[tokio::test]
    async fn failed_install_task_releases_operation_guard() {
        let data = root();
        let manager = Arc::new(WebAppManager::new(&data));
        let guard = manager.begin_operation(Operation::Install).unwrap();
        run_install_task(manager.clone(), guard, async { Err("clone failed".into()) }).await;
        assert_eq!(manager.operation_name(), None);
        assert_eq!(
            manager.progress.read().unwrap().error.as_deref(),
            Some("clone failed")
        );
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn publish_retains_backup() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("app.update-staging");
        let backup = root.join("app.update-backup");
        write_version(&current, "old");
        write_version(&staging, "new");
        let published = publish_directory(&staging, &current, &backup).unwrap();
        assert!(published.backup_retained);
        assert_eq!(version(&current), "new");
        assert_eq!(version(&backup), "old");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn startup_failure_rolls_back() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("app.update-staging");
        let backup = root.join("app.update-backup");
        write_version(&current, "old");
        write_version(&staging, "new");
        publish_directory(&staging, &current, &backup).unwrap();
        rollback_publish(&current, &backup).unwrap();
        assert_eq!(version(&current), "old");
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_publish_restores_missing_app() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("app.update-staging");
        let backup = root.join("app.update-backup");
        write_version(&backup, "old");
        recover_interrupted_publish(&current, &backup, &staging).unwrap();
        assert_eq!(version(&current), "old");
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_publish_prefers_backup() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("app.update-staging");
        let backup = root.join("app.update-backup");
        write_version(&current, "new");
        write_version(&backup, "old");
        write_version(&staging, "partial");
        recover_interrupted_publish(&current, &backup, &staging).unwrap();
        assert_eq!(version(&current), "old");
        assert!(!backup.exists());
        assert!(!staging.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recovery_cleans_staging_without_touching_app() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("app.update-staging");
        let backup = root.join("app.update-backup");
        write_version(&current, "current");
        write_version(&staging, "staging");
        recover_interrupted_publish(&current, &backup, &staging).unwrap();
        assert_eq!(version(&current), "current");
        assert!(!staging.exists());
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn recovery_rejects_invalid_live_pid_without_mutation() {
        let data = root();
        let manager = WebAppManager::new(&data);
        let current = manager.app_dir();
        let backup = manager.root.join("app.update-backup");
        write_version(&current, "new");
        write_version(&backup, "old");
        fs::create_dir_all(manager.pid_path().parent().unwrap()).unwrap();
        let process = PidRecord {
            pid: std::process::id(),
            starttime: crate::web_app::process::process_starttime(std::process::id()).unwrap(),
            script: current.join("wrong-script"),
            root: current.clone(),
        };
        fs::write(manager.pid_path(), serde_json::to_vec(&process).unwrap()).unwrap();
        assert!(manager.recover_interrupted_publish_locked().await.is_err());
        assert_eq!(version(&current), "new");
        assert_eq!(version(&backup), "old");
        assert!(manager.pid_path().exists());
        let _ = fs::remove_dir_all(data);
    }

    #[tokio::test]
    async fn recovery_removes_dead_pid_and_restores_backup() {
        let data = root();
        let manager = WebAppManager::new(&data);
        let current = manager.app_dir();
        let backup = manager.root.join("app.update-backup");
        write_version(&current, "new");
        write_version(&backup, "old");
        fs::create_dir_all(manager.pid_path().parent().unwrap()).unwrap();
        let process = PidRecord {
            pid: u32::MAX,
            starttime: 1,
            script: current.join("apps/daemon/dist/cli.js"),
            root: current.clone(),
        };
        fs::write(manager.pid_path(), serde_json::to_vec(&process).unwrap()).unwrap();
        manager.recover_interrupted_publish_locked().await.unwrap();
        assert_eq!(version(&current), "old");
        assert!(!backup.exists());
        assert!(!manager.pid_path().exists());
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn finalized_discard_does_not_roll_back_and_recovery_cleans_it() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("app.update-staging");
        let backup = root.join("app.update-backup");
        write_version(&current, "old");
        write_version(&staging, "new");
        let published = publish_directory(&staging, &current, &backup).unwrap();
        assert!(published.backup_retained);
        let discard = root.join(format!("app.update-discard-{}", uuid::Uuid::new_v4()));
        fs::rename(&backup, &discard).unwrap();
        fs::write(discard.join("partial"), "partial").unwrap();
        recover_interrupted_publish(&current, &backup, &staging).unwrap();
        assert_eq!(version(&current), "new");
        assert!(!backup.exists());
        cleanup_discarded_directories(&root);
        assert!(fs::read_dir(&root).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("app.update-discard-")
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_ignores_discard_symlink() {
        use std::os::unix::fs::symlink;

        let root = root();
        let outside = root.with_file_name(format!("devhatch-outside-{}", uuid::Uuid::new_v4()));
        write_version(&outside, "outside");
        fs::create_dir_all(&root).unwrap();
        let link = root.join(format!("app.update-discard-{}", uuid::Uuid::new_v4()));
        symlink(&outside, &link).unwrap();
        cleanup_discarded_directories(&root);
        assert!(link.exists());
        assert_eq!(version(&outside), "outside");
        let _ = fs::remove_file(link);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn finalize_rename_failure_keeps_recoverable_backup() {
        let root = root();
        let backup = root.join("app.update-backup");
        write_version(&backup, "old");
        let published = PublishedDirectory {
            backup_retained: true,
        };
        let result = finalize_publish_with(published, &backup, |_, _| {
            Err(std::io::Error::other("rename failed"))
        });
        assert!(result.is_err());
        assert_eq!(version(&backup), "old");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finalize_removes_backup_via_discard() {
        let root = root();
        let backup = root.join("app.update-backup");
        write_version(&backup, "old");
        finalize_publish(
            PublishedDirectory {
                backup_retained: true,
            },
            &backup,
        )
        .unwrap();
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restores_current_when_staging_rename_fails() {
        let root = root();
        let current = root.join("app");
        let staging = root.join("missing");
        let backup = root.join("app.update-backup");
        write_version(&current, "old");
        assert!(publish_directory(&staging, &current, &backup).is_err());
        assert_eq!(version(&current), "old");
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(root);
    }
}
