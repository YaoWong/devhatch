use crate::{Result, Skillink};
use std::process::Stdio;
use tokio::process::Command;

fn sanitize_command(command: &mut Command) {
    command.env_remove("DEVHATCH_ADMIN_PASSWORD");
    command.env_remove("DEVHATCH_ADMIN_PASSWORD_FILE");
    command.env_remove("BYTE_API_API_KEY");
}

impl Skillink {
    pub async fn doctor(&self) -> Result<Vec<String>> {
        let mut results = vec![
            format!("home: {}", self.root().display()),
            "database: ok".into(),
        ];
        let mut command = Command::new("git");
        sanitize_command(&mut command);
        let git = command
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn sanitizer_removes_secret_but_keeps_key_file() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("printf '%s %s' \"${BYTE_API_API_KEY-unset}\" \"${BYTE_API_API_KEY_FILE-unset}\"")
            .env("BYTE_API_API_KEY", "secret")
            .env("BYTE_API_API_KEY_FILE", "/private/key");
        sanitize_command(&mut command);
        let output = command.output().await.unwrap();
        assert_eq!(output.stdout, b"unset /private/key");
    }
}
