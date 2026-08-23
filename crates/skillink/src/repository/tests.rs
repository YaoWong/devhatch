use super::{
    discovery::{DiscoveredSkill, discover_repository},
    store::ExistingSkill,
    sync::build_plan,
};
use crate::{Error, Repository, Skillink};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command as StdCommand,
};
use tempfile::TempDir;
use uuid::Uuid;

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
    app.insert_repository(&id, url, Some("main"), &revision, &discovered)
        .await
        .unwrap();
    let repository = app.get_repository(&id).await.unwrap();
    (app, source, repository)
}

#[test]
fn discovers_nested_skill_directories() {
    let temp = TempDir::new().unwrap();
    write_skill(
        temp.path(),
        ".",
        "---\nname: root-skill\ndescription: Root\n---\n",
    );
    write_skill(temp.path(), "skills/alpha", "---\ndescription: A\n---\n");
    write_skill(
        temp.path(),
        "skills/engineering/nested",
        "---\nname: nested\ndescription: Nested\n---\n",
    );
    write_skill(temp.path(), "other", "---\nname: other\n---\n");
    let discovered = discover_repository(temp.path()).unwrap();
    assert_eq!(
        discovered
            .iter()
            .map(|skill| (skill.slug.as_str(), skill.relative_path.as_str()))
            .collect::<Vec<_>>(),
        [
            ("root-skill", "."),
            ("alpha", "skills/alpha"),
            ("nested", "skills/engineering/nested"),
        ]
    );
}

#[test]
fn rejects_duplicate_slug_and_invalid_manifests() {
    let temp = TempDir::new().unwrap();
    write_skill(temp.path(), "skills/a", "---\nname: duplicate\n---\n");
    write_skill(temp.path(), "skills/b", "---\nname: duplicate\n---\n");
    assert!(
        matches!(discover_repository(temp.path()), Err(Error::DuplicateRepositorySlug { slug, paths }) if slug == "duplicate" && paths == ["skills/a", "skills/b"])
    );
    fs::remove_dir_all(temp.path().join("skills/b")).unwrap();
    fs::write(
        temp.path().join("skills/a/SKILL.md"),
        "---\nname: Invalid_Name\n---\n",
    )
    .unwrap();
    assert!(matches!(
        discover_repository(temp.path()),
        Err(Error::Manifest { .. })
    ));
    fs::write(temp.path().join("skills/a/SKILL.md"), "---\nname: valid").unwrap();
    assert!(matches!(
        discover_repository(temp.path()),
        Err(Error::Manifest { .. })
    ));
}

#[test]
fn same_commit_reconciles_discovery_changes() {
    let existing = vec![ExistingSkill {
        id: "stable-id".into(),
        slug: "alpha".into(),
        description: String::new(),
        relative_path: "skills/alpha".into(),
    }];
    let discovered = vec![
        DiscoveredSkill {
            slug: "alpha".into(),
            description: String::new(),
            relative_path: "skills/alpha".into(),
        },
        DiscoveredSkill {
            slug: "nested".into(),
            description: String::new(),
            relative_path: "skills/engineering/nested".into(),
        },
    ];
    let commit = "1".repeat(40);
    let plan = build_plan(
        "repository",
        Some(commit.clone()),
        commit,
        &existing,
        &discovered,
    );
    assert!(!plan.noop);
    assert_eq!(plan.add.len(), 1);
    assert!(plan.update.is_empty());
    assert!(plan.remove.is_empty());
}

#[test]
fn path_move_plan_is_remove_and_add() {
    let existing = vec![ExistingSkill {
        id: "stable-id".into(),
        slug: "alpha".into(),
        description: String::new(),
        relative_path: "skills/alpha".into(),
    }];
    let discovered = vec![DiscoveredSkill {
        slug: "alpha".into(),
        description: String::new(),
        relative_path: "skills/moved".into(),
    }];
    let plan = build_plan(
        "repository",
        Some("1".repeat(40)),
        "2".repeat(40),
        &existing,
        &discovered,
    );
    assert_eq!(plan.add.len(), 1);
    assert_eq!(plan.remove.len(), 1);
    assert!(plan.update.is_empty());
}

#[tokio::test]
async fn noop_and_dry_run_leave_state_and_staging_unchanged() {
    let temp = TempDir::new().unwrap();
    let (app, source, repository) = initialized_repository(&temp, "---\nname: alpha\n---\n").await;
    let plan = app
        .prepare_repository_sync(&repository.id, true)
        .await
        .unwrap();
    assert!(plan.plan.noop);
    drop(plan);
    assert!(
        fs::read_dir(app.root().join("staging"))
            .unwrap()
            .next()
            .is_none()
    );
    write_skill(&source, "skills/alpha", "---\nname: beta\n---\n");
    let new_commit = commit(&source, "preview");
    let preview = app
        .prepare_repository_sync(&repository.id, true)
        .await
        .unwrap();
    assert!(!preview.plan.noop);
    assert_eq!(preview.plan.new_commit, new_commit);
    assert_eq!(preview.plan.update.len(), 1);
    drop(preview);
    assert!(
        fs::read_dir(app.root().join("staging"))
            .unwrap()
            .next()
            .is_none()
    );
    assert!(
        !app.repository_revision(&repository.id, &new_commit)
            .exists()
    );
    let current = app.get_repository(&repository.id).await.unwrap();
    assert_eq!(current.commit_hash, repository.commit_hash);
    assert_eq!(current.sync_version, 0);
    assert_eq!(app.list_skills().await.unwrap()[0].slug, "alpha");
}

#[tokio::test]
async fn sync_preserves_identity_on_slug_rename() {
    let temp = TempDir::new().unwrap();
    let (app, source, repository) = initialized_repository(&temp, "---\nname: alpha\n---\n").await;
    let old = app.list_skills().await.unwrap().remove(0);
    let profile = app.create_profile("default").await.unwrap();
    app.enable_skill(&profile.id, &old.id).await.unwrap();
    write_skill(&source, "skills/alpha", "---\nname: renamed\n---\n");
    let new_commit = commit(&source, "rename");
    let result = app
        .sync_repository_with_transport(&repository.id, true)
        .await
        .unwrap();
    assert_eq!(result.new_commit, new_commit);
    assert_eq!(result.update.len(), 1);
    let new = app.list_skills().await.unwrap().remove(0);
    assert_eq!(new.id, old.id);
    assert_eq!(new.slug, "renamed");
    assert_eq!(
        app.show_profile(&profile.id).await.unwrap().skills[0].id,
        old.id
    );
    assert_eq!(
        app.get_repository(&repository.id)
            .await
            .unwrap()
            .sync_version,
        1
    );
}

#[tokio::test]
async fn path_move_in_use_is_atomic() {
    let temp = TempDir::new().unwrap();
    let (app, source, repository) = initialized_repository(&temp, "---\nname: alpha\n---\n").await;
    let old = app.list_skills().await.unwrap().remove(0);
    let profile = app.create_profile("default").await.unwrap();
    app.enable_skill(&profile.id, &old.id).await.unwrap();
    fs::rename(source.join("skills/alpha"), source.join("skills/moved")).unwrap();
    commit(&source, "move");
    let error = app
        .sync_repository_with_transport(&repository.id, true)
        .await
        .unwrap_err();
    assert!(matches!(error, Error::RepositorySkillInUse { .. }));
    assert_eq!(
        app.get_repository(&repository.id)
            .await
            .unwrap()
            .commit_hash,
        repository.commit_hash
    );
    assert_eq!(app.list_skills().await.unwrap()[0].id, old.id);
}

#[tokio::test]
async fn discovery_failure_and_stale_snapshot_do_not_mutate_database() {
    let temp = TempDir::new().unwrap();
    let (app, source, repository) = initialized_repository(&temp, "---\nname: alpha\n---\n").await;
    fs::write(source.join("skills/alpha/SKILL.md"), "---\nname: bad").unwrap();
    commit(&source, "invalid");
    assert!(matches!(
        app.sync_repository_with_transport(&repository.id, true)
            .await,
        Err(Error::Manifest { .. })
    ));
    assert_eq!(
        app.get_repository(&repository.id)
            .await
            .unwrap()
            .commit_hash,
        repository.commit_hash
    );
    write_skill(&source, "skills/alpha", "---\nname: beta\n---\n");
    commit(&source, "valid");
    let prepared = app
        .prepare_repository_sync(&repository.id, true)
        .await
        .unwrap();
    sqlx::query("UPDATE repositories SET sync_version = sync_version + 1 WHERE id = ?")
        .bind(&repository.id)
        .execute(app.pool())
        .await
        .unwrap();
    assert!(matches!(
        app.reconcile_repository(&prepared).await,
        Err(Error::ConcurrentSync { .. })
    ));
    assert_eq!(app.list_skills().await.unwrap()[0].slug, "alpha");
}

#[tokio::test]
async fn repository_sync_migration_adds_constraints() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0001_initial.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../migrations/0002_repository_sync.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO repositories (id, url, commit_hash) VALUES ('repository', 'https://example.com/repository.git', ?)").bind("1".repeat(40)).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES ('skill', 'alpha', '', 'repository', 'repository', ?, 'skills/alpha')").bind("1".repeat(40)).execute(&pool).await.unwrap();
    let row: (String, i64) = sqlx::query_as(
        "SELECT commit_hash, sync_version FROM repositories WHERE id = 'repository'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row, ("1".repeat(40), 0));
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT id FROM skills WHERE id = 'skill'")
            .fetch_one(&pool)
            .await
            .unwrap(),
        "skill"
    );
    let duplicate = sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES ('duplicate', 'beta', '', 'repository', 'repository', ?, 'skills/alpha')").bind("1".repeat(40)).execute(&pool).await;
    assert!(matches!(duplicate, Err(sqlx::Error::Database(error)) if error.is_unique_violation()));
    let indexes: Vec<String> = sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('skills_repository_relative_path_unique', 'profile_skills_skill_id_index', 'skills_repository_id_index') ORDER BY name").fetch_all(&pool).await.unwrap();
    assert_eq!(indexes.len(), 3);
}
