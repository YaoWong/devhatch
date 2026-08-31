#[tokio::test]
async fn baseline_has_final_schema_and_constraints() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    sqlx::migrate!().run(&pool).await.unwrap();

    sqlx::query("INSERT INTO repositories (id, name, url, commit_hash) VALUES ('repository', 'Repository', 'https://example.com/repository.git', ?)")
        .bind("1".repeat(40))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES ('skill', 'alpha', '', 'repository', 'repository', ?, 'skills/alpha')")
        .bind("1".repeat(40))
        .execute(&pool)
        .await
        .unwrap();
    let row: (String, String, i64) = sqlx::query_as(
        "SELECT name, commit_hash, sync_version FROM repositories WHERE id = 'repository'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row, ("Repository".into(), "1".repeat(40), 0));

    for name in ["", "   "] {
        let result = sqlx::query(
            "INSERT INTO repositories (id, name, url, commit_hash) VALUES (?, ?, ?, ?)",
        )
        .bind(format!("invalid-{name}"))
        .bind(name)
        .bind(format!("https://example.com/{name}.git"))
        .bind("2".repeat(40))
        .execute(&pool)
        .await;
        assert!(result.is_err());
    }
    let duplicate = sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES ('duplicate', 'beta', '', 'repository', 'repository', ?, 'skills/alpha')")
        .bind("1".repeat(40))
        .execute(&pool)
        .await;
    assert!(matches!(duplicate, Err(sqlx::Error::Database(error)) if error.is_unique_violation()));
    let indexes: Vec<String> = sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('skills_repository_relative_path_unique', 'profile_skills_skill_id_index', 'skills_repository_id_index') ORDER BY name")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(indexes.len(), 3);
    let migrations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(migrations, 1);
}
