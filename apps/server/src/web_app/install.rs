use std::{fs, sync::Arc};

use tokio::process::Command;

use super::environment::{executable_on_path, node24_path, prefixed_path, sibling_executable};
use super::{MANAGED_BRANCH, REPOSITORY, REVISION, WebAppManager};

impl WebAppManager {
    pub fn begin_install(self: &Arc<Self>) -> Result<(), &'static str> {
        if self.installed() {
            return Err("WEB_APP_ALREADY_INSTALLED");
        }
        {
            let mut progress = self
                .progress
                .write()
                .expect("web app progress lock poisoned");
            if matches!(
                progress.phase,
                "preparing" | "downloading" | "installing" | "building"
            ) {
                return Err("WEB_APP_INSTALL_IN_PROGRESS");
            }
            progress.phase = "preparing";
            progress.percent = 3;
            progress.downloaded_bytes = None;
            progress.total_bytes = None;
            progress.error = None;
        }
        let manager = self.clone();
        let task = tokio::spawn(async move {
            if let Err(error) = manager.install().await {
                manager.set_progress("failed", 0, Some(error));
            }
        });
        *self
            .install_task
            .lock()
            .expect("install task lock poisoned") = Some(task);
        Ok(())
    }

    pub async fn check_update(&self) -> Result<(), String> {
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
            let current = self.git_output(["rev-parse", "HEAD"])?;
            let remote = self.git_output(["rev-parse", "origin/HEAD"])?;
            let installed_version = self.installed_version();
            let latest_version = self.remote_version()?;
            let update_available = installed_version != latest_version;
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
        if !self.installed() {
            return Err("WEB_APP_NOT_INSTALLED");
        }
        {
            let mut progress = self
                .progress
                .write()
                .expect("web app progress lock poisoned");
            if matches!(
                progress.phase,
                "updating" | "installing-update" | "building-update"
            ) {
                return Err("WEB_APP_UPDATE_IN_PROGRESS");
            }
            progress.phase = "updating";
            progress.percent = 10;
            progress.downloaded_bytes = None;
            progress.total_bytes = None;
            progress.error = None;
        }
        let manager = self.clone();
        let task = tokio::spawn(async move {
            if let Err(error) = manager.update().await {
                manager.set_progress("failed", 0, Some(error));
            }
        });
        *self
            .install_task
            .lock()
            .expect("install task lock poisoned") = Some(task);
        Ok(())
    }

    async fn update(&self) -> Result<(), String> {
        let node = node24_path().ok_or_else(|| "Node.js 24 is required".to_string())?;
        let corepack = sibling_executable(&node, "corepack")
            .ok_or_else(|| "Corepack is required".to_string())?;
        let was_running;
        {
            let _operation = self.operation.lock().await;
            was_running = self.refresh_running().await;
            if was_running {
                self.stop_locked().await;
            }
            let app = self.app_dir();
            if !self.git_output(["status", "--porcelain"])?.is_empty() {
                return Err("OpenDesign has local changes; update was cancelled".into());
            }
            self.run_git_progress(
                Command::new("git")
                    .args(["fetch", "--progress", "--prune", "origin"])
                    .current_dir(&app),
                10,
                35,
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["checkout", "-B", MANAGED_BRANCH, "HEAD"])
                    .current_dir(&app),
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["branch", "--set-upstream-to", "origin/HEAD", MANAGED_BRANCH])
                    .current_dir(&app),
            )
            .await?;
            self.run_install_command(
                Command::new("git")
                    .args(["pull", "--ff-only"])
                    .current_dir(&app),
            )
            .await?;
            let path = prefixed_path(&node);
            self.set_progress("installing-update", 45, None);
            self.run_install_command(
                Command::new(&corepack)
                    .args(["pnpm@10.33.2", "install", "--frozen-lockfile"])
                    .env("PATH", &path)
                    .current_dir(&app),
            )
            .await?;
            self.set_progress("building-update", 70, None);
            self.run_install_command(
                Command::new(&corepack)
                    .args(["pnpm@10.33.2", "--filter", "@open-design/daemon", "build"])
                    .env("PATH", &path)
                    .current_dir(&app),
            )
            .await?;
            self.set_progress("building-update", 85, None);
            self.run_install_command(
                Command::new(&corepack)
                    .args(["pnpm@10.33.2", "--filter", "@open-design/web", "build"])
                    .env("PATH", &path)
                    .current_dir(&app),
            )
            .await?;
            if !self.installed() {
                return Err("OpenDesign build artifacts are incomplete".into());
            }
            let revision = self.git_output(["rev-parse", "HEAD"])?;
            let mut update = self.update.write().expect("web app update lock poisoned");
            update.current_revision = Some(revision.clone());
            update.remote_revision = Some(revision);
            update.latest_version = Some(self.installed_version());
            update.available = false;
            self.set_progress("stopped", 100, None);
        }
        if was_running {
            self.start().await?;
        }
        Ok(())
    }

    async fn install(&self) -> Result<(), String> {
        let node = node24_path().ok_or_else(|| "Node.js 24 is required".to_string())?;
        let corepack = sibling_executable(&node, "corepack")
            .ok_or_else(|| "Corepack is required".to_string())?;
        if executable_on_path("git").is_none() {
            return Err("Git is required".into());
        }
        fs::create_dir_all(&self.root).map_err(|error| error.to_string())?;
        let staging = self.root.join("staging");
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|error| error.to_string())?;
        }
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
        let path = prefixed_path(&node);
        self.set_progress("installing", 45, None);
        self.run_install_command(
            Command::new(&corepack)
                .args(["pnpm@10.33.2", "install", "--frozen-lockfile"])
                .env("PATH", &path)
                .current_dir(&staging),
        )
        .await?;
        self.set_progress("building", 70, None);
        self.run_install_command(
            Command::new(&corepack)
                .args(["pnpm@10.33.2", "--filter", "@open-design/daemon", "build"])
                .env("PATH", &path)
                .current_dir(&staging),
        )
        .await?;
        self.run_install_command(
            Command::new(&corepack)
                .args(["pnpm@10.33.2", "--filter", "@open-design/web", "build"])
                .env("PATH", &path)
                .current_dir(&staging),
        )
        .await?;
        if !staging.join("apps/daemon/dist/cli.js").is_file()
            || !staging.join("apps/web/out/index.html").is_file()
        {
            return Err("OpenDesign build artifacts are incomplete".into());
        }
        let app = self.app_dir();
        if app.exists() {
            fs::remove_dir_all(&app).map_err(|error| error.to_string())?;
        }
        fs::rename(&staging, &app).map_err(|error| error.to_string())?;
        fs::create_dir_all(self.root.join("data")).map_err(|error| error.to_string())?;
        self.set_progress("stopped", 100, None);
        Ok(())
    }
}
