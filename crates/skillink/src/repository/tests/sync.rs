use super::{commit, initialized_repository, write_skill};
use crate::Error;
use std::fs;
use tempfile::TempDir;

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
        app.reconcile_repository(&prepared.repository, &prepared.discovered, &prepared.plan)
            .await,
        Err(Error::ConcurrentSync { .. })
    ));
    assert_eq!(app.list_skills().await.unwrap()[0].slug, "alpha");
}
