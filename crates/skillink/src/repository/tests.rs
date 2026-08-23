use super::discovery::discover_repository;
use crate::{Repository, Skillink};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command as StdCommand,
};
use tempfile::TempDir;
use uuid::Uuid;

mod discovery;
mod migration;
mod plan;
mod repository;
mod sync;

fn write_skill(root: &Path, relative: &str, manifest: &str) {
    let directory = if relative == "." {
        root.to_owned()
    } else {
        root.join(relative)
    };
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("SKILL.md"), manifest).unwrap();
}

fn git(repository: &Path, arguments: &[&str]) -> String {
    let output = StdCommand::new("git")
        .args(["-C", repository.to_str().unwrap()])
        .args(arguments)
        .env("GIT_AUTHOR_NAME", "Skillink Test")
        .env("GIT_AUTHOR_EMAIL", "skillink@example.com")
        .env("GIT_COMMITTER_NAME", "Skillink Test")
        .env("GIT_COMMITTER_EMAIL", "skillink@example.com")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn commit(repository: &Path, message: &str) -> String {
    git(repository, &["add", "."]);
    git(repository, &["commit", "-m", message]);
    git(repository, &["rev-parse", "HEAD"])
}

async fn initialized_repository(temp: &TempDir, manifest: &str) -> (Skillink, PathBuf, Repository) {
    let source = temp.path().join("source");
    fs::create_dir(&source).unwrap();
    git(&source, &["init", "--initial-branch=main"]);
    write_skill(&source, "skills/alpha", manifest);
    commit(&source, "initial");
    let app = Skillink::open(Some(temp.path().join("home")))
        .await
        .unwrap();
    let id = Uuid::new_v4().to_string();
    let url = source.to_str().unwrap();
    let (revision, checkout) = app.clone_repository(url, Some("main"), true).await.unwrap();
    let discovered = discover_repository(&checkout).unwrap();
    app.publish_revision(&checkout, &app.repository_revision(&id, &revision))
        .unwrap();
    app.insert_repository(&id, url, url, Some("main"), &revision, &discovered)
        .await
        .unwrap();
    let repository = app.get_repository(&id).await.unwrap();
    (app, source, repository)
}
