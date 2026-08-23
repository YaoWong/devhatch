use crate::{Result, repository_name};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{path::Path, str::FromStr, time::Duration};

pub(crate) async fn open(root: &Path) -> Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(&format!(
        "sqlite://{}",
        root.join("skillink.sqlite3").display()
    ))?
    .create_if_missing(true)
    .foreign_keys(true)
    .journal_mode(SqliteJournalMode::Wal)
    .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    repair_legacy_initial_migration(&pool).await?;
    sqlx::migrate!().run(&pool).await?;
    backfill_repository_names(&pool).await?;
    Ok(pool)
}

async fn repair_legacy_initial_migration(pool: &SqlitePool) -> Result<()> {
    const LEGACY_CHECKSUM: &str = "64954324754615F862E588848BC71DB957EA51A1F23B1596EF42AE89A50A72FF37CA85D78D98A5A947420F15D93EFE54";
    let table_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_one(pool)
    .await?;
    if table_exists == 0 {
        return Ok(());
    }
    let migration: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT checksum FROM _sqlx_migrations WHERE version = 1 AND success = 1")
            .fetch_optional(pool)
            .await?;
    let Some((checksum,)) = migration else {
        return Ok(());
    };
    if checksum != decode_checksum(LEGACY_CHECKSUM) {
        return Ok(());
    }
    let sync_version_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('repositories') WHERE name = 'sync_version'",
    )
    .fetch_one(pool)
    .await?;
    let sync_indexes: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('skills_repository_relative_path_unique', 'skills_repository_id_index', 'profile_skills_skill_id_index')",
    )
    .fetch_one(pool)
    .await?;
    if sync_version_exists != 1 || sync_indexes != 3 {
        return Ok(());
    }
    let current_checksum = decode_checksum(
        "4B64B679F830B3BEF81C25C1B6031521D7737FCD0C4F8648901C595A74B8D442F8870C6A16AF3283AAD1DC6A4D6E6F21",
    );
    sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 1")
        .bind(current_checksum)
        .execute(pool)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (2, 'repository sync', 1, ?, 0)")
        .bind(decode_checksum("B344C16919EC76B7E6EAB1B43D2EDD4A1EBAE7F860A689A575FAE55409B1E52DC47F91D64918EC15946979219E21AFD3"))
        .execute(pool)
        .await?;
    Ok(())
}

fn decode_checksum(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).expect("checksum is ASCII");
            u8::from_str_radix(text, 16).expect("checksum is hexadecimal")
        })
        .collect()
}

async fn backfill_repository_names(pool: &SqlitePool) -> Result<()> {
    let repositories: Vec<(String, String)> =
        sqlx::query_as("SELECT id, url FROM repositories WHERE name IS NULL OR trim(name) = ''")
            .fetch_all(pool)
            .await?;
    for (id, url) in repositories {
        sqlx::query("UPDATE repositories SET name = ? WHERE id = ?")
            .bind(repository_name(&url))
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}
