use std::{
    fs::{self, OpenOptions},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tokio::{io::AsyncReadExt, process::Command};

use crate::state::AppState;

const ID: &str = "open-design";
const NAME: &str = "OpenDesign";
const VERSION: &str = "0.18.2";
const REVISION: &str = "eea8a8522dfc10951ff3e3575488c83ffcad8a33";
const MANAGED_BRANCH: &str = "devhatch";
const REPOSITORY: &str = "https://github.com/nexu-io/open-design.git";
const PORT: u16 = 17456;
const DEFAULT_PUBLIC_URL: &str = "https://work.yaowong.top:8443";

pub(crate) struct WebAppManager {
    root: PathBuf,
    progress: RwLock<Progress>,
    update: RwLock<UpdateState>,
    child: Mutex<Option<std::process::Child>>,
    operation: tokio::sync::Mutex<()>,
    install_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

#[derive(Clone)]
struct Progress {
    phase: &'static str,
    percent: u8,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    error: Option<String>,
}

#[derive(Default)]
struct UpdateState {
    checking: bool,
    available: bool,
    current_revision: Option<String>,
    remote_revision: Option<String>,
    latest_version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Prerequisites {
    git: bool,
    node24: bool,
    corepack: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebAppView {
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
            progress: RwLock::new(Progress {
                phase: "not-installed",
                percent: 0,
                downloaded_bytes: None,
                total_bytes: None,
                error: None,
            }),
            update: RwLock::new(UpdateState::default()),
            child: Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
            install_task: Mutex::new(None),
        }
    }

    async fn view(&self) -> WebAppView {
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

    pub async fn start(&self) -> Result<(), String> {
        let _operation = self.operation.lock().await;
        if !self.installed() {
            return Err("OpenDesign is not installed".into());
        }
        if self.refresh_running().await {
            return Ok(());
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
        let app = self.app_dir();
        let mut command = std::process::Command::new(node);
        command
            .arg(app.join("apps/daemon/dist/cli.js"))
            .arg("--no-open")
            .current_dir(&app)
            .env("NODE_ENV", "production")
            .env("NODE_OPTIONS", "--max-old-space-size=512")
            .env("OD_BIND_HOST", "127.0.0.1")
            .env("OD_PORT", PORT.to_string())
            .env("OD_WEB_PORT", PORT.to_string())
            .env("OD_DATA_DIR", self.root.join("data"))
            .env("OD_ALLOWED_ORIGINS", public_url())
            .env_remove("BYTE_API_PROVIDER_ID")
            .env_remove("OPENCODE_CONFIG")
            .env_remove("OPENCODE_CONFIG_CONTENT")
            .env_remove("OPENCODE_CONFIG_DIR")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr));
        let child = command.spawn().map_err(|error| error.to_string())?;
        fs::create_dir_all(self.root.join("run")).map_err(|error| error.to_string())?;
        fs::write(self.pid_path(), child.id().to_string()).map_err(|error| error.to_string())?;
        *self.child.lock().expect("web app child lock poisoned") = Some(child);
        self.set_progress("starting", 95, None);
        for _ in 0..90 {
            if self.refresh_running().await {
                self.set_progress("running", 100, None);
                return Ok(());
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        self.stop_locked().await;
        Err("OpenDesign did not become ready within 90 seconds".into())
    }

    pub async fn stop(&self) {
        let _operation = self.operation.lock().await;
        self.stop_locked().await;
    }

    async fn stop_locked(&self) {
        let memory_pid = self
            .child
            .lock()
            .expect("web app child lock poisoned")
            .as_ref()
            .map(std::process::Child::id);
        let pid = memory_pid.or_else(|| self.persisted_pid().filter(|pid| process_matches(*pid)));
        if let Some(pid) = pid {
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .status();
            }
            for _ in 0..30 {
                if !process_exists(pid) {
                    break;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            let mut child = self
                .child
                .lock()
                .expect("web app child lock poisoned")
                .take();
            if process_exists(pid) {
                if let Some(child) = child.as_mut() {
                    let _ = child.kill();
                    let _ = child.wait();
                } else {
                    #[cfg(unix)]
                    let _ = std::process::Command::new("kill")
                        .args(["-KILL", &pid.to_string()])
                        .status();
                }
            } else if let Some(child) = child.as_mut() {
                let _ = child.wait();
            }
        }
        let _ = fs::remove_file(self.pid_path());
        if self.installed() {
            self.set_progress("stopped", 100, None);
        }
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

    fn installed_version(&self) -> String {
        fs::read(self.app_dir().join("package.json"))
            .ok()
            .and_then(|content| serde_json::from_slice::<serde_json::Value>(&content).ok())
            .and_then(|package| package.get("version")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| VERSION.to_string())
    }

    fn remote_version(&self) -> Result<String, String> {
        let package = self.git_output(["show", "origin/HEAD:package.json"])?;
        serde_json::from_str::<serde_json::Value>(&package)
            .ok()
            .and_then(|package| package.get("version")?.as_str().map(str::to_owned))
            .ok_or_else(|| "Unable to read the latest OpenDesign version".to_string())
    }

    fn git_output<const N: usize>(&self, args: [&str; N]) -> Result<String, String> {
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

    fn installed(&self) -> bool {
        self.app_dir().join("apps/daemon/dist/cli.js").is_file()
            && self.app_dir().join("apps/web/out/index.html").is_file()
    }

    fn app_dir(&self) -> PathBuf {
        self.root.join("app")
    }

    fn pid_path(&self) -> PathBuf {
        self.root.join("run/open-design.pid")
    }

    fn persisted_pid(&self) -> Option<u32> {
        fs::read_to_string(self.pid_path())
            .ok()?
            .trim()
            .parse()
            .ok()
    }

    pub async fn shutdown(&self) {
        let task = self
            .install_task
            .lock()
            .expect("install task lock poisoned")
            .take();
        if let Some(task) = task {
            task.abort();
            let _ = task.await;
        }
        self.stop().await;
    }

    async fn refresh_running(&self) -> bool {
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
            || self.persisted_pid().is_some_and(process_matches);
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

    async fn run_git_progress(
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
        let message = stderr
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        Err(if message.is_empty() {
            format!("Command failed with {status}")
        } else {
            message
        })
    }

    async fn run_install_command(&self, command: &mut Command) -> Result<(), String> {
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
        let message = stderr
            .lines()
            .rev()
            .take(8)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        Err(if message.is_empty() {
            format!("Command failed with {}", output.status)
        } else {
            message
        })
    }

    fn set_progress(&self, phase: &'static str, percent: u8, error: Option<String>) {
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

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    Json(serde_json::json!({ "webApps": [state.web_apps().view().await] })).into_response()
}

pub async fn install(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().begin_install() {
        Ok(()) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "accepted": true })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
    }
}

pub async fn check_update(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().check_update().await {
        Ok(()) => {
            Json(serde_json::json!({ "webApp": state.web_apps().view().await })).into_response()
        }
        Err(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "WEB_APP_UPDATE_CHECK_FAILED", "message": message })),
        )
            .into_response(),
    }
}

pub async fn update(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().begin_update() {
        Ok(()) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "accepted": true })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
    }
}

pub async fn start(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().start().await {
        Ok(()) => {
            Json(serde_json::json!({ "webApp": state.web_apps().view().await })).into_response()
        }
        Err(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "WEB_APP_START_FAILED", "message": message })),
        )
            .into_response(),
    }
}

pub async fn stop(State(state): State<Arc<AppState>>) -> Response {
    state.web_apps().stop().await;
    Json(serde_json::json!({ "webApp": state.web_apps().view().await })).into_response()
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

fn process_exists(pid: u32) -> bool {
    PathBuf::from(format!("/proc/{pid}")).exists()
}

fn process_matches(pid: u32) -> bool {
    fs::read(format!("/proc/{pid}/cmdline"))
        .ok()
        .is_some_and(|command| {
            command
                .windows(b"apps/daemon/dist/cli.js".len())
                .any(|part| part == b"apps/daemon/dist/cli.js")
        })
}

fn public_url() -> String {
    std::env::var("DEVHATCH_OPEN_DESIGN_URL").unwrap_or_else(|_| DEFAULT_PUBLIC_URL.to_string())
}

fn prerequisites() -> Prerequisites {
    Prerequisites {
        git: executable_on_path("git").is_some(),
        node24: node24_path().is_some(),
        corepack: node24_path()
            .and_then(|node| sibling_executable(&node, "corepack"))
            .is_some(),
    }
}

fn node24_path() -> Option<PathBuf> {
    let candidates = executable_candidates("node").chain([
        PathBuf::from("/home/linuxbrew/.linuxbrew/opt/node@24/bin/node"),
        PathBuf::from("/usr/local/opt/node@24/bin/node"),
        PathBuf::from("/opt/homebrew/opt/node@24/bin/node"),
    ]);
    candidates.filter(|path| path.is_file()).find(|path| {
        std::process::Command::new(path)
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim_start_matches('v')
                    .starts_with("24.")
            })
    })
}

fn executable_on_path(name: &str) -> Option<PathBuf> {
    executable_candidates(name).find(|path| path.is_file())
}

fn executable_candidates(name: &str) -> impl Iterator<Item = PathBuf> + '_ {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(move |path| path.join(name))
}

fn sibling_executable(executable: &Path, name: &str) -> Option<PathBuf> {
    executable
        .parent()
        .map(|parent| parent.join(name))
        .filter(|path| path.is_file())
}

fn prefixed_path(node: &Path) -> std::ffi::OsString {
    let mut paths = node
        .parent()
        .into_iter()
        .map(Path::to_path_buf)
        .collect::<Vec<_>>();
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{PORT, parse_git_progress, prefixed_path};
    use std::path::Path;

    #[test]
    fn parses_git_download_progress() {
        assert_eq!(
            parse_git_progress("Receiving objects:  50% (100/200), 12.50 MiB | 2.00 MiB/s"),
            Some((50, Some(13_107_200)))
        );
    }

    #[test]
    fn prefixes_node_directory_for_installer_commands() {
        let path = prefixed_path(Path::new("/opt/node24/bin/node"));
        assert!(path.to_string_lossy().starts_with("/opt/node24/bin"));
        assert_eq!(PORT, 17456);
    }
}
