use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use axum::http::StatusCode;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use uuid::Uuid;

#[cfg(unix)]
use std::{
    fs::OpenOptions,
    os::{
        fd::AsRawFd,
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
};

use super::{DeleteError, HistoryError, HistoryItem, PreparedLaunch, Presence};
use crate::{
    agent::{self, CODEX_ID},
    filesystem::home_dir,
    state::AppState,
};

const REQUIRED_COLUMNS: &[&str] = &[
    "id",
    "rollout_path",
    "created_at",
    "updated_at",
    "cwd",
    "title",
    "archived",
];

#[derive(Clone, Copy)]
struct Schema {
    created_at_ms: bool,
    updated_at_ms: bool,
    recency_at_ms: bool,
    first_user_message: bool,
    preview: bool,
    name: bool,
    source: bool,
    has_user_event: bool,
}

fn thread_filter(schema: Schema) -> String {
    let visible = if schema.preview {
        "NULLIF(TRIM(preview), '') IS NOT NULL"
    } else if schema.first_user_message {
        "NULLIF(TRIM(first_user_message), '') IS NOT NULL"
    } else if schema.has_user_event {
        "has_user_event != 0 AND NULLIF(TRIM(title), '') IS NOT NULL"
    } else {
        "NULLIF(TRIM(title), '') IS NOT NULL"
    };
    let source = if schema.source {
        " AND ((typeof(source) = 'integer' AND source IN (0, 1, 4)) OR (typeof(source) = 'text' AND lower(trim(source)) IN ('cli', 'vscode', 'unknown')))"
    } else {
        ""
    };
    format!("COALESCE(archived, 0) = 0 AND {visible}{source}")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionRecord {
    pub(crate) id: String,
    pub(crate) path: PathBuf,
    pub(crate) cwd: PathBuf,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WriterLock {
    Inactive,
    Held,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BaselineError {
    Missing,
    Unavailable,
}

pub(crate) fn resolve_home() -> PathBuf {
    resolve_home_from(
        env::var_os("CODEX_HOME"),
        &home_dir(),
        &env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
    )
}

fn resolve_home_from(value: Option<OsString>, home: &Path, current_dir: &Path) -> PathBuf {
    let path = value
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    if path.is_absolute() {
        path
    } else {
        current_dir.join(path)
    }
}

pub(crate) async fn list(state: &AppState) -> Result<Vec<HistoryItem>, &'static str> {
    let home = resolve_home();
    let pool = open_pool(&home)
        .await
        .map_err(|_| "CODEX_HISTORY_DATABASE_NOT_FOUND")?;
    let schema = validate_schema(&pool).await?;
    let rows = query_rows(&pool, schema).await?;
    let active_ids = state.active_upstream_session_ids_for(CODEX_ID);
    let active_files = state.active_upstream_session_files_for(CODEX_ID);
    let home_for_locks = home.clone();
    tokio::task::spawn_blocking(move || {
        rows.into_iter()
            .map(|row| {
                let id: String = row
                    .try_get("id")
                    .map_err(|_| "CODEX_HISTORY_QUERY_FAILED")?;
                if !valid_session_id(&id) {
                    return Err("CODEX_HISTORY_UNAVAILABLE");
                }
                let path = row
                    .try_get::<String, _>("rollout_path")
                    .ok()
                    .map(PathBuf::from);
                let presence = if active_ids.contains(&id)
                    || path
                        .as_ref()
                        .is_some_and(|path| active_files.contains(path))
                {
                    Presence::ActiveHere
                } else {
                    match writer_lock(&home_for_locks, &id)
                        .map_err(|_| "CODEX_HISTORY_LOCKS_UNAVAILABLE")?
                    {
                        WriterLock::Held => Presence::PossiblyActiveElsewhere,
                        WriterLock::Inactive => Presence::Inactive,
                    }
                };
                Ok(HistoryItem {
                    id,
                    title: row
                        .try_get("display_title")
                        .map_err(|_| "CODEX_HISTORY_QUERY_FAILED")?,
                    directory: row
                        .try_get("cwd")
                        .map_err(|_| "CODEX_HISTORY_QUERY_FAILED")?,
                    project_id: None,
                    project_name: None,
                    project_worktree: None,
                    time_created: row
                        .try_get("time_created")
                        .map_err(|_| "CODEX_HISTORY_QUERY_FAILED")?,
                    time_updated: row
                        .try_get("time_updated")
                        .map_err(|_| "CODEX_HISTORY_QUERY_FAILED")?,
                    presence,
                })
            })
            .collect()
    })
    .await
    .map_err(|_| "CODEX_HISTORY_UNAVAILABLE")?
}

async fn query_rows(
    pool: &SqlitePool,
    schema: Schema,
) -> Result<Vec<sqlx::sqlite::SqliteRow>, &'static str> {
    let created = if schema.created_at_ms {
        "COALESCE(created_at_ms, created_at * 1000, 0)"
    } else {
        "COALESCE(created_at * 1000, 0)"
    };
    let updated = if schema.updated_at_ms {
        "COALESCE(updated_at_ms, updated_at * 1000, 0)"
    } else {
        "COALESCE(updated_at * 1000, 0)"
    };
    let name = if schema.name {
        "NULLIF(TRIM(name), '')"
    } else {
        "NULL"
    };
    let recency = if schema.recency_at_ms {
        if schema.updated_at_ms {
            "COALESCE(recency_at_ms, updated_at_ms, updated_at * 1000, 0)"
        } else {
            "COALESCE(recency_at_ms, updated_at * 1000, 0)"
        }
    } else {
        updated
    };
    let filter = thread_filter(schema);
    let query = format!(
        "SELECT id, cwd, rollout_path, COALESCE({name}, NULLIF(TRIM(title), ''), '(no messages)') AS display_title, {created} AS time_created, {updated} AS time_updated, {recency} AS recency FROM threads WHERE {filter} ORDER BY recency DESC, id DESC"
    );
    sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|_| "CODEX_HISTORY_QUERY_FAILED")
}

pub(crate) async fn prepare(requested_id: Option<&str>) -> Result<PreparedLaunch, HistoryError> {
    prepare_from(resolve_home(), requested_id).await
}

async fn prepare_from(
    home: PathBuf,
    requested_id: Option<&str>,
) -> Result<PreparedLaunch, HistoryError> {
    match requested_id {
        None => {
            let baseline = match eligible_ids(&home).await {
                Ok(ids) => ids,
                Err(BaselineError::Missing) => HashSet::new(),
                Err(BaselineError::Unavailable) => return Err(HistoryError::Unavailable),
            };
            Ok(PreparedLaunch::CodexNew { baseline, home })
        }
        Some(id) => {
            let record = lookup(home.clone(), id.to_string()).await?;
            let lock_home = home.clone();
            let lock_id = record.id.clone();
            match tokio::task::spawn_blocking(move || writer_lock(&lock_home, &lock_id))
                .await
                .map_err(|_| HistoryError::Unavailable)?
                .map_err(|_| HistoryError::Unavailable)?
            {
                WriterLock::Held => return Err(HistoryError::ExternalActive),
                WriterLock::Inactive => {}
            }
            Ok(PreparedLaunch::CodexResume {
                home,
                id: record.id,
                path: record.path,
                cwd: record.cwd,
            })
        }
    }
}

pub(crate) async fn lookup(home: PathBuf, id: String) -> Result<SessionRecord, HistoryError> {
    if !valid_session_id(&id) {
        return Err(HistoryError::InvalidId);
    }
    let pool = open_pool(&home)
        .await
        .map_err(|_| HistoryError::Unavailable)?;
    let schema = validate_schema(&pool)
        .await
        .map_err(|_| HistoryError::Unavailable)?;
    let filter = thread_filter(schema);
    let row = sqlx::query(&format!(
        "SELECT id, rollout_path, cwd FROM threads WHERE id = ? AND {filter}"
    ))
    .bind(&id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| HistoryError::Unavailable)?
    .ok_or(HistoryError::NotFound)?;
    let rollout = row
        .try_get::<String, _>("rollout_path")
        .map_err(|_| HistoryError::NotFound)?;
    let row_cwd = row
        .try_get::<String, _>("cwd")
        .map_err(|_| HistoryError::InvalidCwd)?;
    tokio::task::spawn_blocking(move || {
        let cwd = trusted_cwd(Path::new(&row_cwd)).ok_or(HistoryError::InvalidCwd)?;
        let path = trusted_rollout(&home, Path::new(&rollout)).ok_or(HistoryError::NotFound)?;
        Ok(SessionRecord { id, path, cwd })
    })
    .await
    .map_err(|_| HistoryError::Unavailable)?
}

pub(crate) async fn delete(state: &AppState, id: String) -> Result<(), DeleteError> {
    if !valid_session_id(&id) {
        return Err(DeleteError::History(HistoryError::InvalidId));
    }
    if state
        .active_upstream_session_ids_for(CODEX_ID)
        .contains(&id)
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let home = resolve_home();
    let record = lookup(home.clone(), id.clone())
        .await
        .map_err(DeleteError::History)?;
    if state
        .active_upstream_session_ids_for(CODEX_ID)
        .contains(&id)
        || state
            .active_upstream_session_files_for(CODEX_ID)
            .contains(&record.path)
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let lock_home = home.clone();
    let lock_id = id.clone();
    match tokio::task::spawn_blocking(move || writer_lock(&lock_home, &lock_id))
        .await
        .map_err(|_| DeleteError::History(HistoryError::Unavailable))?
        .map_err(|_| DeleteError::History(HistoryError::Unavailable))?
    {
        WriterLock::Held => return Err(DeleteError::History(HistoryError::ExternalActive)),
        WriterLock::Inactive => {}
    }
    let executable = agent::executable_path("codex").ok_or(DeleteError::Failed {
        status: StatusCode::SERVICE_UNAVAILABLE,
        code: "CODEX_UNAVAILABLE",
        message: None,
    })?;
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new(executable)
            .args(delete_args(&id))
            .env("CODEX_HOME", home)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await;
    match output {
        Ok(Ok(status)) if status.success() => Ok(()),
        Ok(Ok(_)) | Err(_) => Err(DeleteError::Failed {
            status: StatusCode::BAD_GATEWAY,
            code: "CODEX_SESSION_DELETE_FAILED",
            message: None,
        }),
        Ok(Err(_)) => Err(DeleteError::Failed {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "CODEX_UNAVAILABLE",
            message: None,
        }),
    }
}

pub(crate) async fn new_session_candidates(
    home: PathBuf,
    cwd: PathBuf,
    launched_at: i64,
    baseline: &HashSet<String>,
) -> Result<Vec<SessionRecord>, ()> {
    let pool = open_pool(&home).await.map_err(|_| ())?;
    let schema = validate_schema(&pool).await.map_err(|_| ())?;
    let created = if schema.created_at_ms {
        "COALESCE(created_at_ms, created_at * 1000, 0)"
    } else {
        "COALESCE(created_at * 1000, 0)"
    };
    let filter = thread_filter(schema);
    let query =
        format!("SELECT id, rollout_path, cwd FROM threads WHERE {filter} AND {created} >= ?");
    let rows = sqlx::query(&query)
        .bind(launched_at.saturating_sub(2_000))
        .fetch_all(&pool)
        .await
        .map_err(|_| ())?
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<String, _>("id").map_err(|_| ())?,
                row.try_get::<String, _>("rollout_path").map_err(|_| ())?,
                row.try_get::<String, _>("cwd").map_err(|_| ())?,
            ))
        })
        .collect::<Result<Vec<_>, ()>>()?;
    let baseline = baseline.clone();
    tokio::task::spawn_blocking(move || {
        let canonical_cwd = fs::canonicalize(cwd).map_err(|_| ())?;
        let mut candidates = Vec::new();
        for (id, rollout, row_cwd) in rows {
            if baseline.contains(&id) || !valid_session_id(&id) {
                continue;
            }
            if trusted_cwd(Path::new(&row_cwd)).as_ref() != Some(&canonical_cwd) {
                continue;
            }
            let path = trusted_rollout(&home, Path::new(&rollout)).ok_or(())?;
            candidates.push(SessionRecord {
                id,
                path,
                cwd: canonical_cwd.clone(),
            });
        }
        Ok(candidates)
    })
    .await
    .map_err(|_| ())?
}

pub(crate) fn unique_unclaimed_session(
    candidates: Vec<SessionRecord>,
    claimed: &HashSet<String>,
) -> Option<SessionRecord> {
    let mut unclaimed = candidates
        .into_iter()
        .filter(|record| !claimed.contains(&record.id));
    let candidate = unclaimed.next();
    candidate.filter(|_| unclaimed.next().is_none())
}

async fn eligible_ids(home: &Path) -> Result<HashSet<String>, BaselineError> {
    let database = home.join("state_5.sqlite");
    match fs::symlink_metadata(&database) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(BaselineError::Missing);
        }
        Err(_) => return Err(BaselineError::Unavailable),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(BaselineError::Unavailable);
        }
        Ok(_) => {}
    }
    let pool = open_pool(home)
        .await
        .map_err(|_| BaselineError::Unavailable)?;
    let schema = validate_schema(&pool)
        .await
        .map_err(|_| BaselineError::Unavailable)?;
    let filter = thread_filter(schema);
    sqlx::query_scalar::<_, String>(&format!("SELECT id FROM threads WHERE {filter}"))
        .fetch_all(&pool)
        .await
        .map(|ids| ids.into_iter().filter(|id| valid_session_id(id)).collect())
        .map_err(|_| BaselineError::Unavailable)
}

#[cfg(unix)]
fn writer_lock(home: &Path, id: &str) -> Result<WriterLock, ()> {
    if !valid_session_id(id) {
        return Err(());
    }
    let root = home.join("thread-writer-locks");
    match fs::symlink_metadata(&root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WriterLock::Inactive);
        }
        Err(_) => return Err(()),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => return Err(()),
        Ok(_) => {}
    }
    let canonical_root = fs::canonicalize(&root).map_err(|_| ())?;
    let path = root.join(format!("{id}.lock"));
    let metadata = match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WriterLock::Inactive);
        }
        Err(_) => return Err(()),
        Ok(metadata) => metadata,
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.nlink() != 1 {
        return Err(());
    }
    let canonical = fs::canonicalize(&path).map_err(|_| ())?;
    if canonical.parent() != Some(canonical_root.as_path()) {
        return Err(());
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path)
        .map_err(|_| ())?;
    let opened = file.metadata().map_err(|_| ())?;
    if opened.dev() != metadata.dev() || opened.ino() != metadata.ino() {
        return Err(());
    }
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if result == 0 {
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) } != 0 {
            return Err(());
        }
        Ok(WriterLock::Inactive)
    } else if std::io::Error::last_os_error().raw_os_error() == Some(libc::EWOULDBLOCK) {
        Ok(WriterLock::Held)
    } else {
        Err(())
    }
}

#[cfg(not(unix))]
fn writer_lock(_home: &Path, _id: &str) -> Result<WriterLock, ()> {
    Err(())
}

fn delete_args(id: &str) -> [&str; 3] {
    ["delete", "--force", id]
}

async fn open_pool(home: &Path) -> Result<SqlitePool, sqlx::Error> {
    let path = home.join("state_5.sqlite");
    if !path.is_file() {
        return Err(sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Codex history database not found",
        )));
    }
    SqlitePoolOptions::new()
        .max_connections(2)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA query_only = ON")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .read_only(true)
                .busy_timeout(Duration::from_secs(2)),
        )
        .await
}

async fn validate_schema(pool: &SqlitePool) -> Result<Schema, &'static str> {
    let rows = sqlx::query("PRAGMA table_info(threads)")
        .fetch_all(pool)
        .await
        .map_err(|_| "CODEX_HISTORY_SCHEMA_UNAVAILABLE")?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    if !REQUIRED_COLUMNS.iter().all(|name| columns.contains(*name)) {
        return Err("CODEX_HISTORY_SCHEMA_UNSUPPORTED");
    }
    Ok(Schema {
        created_at_ms: columns.contains("created_at_ms"),
        updated_at_ms: columns.contains("updated_at_ms"),
        recency_at_ms: columns.contains("recency_at_ms"),
        first_user_message: columns.contains("first_user_message"),
        preview: columns.contains("preview"),
        name: columns.contains("name"),
        source: columns.contains("source"),
        has_user_event: columns.contains("has_user_event"),
    })
}

fn trusted_cwd(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    fs::canonicalize(path).ok().filter(|path| path.is_dir())
}

fn trusted_rollout(home: &Path, path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.nlink() != 1 {
        return None;
    }
    let sessions = fs::canonicalize(home.join("sessions")).ok()?;
    let canonical = fs::canonicalize(path).ok()?;
    canonical.starts_with(&sessions).then_some(canonical)
}

pub(crate) fn valid_session_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filesystem::path_string;

    fn temporary_home() -> PathBuf {
        let home = env::temp_dir().join(format!("devhatch-codex-history-{}", Uuid::new_v4()));
        fs::create_dir_all(home.join("sessions")).unwrap();
        home
    }

    async fn database(home: &Path, optional: bool) -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(home.join("state_5.sqlite"))
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        let extra = if optional {
            ", created_at_ms INTEGER, updated_at_ms INTEGER, recency_at_ms INTEGER, first_user_message TEXT, preview TEXT, name TEXT, has_user_event INTEGER, source"
        } else {
            ""
        };
        sqlx::query(&format!("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, cwd TEXT, title TEXT, archived INTEGER{extra})"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn record(home: &Path, pool: &SqlitePool, id: &str, cwd: &Path, rollout: &Path) {
        sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, archived) VALUES (?, ?, 1, 1, ?, 'session', 0)")
            .bind(id)
            .bind(path_string(rollout))
            .bind(path_string(cwd))
            .execute(pool)
            .await
            .unwrap();
        assert!(home.is_absolute());
    }

    #[test]
    fn resolves_home_and_validates_uuid_and_args() {
        assert_eq!(
            resolve_home_from(None, Path::new("/home/test"), Path::new("/work")),
            Path::new("/home/test/.codex")
        );
        assert_eq!(
            resolve_home_from(
                Some("relative".into()),
                Path::new("/home/test"),
                Path::new("/work")
            ),
            Path::new("/work/relative")
        );
        let id = Uuid::new_v4().to_string();
        assert!(valid_session_id(&id));
        assert!(!valid_session_id(&id.to_uppercase()));
        assert_eq!(delete_args("id"), ["delete", "--force", "id"]);
    }

    #[tokio::test]
    async fn filters_official_history_and_uses_name_then_title() {
        let home = temporary_home();
        let cwd = home.join("work");
        fs::create_dir(&cwd).unwrap();
        let pool = database(&home, true).await;
        let named = Uuid::new_v4().to_string();
        let titled = Uuid::new_v4().to_string();
        let hidden = Uuid::new_v4().to_string();
        let subagent = Uuid::new_v4().to_string();
        for (id, name, title, first, preview, source, updated, user) in [
            (
                &named,
                " Named ",
                "title",
                "different",
                "visible",
                "cli",
                4000,
                0,
            ),
            (
                &titled,
                "",
                " Title ",
                "not the title",
                "visible",
                "vscode",
                3000,
                1,
            ),
            (&hidden, "hidden", "hidden", "prompt", "", "cli", 2000, 1),
            (
                &subagent,
                "subagent",
                "subagent",
                "prompt",
                "visible",
                r#"{"subagent":true}"#,
                1000,
                1,
            ),
        ] {
            sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, archived, created_at_ms, updated_at_ms, recency_at_ms, first_user_message, preview, name, has_user_event, source) VALUES (?, NULL, 1, 1, ?, ?, 0, 1000, ?, ?, ?, ?, ?, ?, ?)")
                .bind(id).bind(path_string(&cwd)).bind(title).bind(updated).bind(updated).bind(first).bind(preview).bind(name).bind(user).bind(source).execute(&pool).await.unwrap();
        }
        let integer = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, archived, preview, source) VALUES (?, NULL, 1, 1, ?, 'Integer', 0, 'visible', 4)")
            .bind(&integer).bind(path_string(&cwd)).execute(&pool).await.unwrap();
        let schema = validate_schema(&pool).await.unwrap();
        assert!(schema.preview && schema.source && schema.recency_at_ms);
        let rows = query_rows(&pool, schema).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows[0].try_get::<String, _>("display_title").unwrap(),
            "Named"
        );
        assert_eq!(
            rows[1].try_get::<String, _>("display_title").unwrap(),
            "Title"
        );
        assert_eq!(
            lookup(home.clone(), hidden).await.unwrap_err(),
            HistoryError::NotFound
        );
        assert_eq!(
            lookup(home.clone(), subagent).await.unwrap_err(),
            HistoryError::NotFound
        );
        pool.close().await;
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn lookup_accepts_visible_top_level_without_user_event() {
        let home = temporary_home();
        let cwd = home.join("work");
        fs::create_dir(&cwd).unwrap();
        let pool = database(&home, true).await;
        let id = Uuid::new_v4().to_string();
        let rollout = home.join("sessions").join(format!("{id}.jsonl"));
        fs::write(&rollout, "{}").unwrap();
        sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, archived, preview, has_user_event, source) VALUES (?, ?, 1, 1, ?, 'title', 0, 'visible', 0, 'unknown')")
            .bind(&id).bind(path_string(rollout)).bind(path_string(&cwd)).execute(&pool).await.unwrap();
        pool.close().await;
        assert!(lookup(home.clone(), id.clone()).await.is_ok());
        assert!(
            matches!(prepare_from(home.clone(), Some(&id)).await.unwrap(), PreparedLaunch::CodexResume { id: prepared, .. } if prepared == id)
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn lookup_and_unique_correlation_require_trusted_files() {
        let home = temporary_home();
        let cwd = home.join("work");
        fs::create_dir(&cwd).unwrap();
        let rollout = home.join("sessions/session.jsonl");
        fs::write(&rollout, "{}").unwrap();
        let id = Uuid::new_v4().to_string();
        let pool = database(&home, false).await;
        record(&home, &pool, &id, &cwd, &rollout).await;
        pool.close().await;
        let found = lookup(home.clone(), id.clone()).await.unwrap();
        assert_eq!(found.path, fs::canonicalize(&rollout).unwrap());
        let candidates = new_session_candidates(home.clone(), cwd.clone(), 0, &HashSet::new())
            .await
            .unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, id);
        let outside = home.join("outside.jsonl");
        fs::write(&outside, "{}").unwrap();
        assert!(trusted_rollout(&home, &outside).is_none());
        let linked = home.join("sessions/linked.jsonl");
        std::os::unix::fs::symlink(&rollout, &linked).unwrap();
        assert!(trusted_rollout(&home, &linked).is_none());
        fs::remove_dir_all(home).unwrap();
    }

    #[tokio::test]
    async fn new_prepare_allows_missing_database_but_rejects_existing_bad_database() {
        let home = temporary_home();
        assert!(matches!(
            prepare_from(home.clone(), None).await.unwrap(),
            PreparedLaunch::CodexNew { baseline, .. } if baseline.is_empty()
        ));
        fs::write(home.join("state_5.sqlite"), "not sqlite").unwrap();
        assert_eq!(
            prepare_from(home.clone(), None).await.unwrap_err(),
            HistoryError::Unavailable
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn resume_prepare_rejects_external_writer() {
        let home = temporary_home();
        let cwd = home.join("work");
        fs::create_dir(&cwd).unwrap();
        let rollout = home.join("sessions/session.jsonl");
        fs::write(&rollout, "{}").unwrap();
        let id = Uuid::new_v4().to_string();
        let pool = database(&home, false).await;
        record(&home, &pool, &id, &cwd, &rollout).await;
        pool.close().await;
        let locks = home.join("thread-writer-locks");
        fs::create_dir(&locks).unwrap();
        let file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(locks.join(format!("{id}.lock")))
            .unwrap();
        assert_eq!(unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) }, 0);
        assert_eq!(
            prepare_from(home.clone(), Some(&id)).await.unwrap_err(),
            HistoryError::ExternalActive
        );
        drop(file);
        fs::remove_dir_all(home).unwrap();
    }

    #[tokio::test]
    async fn candidate_selection_supports_claimed_filter_and_rejects_ambiguity() {
        let home = temporary_home();
        let cwd = home.join("work");
        fs::create_dir(&cwd).unwrap();
        let pool = database(&home, false).await;
        let mut ids = Vec::new();
        for name in ["first", "second"] {
            let id = Uuid::new_v4().to_string();
            ids.push(id.clone());
            let rollout = home.join("sessions").join(format!("{name}.jsonl"));
            fs::write(&rollout, "{}").unwrap();
            record(&home, &pool, &id, &cwd, &rollout).await;
        }
        pool.close().await;
        let candidates = new_session_candidates(home.clone(), cwd, 0, &HashSet::new())
            .await
            .unwrap();
        assert!(unique_unclaimed_session(candidates.clone(), &HashSet::new()).is_none());
        let claimed = HashSet::from([ids[0].clone()]);
        let remaining = unique_unclaimed_session(candidates, &claimed).unwrap();
        assert_eq!(remaining.id, ids[1]);
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn detects_held_and_unheld_writer_locks() {
        let home = env::temp_dir().join(format!("devhatch-codex-lock-{}", Uuid::new_v4()));
        let root = home.join("thread-writer-locks");
        fs::create_dir_all(&root).unwrap();
        let id = Uuid::new_v4().to_string();
        let path = root.join(format!("{id}.lock"));
        let file = OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(path)
            .unwrap();
        assert_eq!(writer_lock(&home, &id).unwrap(), WriterLock::Inactive);
        assert_eq!(
            unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
            0
        );
        assert_eq!(writer_lock(&home, &id).unwrap(), WriterLock::Held);
        drop(file);
        fs::remove_dir_all(home).unwrap();
    }
}
