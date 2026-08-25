use std::{collections::HashSet, fs, path::PathBuf};

use axum::http::StatusCode;
use sqlx::{FromRow, Row, SqlitePool};

use super::{DeleteError, HistoryError, HistoryItem, PreparedLaunch, Presence};
use crate::{agent::OPENCODE_ID, clock::now, filesystem::path_string, state::AppState};

const RECENT_MILLIS: i64 = 5 * 60 * 1000;
const REQUIRED_SESSION_COLUMNS: &[&str] = &[
    "id",
    "project_id",
    "parent_id",
    "directory",
    "title",
    "time_created",
    "time_updated",
    "time_archived",
];

#[derive(FromRow)]
pub(crate) struct HistoryRow {
    id: String,
    title: String,
    directory: String,
    project_id: Option<String>,
    project_name: Option<String>,
    project_worktree: Option<String>,
    time_created: i64,
    time_updated: i64,
}

pub(crate) async fn list(state: &AppState) -> Result<Vec<HistoryItem>, &'static str> {
    let Some(pool) = state.history_pool() else {
        return Err("OPENCODE_HISTORY_DATABASE_NOT_FOUND");
    };
    validate_schema(pool).await?;
    let rows = sqlx::query_as::<_, HistoryRow>("SELECT s.id, s.title, s.directory, s.project_id, p.name AS project_name, p.worktree AS project_worktree, s.time_created, s.time_updated FROM session s LEFT JOIN project p ON p.id = s.project_id WHERE s.parent_id IS NULL AND s.time_archived IS NULL ORDER BY s.time_updated DESC")
        .fetch_all(pool).await.map_err(|_| "OPENCODE_HISTORY_QUERY_FAILED")?;
    let active_here = state.active_upstream_session_ids_for(OPENCODE_ID);
    let external_directories = external_opencode_directories(&state.owned_process_ids());
    Ok(rows
        .into_iter()
        .map(|row| {
            let presence = presence_for(&row, &active_here, &external_directories, now() as i64);
            HistoryItem {
                id: row.id,
                title: row.title,
                directory: row.directory,
                project_id: row.project_id,
                project_name: row.project_name,
                project_worktree: row.project_worktree,
                time_created: row.time_created,
                time_updated: row.time_updated,
                presence,
            }
        })
        .collect())
}

pub(crate) async fn prepare(
    pool: Option<&SqlitePool>,
    requested_id: Option<&str>,
) -> Result<PreparedLaunch, HistoryError> {
    let Some(id) = requested_id else {
        return Ok(PreparedLaunch::OpenCodeNew {
            baseline: root_session_ids(pool).await.unwrap_or_default(),
        });
    };
    if !valid_session_id(id) {
        return Err(HistoryError::InvalidId);
    }
    match resumable_session(pool, id).await {
        Ok(Some(cwd)) => Ok(PreparedLaunch::OpenCodeResume {
            id: id.to_string(),
            cwd,
        }),
        Ok(None) => Err(HistoryError::NotFound),
        Err(()) => Err(HistoryError::Unavailable),
    }
}

pub(crate) async fn delete(state: &AppState, id: String) -> Result<(), DeleteError> {
    if !valid_session_id(&id) {
        return Err(DeleteError::History(HistoryError::InvalidId));
    }
    if state
        .active_upstream_session_ids_for(OPENCODE_ID)
        .contains(&id)
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    match resumable_session(state.history_pool(), &id).await {
        Ok(Some(_)) => {}
        Ok(None) => return Err(DeleteError::History(HistoryError::NotFound)),
        Err(()) => return Err(DeleteError::History(HistoryError::Unavailable)),
    }
    let result = tokio::process::Command::new("opencode")
        .args(["--pure", "session", "delete", &id])
        .kill_on_drop(true)
        .output()
        .await;
    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(DeleteError::Failed {
            status: StatusCode::BAD_GATEWAY,
            code: "OPENCODE_SESSION_DELETE_FAILED",
            message: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        }),
        Err(_) => Err(DeleteError::Failed {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "OPENCODE_UNAVAILABLE",
            message: None,
        }),
    }
}

pub(crate) async fn root_session_ids(pool: Option<&SqlitePool>) -> Result<HashSet<String>, ()> {
    let Some(pool) = pool else {
        return Ok(HashSet::new());
    };
    validate_schema(pool).await.map_err(|_| ())?;
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM session WHERE parent_id IS NULL AND time_archived IS NULL",
    )
    .fetch_all(pool)
    .await
    .map(|ids| ids.into_iter().collect())
    .map_err(|_| ())
}

pub(crate) async fn unique_new_session(
    pool: Option<&SqlitePool>,
    directory: &str,
    launched_at: i64,
    baseline: &HashSet<String>,
    claimed: &HashSet<String>,
) -> Result<Option<String>, ()> {
    let Some(pool) = pool else { return Ok(None) };
    validate_schema(pool).await.map_err(|_| ())?;
    let ids = sqlx::query_scalar::<_, String>("SELECT id FROM session WHERE parent_id IS NULL AND time_archived IS NULL AND directory = ? AND time_created >= ? ORDER BY time_created ASC")
        .bind(directory)
        .bind(launched_at.saturating_sub(2_000))
        .fetch_all(pool)
        .await
        .map_err(|_| ())?;
    let mut candidates = ids
        .into_iter()
        .filter(|id| !baseline.contains(id) && !claimed.contains(id));
    let candidate = candidates.next();
    Ok(candidate.filter(|_| candidates.next().is_none()))
}

pub(crate) async fn fork_successor_id(
    pool: Option<&SqlitePool>,
    current_id: &str,
    directory: &str,
    launched_at: i64,
) -> Result<Option<String>, ()> {
    let Some(pool) = pool else { return Ok(None) };
    validate_schema(pool).await.map_err(|_| ())?;
    let current = sqlx::query_as::<_, (String, i64)>(
        "SELECT title, time_created FROM session WHERE id = ? AND parent_id IS NULL AND time_archived IS NULL AND directory = ?",
    )
    .bind(current_id)
    .bind(directory)
    .fetch_optional(pool)
    .await
    .map_err(|_| ())?;
    let Some((title, created_at)) = current else {
        return Ok(None);
    };
    sqlx::query_scalar::<_, String>(
        "SELECT id FROM session WHERE parent_id IS NULL AND time_archived IS NULL AND directory = ? AND title = ? AND time_created > ? AND time_created >= ? ORDER BY time_created DESC LIMIT 1",
    )
    .bind(directory)
    .bind(next_fork_title(&title))
    .bind(created_at)
    .bind(launched_at.saturating_sub(2_000))
    .fetch_optional(pool)
    .await
    .map_err(|_| ())
}

pub(crate) async fn fork_successor(
    pool: Option<&SqlitePool>,
    current_id: &str,
    candidate_id: &str,
    directory: &str,
) -> Result<bool, ()> {
    let Some(pool) = pool else { return Ok(false) };
    validate_schema(pool).await.map_err(|_| ())?;
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT id, title, directory FROM session WHERE id IN (?, ?) AND parent_id IS NULL AND time_archived IS NULL",
    )
    .bind(current_id)
    .bind(candidate_id)
    .fetch_all(pool)
    .await
    .map_err(|_| ())?;
    let current = rows.iter().find(|row| row.0 == current_id);
    let candidate = rows.iter().find(|row| row.0 == candidate_id);
    Ok(current.zip(candidate).is_some_and(|(current, candidate)| {
        current.2 == directory
            && candidate.2 == directory
            && candidate.1 == next_fork_title(&current.1)
    }))
}

fn next_fork_title(title: &str) -> String {
    let Some(prefix) = title.strip_suffix(')') else {
        return format!("{title} (fork #1)");
    };
    let Some((base, number)) = prefix.rsplit_once(" (fork #") else {
        return format!("{title} (fork #1)");
    };
    number.parse::<u64>().ok().map_or_else(
        || format!("{title} (fork #1)"),
        |number| format!("{base} (fork #{})", number + 1),
    )
}

async fn resumable_session(pool: Option<&SqlitePool>, id: &str) -> Result<Option<String>, ()> {
    let Some(pool) = pool else { return Ok(None) };
    validate_schema(pool).await.map_err(|_| ())?;
    sqlx::query_scalar::<_, String>("SELECT directory FROM session WHERE id = ? AND parent_id IS NULL AND time_archived IS NULL")
        .bind(id).fetch_optional(pool).await.map_err(|_| ())
}

fn valid_session_id(value: &str) -> bool {
    let suffix = value.strip_prefix("ses_");
    matches!(suffix, Some(value) if !value.is_empty() && value.len() <= 124 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

async fn validate_schema(pool: &SqlitePool) -> Result<(), &'static str> {
    let rows = sqlx::query("PRAGMA table_info(session)")
        .fetch_all(pool)
        .await
        .map_err(|_| "OPENCODE_HISTORY_SCHEMA_UNAVAILABLE")?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    if REQUIRED_SESSION_COLUMNS
        .iter()
        .all(|name| columns.contains(*name))
    {
        Ok(())
    } else {
        Err("OPENCODE_HISTORY_SCHEMA_UNSUPPORTED")
    }
}

fn presence_for(
    row: &HistoryRow,
    active_here: &HashSet<String>,
    external_directories: &HashSet<String>,
    current_time: i64,
) -> Presence {
    if active_here.contains(&row.id) {
        return Presence::ActiveHere;
    }
    let directory = canonical_identity(&row.directory);
    if current_time.saturating_sub(row.time_updated) <= RECENT_MILLIS
        && external_directories.contains(&directory)
    {
        Presence::PossiblyActiveElsewhere
    } else {
        Presence::Inactive
    }
}

fn external_opencode_directories(owned: &HashSet<u32>) -> HashSet<String> {
    let Ok(entries) = fs::read_dir("/proc") else {
        return HashSet::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_string_lossy().parse::<u32>().ok()?;
            if owned.contains(&pid) || has_owned_ancestor(pid, owned) {
                return None;
            }
            let comm = fs::read_to_string(entry.path().join("comm")).ok()?;
            if comm.trim() != "opencode" {
                return None;
            }
            fs::read_link(entry.path().join("cwd"))
                .ok()
                .map(path_string)
                .map(|value| canonical_identity(&value))
        })
        .collect()
}

fn has_owned_ancestor(mut pid: u32, owned: &HashSet<u32>) -> bool {
    for _ in 0..8 {
        let Ok(status) = fs::read_to_string(format!("/proc/{pid}/status")) else {
            return false;
        };
        let Some(parent) = status.lines().find_map(|line| line.strip_prefix("PPid:\t")) else {
            return false;
        };
        let Ok(parent) = parent.trim().parse::<u32>() else {
            return false;
        };
        if parent == 0 {
            return false;
        }
        if owned.contains(&parent) {
            return true;
        }
        pid = parent;
    }
    false
}

fn canonical_identity(value: &str) -> String {
    fs::canonicalize(value)
        .map(path_string)
        .unwrap_or_else(|_| path_string(PathBuf::from(value)))
}

#[cfg(test)]
mod tests {
    use super::{HistoryRow, Presence, next_fork_title, presence_for};
    use std::collections::HashSet;

    fn row() -> HistoryRow {
        HistoryRow {
            id: "ses_test".into(),
            title: "Test".into(),
            directory: "/tmp".into(),
            project_id: None,
            project_name: None,
            project_worktree: None,
            time_created: 1,
            time_updated: 1000,
        }
    }

    #[test]
    fn increments_open_code_fork_titles() {
        assert_eq!(next_fork_title("Original"), "Original (fork #1)");
        assert_eq!(next_fork_title("Original (fork #1)"), "Original (fork #2)");
        assert_eq!(
            next_fork_title("Original (fork #x)"),
            "Original (fork #x) (fork #1)"
        );
    }

    #[test]
    fn exact_active_here_wins_and_external_is_cautious() {
        let mut active = HashSet::new();
        active.insert("ses_test".into());
        let external = HashSet::from(["/tmp".into()]);
        assert_eq!(
            presence_for(&row(), &active, &external, 1000),
            Presence::ActiveHere
        );
        assert_eq!(
            presence_for(&row(), &HashSet::new(), &external, 1000),
            Presence::PossiblyActiveElsewhere
        );
        assert_eq!(
            presence_for(&row(), &HashSet::new(), &external, 1_000_000),
            Presence::Inactive
        );
    }
}
