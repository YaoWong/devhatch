use crate::{Error, Result, Skillink};
use std::{fs, path::PathBuf, process::Stdio};
use tokio::process::Command;

impl Skillink {
    pub(super) async fn clone_repository(
        &self,
        url: &str,
        git_ref: Option<&str>,
        local: bool,
    ) -> Result<(String, PathBuf)> {
        let checkout = self.staging_path();
        let mut command = Command::new("git");
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", "")
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .args([
                "-c",
                "protocol.allow=never",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "filter.lfs.smudge=",
                "-c",
                "filter.lfs.required=false",
            ]);
        if local {
            command.args(["-c", "protocol.file.allow=always"]);
        } else {
            command
                .env("GIT_ALLOW_PROTOCOL", "http:https:ssh")
                .env(
                    "GIT_SSH_COMMAND",
                    "ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes",
                )
                .args([
                    "-c",
                    "protocol.http.allow=always",
                    "-c",
                    "protocol.https.allow=always",
                    "-c",
                    "protocol.ssh.allow=always",
                ]);
        }
        command.args(["clone", "--no-tags"]);
        if let Some(git_ref) = git_ref {
            command.args(["--branch", git_ref]);
        }
        command.arg("--").arg(url).arg(&checkout);
        let output = command.output().await?;
        if !output.status.success() {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let output = Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .args(["-C"])
            .arg(&checkout)
            .args(["rev-parse", "HEAD"])
            .stdout(Stdio::piped())
            .output()
            .await?;
        if !output.status.success() {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let commit = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if !valid_commit(&commit) {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git("git returned an invalid commit hash".into()));
        }
        Ok((commit, checkout))
    }
}

pub(super) fn valid_commit(commit: &str) -> bool {
    commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
}
