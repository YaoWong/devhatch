#[tokio::test]
async fn repository_sync_migration_adds_constraints() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../../migrations/0001_initial.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("../../../migrations/0002_repository_sync.sql"))
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
