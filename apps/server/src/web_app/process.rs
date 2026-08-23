use std::{
    fs::{self, OpenOptions},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::PathBuf,
    process::Stdio,
    time::Duration,
};

use super::environment::{node24_path, public_url};
use super::{PORT, WebAppManager};

impl WebAppManager {
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

    pub(super) async fn stop_locked(&self) {
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
