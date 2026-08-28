use crate::{Result, Skillink};
use std::process::Stdio;
use tokio::process::Command;

impl Skillink {
    pub async fn doctor(&self) -> Result<Vec<String>> {
        let mut results = vec![
            format!("home: {}", self.root().display()),
            "database: ok".into(),
        ];
        let git = Command::new("git")
            .env_remove("DEVHATCH_ADMIN_PASSWORD")
            .env_remove("DEVHATCH_ADMIN_PASSWORD_FILE")
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await;
        match git {
            Ok(output) if output.status.success() => {
                results.push(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            }
            _ => results.push("git: unavailable".into()),
        }
        Ok(results)
    }
}
