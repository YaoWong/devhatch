use std::{fs, path::Path};

use serde::Serialize;

use super::environment::{Prerequisites, prerequisites, public_url};
use super::{ID, NAME, Progress, UpdateState, VERSION, WebAppManager};

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

impl WebAppManager {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            root: data_dir.join("webapps/open-design"),
            progress: std::sync::RwLock::new(Progress {
                phase: "not-installed",
                percent: 0,
                downloaded_bytes: None,
                total_bytes: None,
                error: None,
            }),
            update: std::sync::RwLock::new(UpdateState::default()),
            child: std::sync::Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
            install_task: std::sync::Mutex::new(None),
        }
    }

    pub(super) async fn view(&self) -> WebAppView {
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
            prerequisites: prerequisites(),
        }
    }

    pub(super) fn installed_version(&self) -> String {
        fs::read(self.app_dir().join("package.json"))
            .ok()
            .and_then(|content| serde_json::from_slice::<serde_json::Value>(&content).ok())
            .and_then(|package| package.get("version")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| VERSION.to_string())
    }

    pub(super) fn remote_version(&self) -> Result<String, String> {
        let package = self.git_output(["show", "origin/HEAD:package.json"])?;
        serde_json::from_str::<serde_json::Value>(&package)
            .ok()
            .and_then(|package| package.get("version")?.as_str().map(str::to_owned))
            .ok_or_else(|| "Unable to read the latest OpenDesign version".to_string())
    }

    pub(super) fn git_output<const N: usize>(&self, args: [&str; N]) -> Result<String, String> {
        let output = std::process::Command::new("git")
            .args(args)
            .current_dir(self.app_dir())
            .output()
            .map_err(|error| error.to_string())?;
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

    pub(super) fn persisted_pid(&self) -> Option<u32> {
        fs::read_to_string(self.pid_path())
            .ok()?
            .trim()
            .parse()
            .ok()
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
