use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::http::StatusCode;
use sqlx::{
    Connection, FromRow, Row, SqliteConnection, SqlitePool, TypeInfo, ValueRef,
    sqlite::{SqliteConnectOptions, SqliteLockingMode, SqliteRow},
};

use super::{DeleteError, HistoryError, HistoryItem, PreparedLaunch, Presence};
use crate::{
    agent::OPENCODE_ID,
    clock::now,
    filesystem::path_string,
    state::{AppState, HistoryPoolHandle},
};

const RECENT_MILLIS: i64 = 5 * 60 * 1000;
const LINEAGE_TABLE: &str = "_devhatch_session_lineage";
const LINEAGE_CREATE: &str = "CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY, v1_time_created INTEGER, v1_time_updated INTEGER, v2_time_created INTEGER, v2_time_updated INTEGER, v1_present INTEGER NOT NULL CHECK (v1_present IN (0, 1)), v2_present INTEGER NOT NULL CHECK (v2_present IN (0, 1)), v2_deleted INTEGER NOT NULL CHECK (v2_deleted IN (0, 1)))";
const PREVIOUS_LINEAGE_CREATE: &str = "CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY, v1_time_created INTEGER, v1_time_updated INTEGER, v2_time_updated INTEGER, v1_present INTEGER NOT NULL CHECK (v1_present IN (0, 1)), v2_present INTEGER NOT NULL CHECK (v2_present IN (0, 1)), v2_deleted INTEGER NOT NULL CHECK (v2_deleted IN (0, 1)))";
const UPGRADED_LINEAGE_CREATE: &str = "CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY, v1_time_created INTEGER, v1_time_updated INTEGER, v2_time_updated INTEGER, v1_present INTEGER NOT NULL CHECK (v1_present IN (0, 1)), v2_present INTEGER NOT NULL CHECK (v2_present IN (0, 1)), v2_deleted INTEGER NOT NULL CHECK (v2_deleted IN (0, 1)), v2_time_created INTEGER)";
const LINEAGE_TRIGGERS: &[(&str, &str, &str)] = &[
    (
        "_devhatch_lineage_v1_insert",
        "session",
        "CREATE TRIGGER _devhatch_lineage_v1_insert AFTER INSERT ON session BEGIN INSERT INTO _devhatch_session_lineage (session_id, v1_time_created, v1_time_updated, v2_time_created, v2_time_updated, v1_present, v2_present, v2_deleted) VALUES (NEW.id, NEW.time_created, NEW.time_updated, NULL, NULL, 1, 0, 0) ON CONFLICT(session_id) DO UPDATE SET v1_time_created = NEW.time_created, v1_time_updated = NEW.time_updated, v1_present = 1, v2_deleted = CASE WHEN _devhatch_session_lineage.v2_deleted = 1 AND _devhatch_session_lineage.v1_time_created = NEW.time_created AND NEW.time_updated <= _devhatch_session_lineage.v2_time_updated THEN 1 ELSE 0 END; END",
    ),
    (
        "_devhatch_lineage_v1_update",
        "session",
        "CREATE TRIGGER _devhatch_lineage_v1_update AFTER UPDATE OF id, time_created, time_updated ON session BEGIN UPDATE _devhatch_session_lineage SET v1_present = 0 WHERE session_id = OLD.id AND OLD.id <> NEW.id; DELETE FROM _devhatch_session_lineage WHERE session_id = OLD.id AND v1_present = 0 AND v2_present = 0 AND v2_deleted = 0; INSERT INTO _devhatch_session_lineage (session_id, v1_time_created, v1_time_updated, v2_time_created, v2_time_updated, v1_present, v2_present, v2_deleted) VALUES (NEW.id, NEW.time_created, NEW.time_updated, NULL, NULL, 1, 0, 0) ON CONFLICT(session_id) DO UPDATE SET v1_time_created = NEW.time_created, v1_time_updated = NEW.time_updated, v1_present = 1, v2_deleted = CASE WHEN _devhatch_session_lineage.v2_deleted = 1 AND _devhatch_session_lineage.v1_time_created = NEW.time_created AND NEW.time_updated <= _devhatch_session_lineage.v2_time_updated THEN 1 ELSE 0 END; END",
    ),
    (
        "_devhatch_lineage_v1_delete",
        "session",
        "CREATE TRIGGER _devhatch_lineage_v1_delete AFTER DELETE ON session BEGIN UPDATE _devhatch_session_lineage SET v1_present = 0 WHERE session_id = OLD.id; DELETE FROM _devhatch_session_lineage WHERE session_id = OLD.id AND v1_present = 0 AND v2_present = 0 AND v2_deleted = 0; END",
    ),
    (
        "_devhatch_lineage_v2_insert",
        "session_v2",
        "CREATE TRIGGER _devhatch_lineage_v2_insert AFTER INSERT ON session_v2 BEGIN INSERT INTO _devhatch_session_lineage (session_id, v1_time_created, v1_time_updated, v2_time_created, v2_time_updated, v1_present, v2_present, v2_deleted) VALUES (NEW.id, NULL, NULL, NEW.time_created, NEW.time_updated, 0, 1, 0) ON CONFLICT(session_id) DO UPDATE SET v2_time_created = NEW.time_created, v2_time_updated = NEW.time_updated, v2_present = 1, v2_deleted = 0; END",
    ),
    (
        "_devhatch_lineage_v2_update",
        "session_v2",
        "CREATE TRIGGER _devhatch_lineage_v2_update AFTER UPDATE OF id, time_created, time_updated ON session_v2 BEGIN UPDATE _devhatch_session_lineage SET v2_time_created = OLD.time_created, v2_time_updated = OLD.time_updated, v2_present = 0, v2_deleted = CASE WHEN v1_present = 1 AND v1_time_created = OLD.time_created AND v1_time_updated <= OLD.time_updated THEN 1 ELSE 0 END WHERE session_id = OLD.id; DELETE FROM _devhatch_session_lineage WHERE session_id = OLD.id AND v1_present = 0 AND v2_present = 0 AND v2_deleted = 0; INSERT INTO _devhatch_session_lineage (session_id, v1_time_created, v1_time_updated, v2_time_created, v2_time_updated, v1_present, v2_present, v2_deleted) VALUES (NEW.id, NULL, NULL, NEW.time_created, NEW.time_updated, 0, 1, 0) ON CONFLICT(session_id) DO UPDATE SET v2_time_created = NEW.time_created, v2_time_updated = NEW.time_updated, v2_present = 1, v2_deleted = 0; END",
    ),
    (
        "_devhatch_lineage_v2_delete",
        "session_v2",
        "CREATE TRIGGER _devhatch_lineage_v2_delete AFTER DELETE ON session_v2 BEGIN UPDATE _devhatch_session_lineage SET v2_time_created = OLD.time_created, v2_time_updated = OLD.time_updated, v2_present = 0, v2_deleted = CASE WHEN v1_present = 1 AND v1_time_created = OLD.time_created AND v1_time_updated <= OLD.time_updated THEN 1 ELSE 0 END WHERE session_id = OLD.id; DELETE FROM _devhatch_session_lineage WHERE session_id = OLD.id AND v1_present = 0 AND v2_present = 0 AND v2_deleted = 0; END",
    ),
];
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
const REQUIRED_LINEAGE_COLUMNS: &[&str] = &[
    "session_id",
    "v1_time_created",
    "v1_time_updated",
    "v2_time_created",
    "v2_time_updated",
    "v1_present",
    "v2_present",
    "v2_deleted",
];
const TOMBSTONE_LINEAGE_COLUMNS: &[&str] = &[
    "session_id",
    "v1_time_created",
    "v1_time_updated",
    "v2_time_updated",
    "v1_present",
    "v2_present",
    "v2_deleted",
];

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum SessionTable {
    V1,
    V2,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct SessionGeneration {
    id: String,
    parent_id: Option<String>,
    directory: String,
    time_created: i64,
    time_updated: i64,
    time_archived: Option<i64>,
    fingerprint: RowFingerprint,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionSchema {
    sql: String,
    columns: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DeletionTarget {
    table: SessionTable,
    schema: Option<SessionSchema>,
    generations: Vec<SessionGeneration>,
}

type RowFingerprint = Vec<u8>;
type LineageState = RowFingerprint;

#[derive(Clone, Debug, PartialEq, Eq)]
struct RowSnapshot {
    table: String,
    predicate: String,
    bindings: Vec<String>,
    rows: Vec<RowFingerprint>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ForeignKey {
    child: String,
    parent: String,
    on_delete: String,
    columns: Vec<(String, Option<String>)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DeletionPlan {
    root: ResumableSession,
    lineage: Vec<LineageState>,
    schema_version: i64,
    schema_objects: Vec<(String, String, String, String)>,
    events: Option<RowSnapshot>,
    event_sequences: Option<RowSnapshot>,
    cascade_dependents: Vec<RowSnapshot>,
    targets: Vec<DeletionTarget>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ResumableSession {
    generation: SessionGeneration,
    table: SessionTable,
}

impl SessionTable {
    fn name(self) -> &'static str {
        match self {
            Self::V1 => "session",
            Self::V2 => "session_v2",
        }
    }
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn selected_columns(alias: &str, columns: &[String]) -> String {
    columns
        .iter()
        .map(|column| format!("{alias}.{}", quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn append_length_prefixed(fingerprint: &mut RowFingerprint, value: &[u8]) {
    fingerprint.extend_from_slice(&value.len().to_be_bytes());
    fingerprint.extend_from_slice(value);
}

fn row_fingerprint(row: &SqliteRow, columns: usize) -> Result<RowFingerprint, ()> {
    let mut fingerprint = Vec::new();
    for index in 0..columns {
        let value = row.try_get_raw(index).map_err(|_| ())?;
        if value.is_null() {
            fingerprint.push(0);
            continue;
        }
        let type_info = value.type_info();
        match type_info.name() {
            "INTEGER" => {
                fingerprint.push(1);
                fingerprint.extend_from_slice(
                    &row.try_get::<i64, _>(index).map_err(|_| ())?.to_be_bytes(),
                );
            }
            "REAL" => {
                fingerprint.push(2);
                fingerprint.extend_from_slice(
                    &row.try_get::<f64, _>(index)
                        .map_err(|_| ())?
                        .to_bits()
                        .to_be_bytes(),
                );
            }
            "TEXT" => {
                fingerprint.push(3);
                append_length_prefixed(
                    &mut fingerprint,
                    row.try_get::<&[u8], _>(index).map_err(|_| ())?,
                );
            }
            "BLOB" => {
                fingerprint.push(4);
                append_length_prefixed(
                    &mut fingerprint,
                    row.try_get::<&[u8], _>(index).map_err(|_| ())?,
                );
            }
            _ => return Err(()),
        }
    }
    Ok(fingerprint)
}

async fn session_schema_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: SessionTable,
) -> Result<Option<SessionSchema>, ()> {
    let Some(sql) = sqlx::query_scalar::<_, String>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(table.name())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|_| ())?
    else {
        return Ok(None);
    };
    let rows = sqlx::query(&format!("PRAGMA table_xinfo({})", table.name()))
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<Vec<_>>();
    if !REQUIRED_SESSION_COLUMNS
        .iter()
        .all(|required| columns.iter().any(|column| column == required))
    {
        return Err(());
    }
    Ok(Some(SessionSchema { sql, columns }))
}

fn session_generation_from_row(
    row: SqliteRow,
    column_count: usize,
) -> Result<SessionGeneration, ()> {
    let fingerprint = row_fingerprint(&row, column_count)?;
    Ok(SessionGeneration {
        id: row.try_get("id").map_err(|_| ())?,
        parent_id: row.try_get("parent_id").map_err(|_| ())?,
        directory: row.try_get("directory").map_err(|_| ())?,
        time_created: row.try_get("time_created").map_err(|_| ())?,
        time_updated: row.try_get("time_updated").map_err(|_| ())?,
        time_archived: row.try_get("time_archived").map_err(|_| ())?,
        fingerprint,
    })
}

async fn session_generation_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: SessionTable,
    schema: &SessionSchema,
    id: &str,
) -> Result<Option<SessionGeneration>, ()> {
    let selected = selected_columns("row", &schema.columns);
    let query = format!(
        "SELECT {selected} FROM {} row WHERE row.id = ?",
        table.name()
    );
    sqlx::query(&query)
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ())?
        .map(|row| session_generation_from_row(row, schema.columns.len()))
        .transpose()
}

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
    parent_id: Option<String>,
    time_archived: Option<i64>,
}

pub(crate) async fn refresh_history_binding(state: &AppState) {
    if let Some(verified) =
        crate::agent::verified_executable(state.data_dir(), crate::agent::AgentKind::OpenCode).await
    {
        let path = crate::server::current_opencode_database_path(
            Some(&verified.version),
            Some(verified.opencode_v2),
        );
        state.rebind_opencode_database(path).await;
    }
}

pub(crate) async fn list(state: &AppState) -> Result<Vec<HistoryItem>, &'static str> {
    for _ in 0..2 {
        let Some(handle) = state.history_pool().await else {
            return Err("OPENCODE_HISTORY_DATABASE_NOT_FOUND");
        };
        let _ = reconcile_lineage(&handle).await;
        if !state.opencode_history_handle_is_current(&handle) {
            state.invalidate_history_pool(&handle).await;
            continue;
        }
        let rows = match history_rows(&handle.pool).await {
            Ok(rows) => rows,
            Err(error) => {
                state.invalidate_history_pool(&handle).await;
                return Err(error);
            }
        };
        if !state.opencode_history_handle_is_current(&handle) {
            state.invalidate_history_pool(&handle).await;
            continue;
        }
        let active_here = state.active_upstream_session_ids_for(OPENCODE_ID);
        let external_directories = external_opencode_directories(state.owned_process_ids()).await;
        return Ok(rows
            .into_iter()
            .map(|row| {
                let presence =
                    presence_for(&row, &active_here, &external_directories, now() as i64);
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
            .collect());
    }
    Err("OPENCODE_HISTORY_QUERY_FAILED")
}

pub(crate) async fn prepare(
    state: &AppState,
    requested_id: Option<&str>,
    v2: bool,
) -> Result<PreparedLaunch, HistoryError> {
    let Some(id) = requested_id else {
        if let Some(handle) = state.history_pool().await {
            let _ = reconcile_lineage(&handle).await;
        }
        return Ok(PreparedLaunch::OpenCodeNew);
    };
    if !valid_session_id(id) {
        return Err(HistoryError::InvalidId);
    }
    let Some(handle) = state.history_pool().await else {
        return Err(HistoryError::Unavailable);
    };
    if reconcile_lineage(&handle).await.is_err()
        || !state.opencode_history_handle_is_current(&handle)
    {
        state.invalidate_history_pool(&handle).await;
        return Err(HistoryError::Unavailable);
    }
    let resumable = match resumable_session(Some(&handle.pool), id).await {
        Ok(Some(session)) => session,
        Ok(None) => return Err(HistoryError::NotFound),
        Err(()) => {
            state.invalidate_history_pool(&handle).await;
            return Err(HistoryError::Unavailable);
        }
    };
    if !state.opencode_history_handle_is_current(&handle) {
        state.invalidate_history_pool(&handle).await;
        return Err(HistoryError::Unavailable);
    }
    if resumable.table
        != if v2 {
            SessionTable::V2
        } else {
            SessionTable::V1
        }
    {
        return Err(HistoryError::Unavailable);
    }
    let cwd =
        trusted_cwd(Path::new(&resumable.generation.directory)).ok_or(HistoryError::InvalidCwd)?;
    let canonical_directory = path_string(&cwd);
    if state
        .unidentified_agent_cwds_for(OPENCODE_ID)
        .iter()
        .any(|active| canonical_identity(active.to_string_lossy().as_ref()) == canonical_directory)
    {
        return Err(HistoryError::Active);
    }
    Ok(PreparedLaunch::OpenCodeResume {
        id: id.to_string(),
        cwd,
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

pub(crate) async fn delete(
    state: &AppState,
    id: String,
    deletion: &mut crate::state::HistoryDeletionGuard,
) -> Result<(), DeleteError> {
    if !valid_session_id(&id) {
        return Err(DeleteError::History(HistoryError::InvalidId));
    }
    if state
        .active_upstream_session_ids_for(OPENCODE_ID)
        .contains(&id)
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let Some(handle) = state.history_pool().await else {
        return Err(DeleteError::History(HistoryError::NotFound));
    };
    if reconcile_lineage_for_deletion(&handle).await.is_err() {
        return Err(DeleteError::History(HistoryError::Unavailable));
    }
    if !state.opencode_history_handle_is_current(&handle) {
        return Err(DeleteError::History(HistoryError::Unavailable));
    }
    let plan = match deletion_plan(&handle.pool, &id).await {
        Ok(Some(plan)) => plan,
        Ok(None) => return Err(DeleteError::History(HistoryError::NotFound)),
        Err(()) => return Err(DeleteError::History(HistoryError::Unavailable)),
    };
    if !state.opencode_history_handle_is_current(&handle) {
        return Err(DeleteError::History(HistoryError::Unavailable));
    }
    if !state.history_coordinator().extend_deletion(
        deletion,
        OPENCODE_ID,
        plan.targets
            .iter()
            .flat_map(|target| &target.generations)
            .map(|generation| generation.id.clone()),
    ) {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let active_ids = state.active_upstream_session_ids_for(OPENCODE_ID);
    if plan
        .targets
        .iter()
        .flat_map(|target| &target.generations)
        .any(|generation| active_ids.contains(&generation.id))
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let directories = plan
        .targets
        .iter()
        .flat_map(|target| &target.generations)
        .map(|generation| canonical_identity(&generation.directory))
        .collect::<HashSet<_>>();
    if state
        .unidentified_agent_cwds_for(OPENCODE_ID)
        .iter()
        .map(|cwd| canonical_identity(cwd.to_string_lossy().as_ref()))
        .any(|cwd| directories.contains(&cwd))
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    if external_opencode_directories(state.owned_process_ids())
        .await
        .iter()
        .any(|directory| directories.contains(directory))
    {
        return Err(DeleteError::History(HistoryError::ExternalActive));
    }
    if !handle.file_is_current() || !handle.is_private_current_user_file() {
        return Err(DeleteError::History(HistoryError::Unavailable));
    }
    let result = delete_generations_at(&handle, &plan).await;
    match result {
        Ok(()) => {
            #[cfg(test)]
            handle.test_before_delete_invalidation().await;
            state.invalidate_history_pool(&handle).await;
            Ok(())
        }
        Err(GenerationDeleteError::ExternalActive) => {
            Err(DeleteError::History(HistoryError::ExternalActive))
        }
        Err(GenerationDeleteError::Stale) => Err(DeleteError::History(HistoryError::Unavailable)),
        Err(GenerationDeleteError::Shared) => Err(DeleteError::Failed {
            status: StatusCode::CONFLICT,
            code: "OPENCODE_SESSION_SHARED",
            message: None,
        }),
        Err(GenerationDeleteError::Failed) => Err(DeleteError::Failed {
            status: StatusCode::BAD_GATEWAY,
            code: "OPENCODE_SESSION_DELETE_FAILED",
            message: None,
        }),
    }
}

async fn deletion_lineage_triggers_are_safe(pool: &SqlitePool) -> Result<bool, ()> {
    let triggers = sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| ())?;
    Ok(safe_deletion_triggers(&triggers))
}

async fn reconcile_lineage_for_deletion(handle: &HistoryPoolHandle) -> Result<bool, ()> {
    if !deletion_lineage_triggers_are_safe(&handle.pool).await? {
        return Err(());
    }
    reconcile_lineage(handle).await
}

fn safe_deletion_triggers(objects: &[(String, String, String, String)]) -> bool {
    objects
        .iter()
        .filter(|(kind, _, _, _)| kind == "trigger")
        .all(|(_, name, table, sql)| {
            LINEAGE_TRIGGERS
                .iter()
                .any(|(expected_name, expected_table, expected_sql)| {
                    name == expected_name && table == expected_table && sql == expected_sql
                })
        })
}

async fn database_schema_objects_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<(String, String, String, String)>, ()> {
    sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name",
    )
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ())
}

async fn compatible_table_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
    required: &[&str],
) -> Result<bool, ()> {
    let objects = sqlx::query_as::<_, (String, String)>(
        "SELECT name, type FROM sqlite_master WHERE name = ? COLLATE NOCASE AND type IN ('table', 'index', 'view', 'trigger')",
    )
    .bind(table)
    .fetch_all(&mut **transaction)
    .await
    .map_err(|_| ())?;
    if objects.is_empty() {
        return Ok(false);
    }
    if objects.len() != 1 || objects[0].0 != table || objects[0].1 != "table" {
        return Err(());
    }
    let rows = sqlx::query(&format!("PRAGMA table_info({})", quote_identifier(table)))
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    required
        .iter()
        .all(|column| columns.contains(*column))
        .then_some(true)
        .ok_or(())
}

#[derive(Clone)]
struct RowSelection {
    table: String,
    predicate: String,
    bindings: Vec<String>,
    path: Vec<String>,
}

async fn table_columns_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<Vec<String>, ()> {
    let rows = sqlx::query(&format!("PRAGMA table_xinfo({})", quote_identifier(table)))
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .into_iter()
        .map(|row| row.try_get::<String, _>("name").map_err(|_| ()))
        .collect::<Result<Vec<_>, _>>()?;
    (!columns.is_empty()).then_some(columns).ok_or(())
}

async fn row_snapshot_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
    predicate: String,
    bindings: Vec<String>,
) -> Result<RowSnapshot, ()> {
    let columns = table_columns_connection(transaction, table).await?;
    let selected = selected_columns("row", &columns);
    let predicate_sql = predicate.replace("{row}", "row");
    let query = format!(
        "SELECT {selected} FROM {} row WHERE ({predicate_sql})",
        quote_identifier(table)
    );
    let mut query = sqlx::query(&query);
    for binding in &bindings {
        query = query.bind(binding);
    }
    let rows = query
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?
        .into_iter()
        .map(|row| row_fingerprint(&row, columns.len()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut rows = rows;
    rows.sort_unstable();
    Ok(RowSnapshot {
        table: table.to_string(),
        rows,
        predicate,
        bindings,
    })
}

async fn rows_for_ids_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
    column: &str,
    ids: &[String],
) -> Result<RowSnapshot, ()> {
    let placeholders = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    row_snapshot_connection(
        transaction,
        table,
        format!("row.{} IN ({placeholders})", quote_identifier(column)),
        ids.to_vec(),
    )
    .await
}

async fn primary_key_columns_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<Vec<String>, ()> {
    let rows = sqlx::query(&format!("PRAGMA table_info({})", quote_identifier(table)))
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?;
    let mut columns = rows
        .into_iter()
        .map(|row| {
            Ok((
                row.try_get::<i64, _>("pk").map_err(|_| ())?,
                row.try_get::<String, _>("name").map_err(|_| ())?,
            ))
        })
        .collect::<Result<Vec<_>, ()>>()?;
    columns.retain(|(position, _)| *position > 0);
    columns.sort_by_key(|(position, _)| *position);
    (!columns.is_empty())
        .then(|| columns.into_iter().map(|(_, name)| name).collect())
        .ok_or(())
}

async fn foreign_keys_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    schema_objects: &[(String, String, String, String)],
) -> Result<Vec<ForeignKey>, ()> {
    let tables = schema_objects
        .iter()
        .filter(|(kind, _, _, _)| kind == "table")
        .map(|(_, name, _, _)| name.clone())
        .collect::<HashSet<_>>();
    let mut groups =
        HashMap::<(String, i64), (String, String, Vec<(i64, String, Option<String>)>)>::new();
    for child in &tables {
        let rows = sqlx::query_as::<_, (i64, i64, String, String, Option<String>, String)>(
            "SELECT id, seq, \"table\", \"from\", NULLIF(\"to\", ''), on_delete FROM pragma_foreign_key_list(?)",
        )
        .bind(child)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?;
        for (id, sequence, parent, from, to, on_delete) in rows {
            let Some((_, actual_name, _, _)) = schema_objects
                .iter()
                .find(|(kind, name, _, _)| kind == "table" && name.eq_ignore_ascii_case(&parent))
            else {
                return Err(());
            };
            let parent = actual_name.clone();
            let group = groups
                .entry((child.clone(), id))
                .or_insert_with(|| (parent.clone(), on_delete.clone(), Vec::new()));
            if group.0 != parent || !group.1.eq_ignore_ascii_case(&on_delete) {
                return Err(());
            }
            group.2.push((sequence, from, to));
        }
    }
    let mut foreign_keys = Vec::new();
    for ((child, _), (parent, on_delete, mut columns)) in groups {
        columns.sort_by_key(|(sequence, _, _)| *sequence);
        if columns
            .iter()
            .enumerate()
            .any(|(expected, (actual, _, _))| *actual != expected as i64)
        {
            return Err(());
        }
        let implicit = if columns.iter().any(|(_, _, to)| to.is_none()) {
            let primary_key = primary_key_columns_connection(transaction, &parent).await?;
            if primary_key.len() != columns.len() {
                return Err(());
            }
            Some(primary_key)
        } else {
            None
        };
        let columns = columns
            .into_iter()
            .enumerate()
            .map(|(index, (_, from, to))| {
                Ok((
                    from,
                    Some(
                        to.or_else(|| implicit.as_ref().map(|key| key[index].clone()))
                            .ok_or(())?,
                    ),
                ))
            })
            .collect::<Result<Vec<_>, ()>>()?;
        foreign_keys.push(ForeignKey {
            child,
            parent,
            on_delete: on_delete.to_ascii_uppercase(),
            columns,
        });
    }
    foreign_keys.sort_by(|left, right| {
        left.parent
            .cmp(&right.parent)
            .then_with(|| left.child.cmp(&right.child))
            .then_with(|| left.columns.cmp(&right.columns))
    });
    Ok(foreign_keys)
}

fn supported_session_tree_foreign_key(foreign_key: &ForeignKey) -> bool {
    foreign_key.child == foreign_key.parent
        && matches!(foreign_key.child.as_str(), "session" | "session_v2")
        && foreign_key.columns == [("parent_id".to_string(), Some("id".to_string()))]
}

async fn cascade_dependent_snapshots_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    schema_objects: &[(String, String, String, String)],
    targets: &[DeletionTarget],
    ids: &[String],
    has_events: bool,
    has_event_sequences: bool,
    has_lineage: bool,
) -> Result<Vec<RowSnapshot>, ()> {
    let foreign_keys = foreign_keys_connection(transaction, schema_objects).await?;
    let mut queue = Vec::<RowSelection>::new();
    for target in targets {
        if target.schema.is_none() || target.generations.is_empty() {
            continue;
        }
        let bindings = target
            .generations
            .iter()
            .map(|generation| generation.id.clone())
            .collect::<Vec<_>>();
        let placeholders = std::iter::repeat_n("?", bindings.len())
            .collect::<Vec<_>>()
            .join(", ");
        queue.push(RowSelection {
            table: target.table.name().to_string(),
            predicate: format!("{{row}}.\"id\" IN ({placeholders})"),
            bindings,
            path: vec![target.table.name().to_string()],
        });
    }
    let root_tables = [SessionTable::V1.name(), SessionTable::V2.name()]
        .into_iter()
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let mut dependent_paths = HashMap::<String, Vec<(String, Vec<String>)>>::new();
    let mut protected_tables = HashMap::<String, String>::new();
    if has_events {
        protected_tables.insert("event".to_string(), "aggregate_id".to_string());
    }
    if has_event_sequences {
        protected_tables.insert("event_sequence".to_string(), "aggregate_id".to_string());
    }
    if has_lineage {
        protected_tables.insert(LINEAGE_TABLE.to_string(), "session_id".to_string());
    }
    for (table, column) in protected_tables {
        if root_tables.contains(&table) {
            return Err(());
        }
        let placeholders = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(", ");
        let predicate = format!("{{row}}.{} IN ({placeholders})", quote_identifier(&column));
        queue.push(RowSelection {
            table: table.clone(),
            predicate,
            bindings: ids.to_vec(),
            path: vec![table],
        });
    }
    let mut cursor = 0_usize;
    while cursor < queue.len() {
        if queue.len() > 256 {
            return Err(());
        }
        let parent = queue[cursor].clone();
        cursor += 1;
        for foreign_key in foreign_keys
            .iter()
            .filter(|foreign_key| foreign_key.parent == parent.table)
        {
            match foreign_key.on_delete.as_str() {
                "NO ACTION" | "RESTRICT" => continue,
                "SET NULL" | "SET DEFAULT" => return Err(()),
                "CASCADE" => {}
                _ => return Err(()),
            }
            if supported_session_tree_foreign_key(foreign_key) {
                continue;
            }
            if root_tables.contains(&foreign_key.child)
                || parent.path.iter().any(|table| table == &foreign_key.child)
            {
                return Err(());
            }
            let alias = format!("parent_{}", parent.path.len());
            let parent_predicate = parent.predicate.replace("{row}", &alias);
            let relation = foreign_key
                .columns
                .iter()
                .map(|(child, parent)| {
                    Ok(format!(
                        "{alias}.{} = {{row}}.{}",
                        quote_identifier(parent.as_deref().ok_or(())?),
                        quote_identifier(child)
                    ))
                })
                .collect::<Result<Vec<_>, ()>>()?
                .join(" AND ");
            let predicate = format!(
                "EXISTS (SELECT 1 FROM {} {alias} WHERE ({parent_predicate}) AND {relation})",
                quote_identifier(&foreign_key.parent)
            );
            let mut path = parent.path.clone();
            path.push(foreign_key.child.clone());
            dependent_paths
                .entry(foreign_key.child.clone())
                .or_default()
                .push((predicate.clone(), parent.bindings.clone()));
            queue.push(RowSelection {
                table: foreign_key.child.clone(),
                predicate,
                bindings: parent.bindings.clone(),
                path,
            });
        }
    }
    let mut snapshots = Vec::new();
    let mut tables = dependent_paths.into_iter().collect::<Vec<_>>();
    tables.sort_by(|left, right| left.0.cmp(&right.0));
    for (table, paths) in tables {
        if matches!(table.as_str(), "event" | "event_sequence" | LINEAGE_TABLE) {
            continue;
        }
        let predicate = paths
            .iter()
            .map(|(predicate, _)| format!("({})", predicate.replace("{row}", "row")))
            .collect::<Vec<_>>()
            .join(" OR ");
        let bindings = paths
            .into_iter()
            .flat_map(|(_, bindings)| bindings)
            .collect();
        snapshots.push(row_snapshot_connection(transaction, &table, predicate, bindings).await?);
    }
    Ok(snapshots)
}

async fn deletion_plan(pool: &SqlitePool, id: &str) -> Result<Option<DeletionPlan>, ()> {
    let mut transaction = pool.begin().await.map_err(|_| ())?;
    let mut schemas = HashMap::new();
    for table in [SessionTable::V2, SessionTable::V1] {
        schemas.insert(
            table,
            session_schema_connection(&mut transaction, table).await?,
        );
    }
    if schemas.values().all(Option::is_none) {
        return Err(());
    }
    let root = resumable_session_connection(&mut transaction, id, &schemas).await?;
    let Some(root) = root else {
        transaction.commit().await.map_err(|_| ())?;
        return Ok(None);
    };
    let schema_version = sqlx::query_scalar::<_, i64>("PRAGMA schema_version")
        .fetch_one(&mut *transaction)
        .await
        .map_err(|_| ())?;
    let schema_objects = database_schema_objects_connection(&mut transaction).await?;
    if !safe_deletion_triggers(&schema_objects) {
        return Err(());
    }
    let has_events =
        compatible_table_connection(&mut transaction, "event", &["aggregate_id"]).await?;
    let has_event_sequences =
        compatible_table_connection(&mut transaction, "event_sequence", &["aggregate_id"]).await?;
    let _has_session_shares =
        compatible_table_connection(&mut transaction, "session_share", &["session_id"]).await?;
    let union = [SessionTable::V2, SessionTable::V1]
        .into_iter()
        .filter(|table| schemas.get(table).is_some_and(Option::is_some))
        .map(|table| format!("SELECT id, parent_id FROM {}", table.name()))
        .collect::<Vec<_>>()
        .join(" UNION ");
    let mut targets = Vec::new();
    for table in [SessionTable::V2, SessionTable::V1] {
        let schema = schemas.remove(&table).flatten();
        let generations = if let Some(schema) = &schema {
            let selected = selected_columns("row", &schema.columns);
            let query = format!(
                "WITH RECURSIVE descendant_ids(id) AS (VALUES (?) UNION SELECT candidate.id FROM ({union}) candidate JOIN descendant_ids parent ON candidate.parent_id = parent.id) SELECT {selected} FROM {} row JOIN descendant_ids ON descendant_ids.id = row.id ORDER BY row.id",
                table.name()
            );
            sqlx::query(&query)
                .bind(id)
                .fetch_all(&mut *transaction)
                .await
                .map_err(|_| ())?
                .into_iter()
                .map(|row| session_generation_from_row(row, schema.columns.len()))
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        targets.push(DeletionTarget {
            table,
            schema,
            generations,
        });
    }
    targets.sort_by_key(|target| target.table == root.table);
    let mut ids = targets
        .iter()
        .flat_map(|target| &target.generations)
        .map(|generation| generation.id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    ids.sort_unstable();
    let lineage = lineage_states_connection(&mut transaction, &ids).await?;
    let events = if has_events {
        Some(rows_for_ids_connection(&mut transaction, "event", "aggregate_id", &ids).await?)
    } else {
        None
    };
    let event_sequences = if has_event_sequences {
        Some(
            rows_for_ids_connection(&mut transaction, "event_sequence", "aggregate_id", &ids)
                .await?,
        )
    } else {
        None
    };
    let has_lineage = schema_objects
        .iter()
        .any(|(kind, name, _, _)| kind == "table" && name == LINEAGE_TABLE);
    let cascade_dependents = cascade_dependent_snapshots_connection(
        &mut transaction,
        &schema_objects,
        &targets,
        &ids,
        has_events,
        has_event_sequences,
        has_lineage,
    )
    .await?;
    transaction.commit().await.map_err(|_| ())?;
    Ok(Some(DeletionPlan {
        root,
        lineage,
        schema_version,
        schema_objects,
        events,
        event_sequences,
        cascade_dependents,
        targets,
    }))
}

#[cfg(test)]
async fn deletion_targets(
    pool: &SqlitePool,
    id: &str,
    authoritative: SessionTable,
) -> Result<Vec<DeletionTarget>, ()> {
    let plan = deletion_plan(pool, id).await?.ok_or(())?;
    (plan.root.table == authoritative)
        .then_some(plan.targets)
        .ok_or(())
}

fn child_first_generations(
    plan: &DeletionPlan,
) -> Option<Vec<(&DeletionTarget, &SessionGeneration)>> {
    let mut parents = HashMap::<&str, Option<&str>>::new();
    for generation in plan
        .targets
        .iter()
        .flat_map(|target| target.generations.iter())
    {
        let parent = generation.parent_id.as_deref();
        if let Some(previous) = parents.insert(&generation.id, parent)
            && previous != parent
        {
            return None;
        }
    }
    let root_id = plan.root.generation.id.as_str();
    let mut ordered = Vec::new();
    for target in &plan.targets {
        for generation in &target.generations {
            let mut current = generation.id.as_str();
            let mut depth = 0_usize;
            let mut visited = HashSet::new();
            while current != root_id {
                if !visited.insert(current) {
                    return None;
                }
                current = parents.get(current).copied().flatten()?;
                depth = depth.checked_add(1)?;
            }
            ordered.push((depth, target, generation));
        }
    }
    ordered.sort_unstable_by(
        |(left_depth, left_target, left), (right_depth, right_target, right)| {
            right_depth
                .cmp(left_depth)
                .then_with(|| {
                    (left_target.table == plan.root.table)
                        .cmp(&(right_target.table == plan.root.table))
                })
                .then_with(|| left.id.cmp(&right.id))
        },
    );
    Some(
        ordered
            .into_iter()
            .map(|(_, target, generation)| (target, generation))
            .collect(),
    )
}

async fn deletion_postconditions_hold(
    connection: &mut SqliteConnection,
    plan: &DeletionPlan,
    schemas: &HashMap<SessionTable, Option<SessionSchema>>,
    has_events: bool,
    has_event_sequences: bool,
    has_lineage: bool,
) -> Result<bool, ()> {
    let ids = plan
        .targets
        .iter()
        .flat_map(|target| &target.generations)
        .map(|generation| generation.id.as_str())
        .collect::<HashSet<_>>();
    for id in ids {
        for table in [SessionTable::V2, SessionTable::V1] {
            if schemas.get(&table).is_some_and(Option::is_some) {
                let query = format!(
                    "SELECT EXISTS(SELECT 1 FROM {} WHERE id = ? OR parent_id = ?)",
                    table.name()
                );
                if sqlx::query_scalar::<_, i64>(&query)
                    .bind(id)
                    .bind(id)
                    .fetch_one(&mut *connection)
                    .await
                    .map_err(|_| ())?
                    == 1
                {
                    return Ok(false);
                }
            }
        }
        for (present, table, column) in [
            (has_events, "event", "aggregate_id"),
            (has_event_sequences, "event_sequence", "aggregate_id"),
            (has_lineage, LINEAGE_TABLE, "session_id"),
        ] {
            if present {
                let query = format!(
                    "SELECT EXISTS(SELECT 1 FROM {} WHERE {} = ?)",
                    quote_identifier(table),
                    quote_identifier(column)
                );
                if sqlx::query_scalar::<_, i64>(&query)
                    .bind(id)
                    .fetch_one(&mut *connection)
                    .await
                    .map_err(|_| ())?
                    == 1
                {
                    return Ok(false);
                }
            }
        }
    }
    Ok(true)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GenerationDeleteError {
    ExternalActive,
    Stale,
    Shared,
    Failed,
}

fn sqlite_lock_contention(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.code())
        .and_then(|code| code.parse::<i32>().ok())
        .is_some_and(|code| {
            let primary = code & 0xff;
            primary == libsqlite3_sys::SQLITE_BUSY || primary == libsqlite3_sys::SQLITE_LOCKED
        })
}

fn classify_delete_connection_error(error: &sqlx::Error) -> GenerationDeleteError {
    if sqlite_lock_contention(error) {
        GenerationDeleteError::ExternalActive
    } else {
        GenerationDeleteError::Failed
    }
}

#[cfg(target_os = "linux")]
async fn delete_generations_at(
    handle: &HistoryPoolHandle,
    plan: &DeletionPlan,
) -> Result<(), GenerationDeleteError> {
    let metadata = fs::metadata(&handle.path).map_err(|_| GenerationDeleteError::Stale)?;
    if !handle.matches_metadata(&metadata) || !handle.file_is_current() {
        return Err(GenerationDeleteError::Stale);
    }
    let options = SqliteConnectOptions::new()
        .filename(&handle.path)
        .foreign_keys(true)
        .locking_mode(SqliteLockingMode::Exclusive)
        .busy_timeout(Duration::from_secs(2));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| classify_delete_connection_error(&error))?;
    if !handle.connection_is_current(&mut connection).await {
        return Err(GenerationDeleteError::Stale);
    }
    let locking_mode = sqlx::query_scalar::<_, String>("PRAGMA main.locking_mode")
        .fetch_one(&mut connection)
        .await
        .map_err(|error| classify_delete_connection_error(&error))?;
    if !locking_mode.eq_ignore_ascii_case("exclusive") {
        return Err(GenerationDeleteError::Failed);
    }
    sqlx::query("BEGIN EXCLUSIVE")
        .execute(&mut connection)
        .await
        .map_err(|error| classify_delete_connection_error(&error))?;
    let result = async {
        if !handle.connection_is_current(&mut connection).await
            || !handle.is_private_current_user_file()
            || !handle.matches_metadata(
                &fs::metadata(&handle.path).map_err(|_| GenerationDeleteError::Stale)?,
            )
        {
            return Err(GenerationDeleteError::Stale);
        }
        let actual_schema_version = sqlx::query_scalar::<_, i64>("PRAGMA schema_version")
            .fetch_one(&mut connection)
            .await
            .map_err(|_| GenerationDeleteError::Stale)?;
        let actual_schema_objects = database_schema_objects_sqlite_connection(&mut connection)
            .await
            .map_err(|_| GenerationDeleteError::Stale)?;
        if actual_schema_version != plan.schema_version
            || actual_schema_objects != plan.schema_objects
            || !safe_deletion_triggers(&actual_schema_objects)
        {
            return Err(GenerationDeleteError::Stale);
        }
        let mut schemas = HashMap::new();
        for table in [SessionTable::V2, SessionTable::V1] {
            schemas.insert(
                table,
                session_schema_sqlite_connection(&mut connection, table)
                    .await
                    .map_err(|_| GenerationDeleteError::Stale)?,
            );
        }
        let has_lineage = actual_schema_objects
            .iter()
            .any(|(kind, name, _, _)| kind == "table" && name == LINEAGE_TABLE);
        let lineage_ids = plan
            .targets
            .iter()
            .flat_map(|target| &target.generations)
            .map(|generation| generation.id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let actual_lineage = if has_lineage {
            lineage_states_sqlite_connection(&mut connection, &lineage_ids)
                .await
                .map_err(|_| GenerationDeleteError::Stale)?
        } else {
            Vec::new()
        };
        if actual_lineage != plan.lineage {
            return Err(GenerationDeleteError::Stale);
        }
        for target in &plan.targets {
            let actual_schema = schemas.get(&target.table).cloned().flatten();
            if actual_schema != target.schema {
                return Err(GenerationDeleteError::Stale);
            }
        }
        let union = [SessionTable::V2, SessionTable::V1]
            .into_iter()
            .filter(|table| schemas.get(table).is_some_and(Option::is_some))
            .map(|table| format!("SELECT id, parent_id FROM {}", table.name()))
            .collect::<Vec<_>>()
            .join(" UNION ");
        for target in &plan.targets {
            let actual = match schemas.get(&target.table).and_then(Option::as_ref) {
                Some(schema) => session_generations_sqlite_connection(
                    &mut connection,
                    target.table,
                    schema,
                    &union,
                    &plan.root.generation.id,
                )
                .await
                .map_err(|_| GenerationDeleteError::Stale)?,
                None => Vec::new(),
            };
            if actual != target.generations {
                return Err(GenerationDeleteError::Stale);
            }
            if target.schema.is_some()
                && session_generation_is_shared(
                    &mut connection,
                    target.table.name(),
                    &target.generations,
                )
                .await
                .map_err(|_| GenerationDeleteError::Failed)?
            {
                return Err(GenerationDeleteError::Shared);
            }
        }
        let has_event_sequences = compatible_table_sqlite_connection(
            &mut connection,
            "event_sequence",
            &["aggregate_id"],
        )
        .await
        .map_err(|_| GenerationDeleteError::Stale)?;
        let has_events =
            compatible_table_sqlite_connection(&mut connection, "event", &["aggregate_id"])
                .await
                .map_err(|_| GenerationDeleteError::Stale)?;
        if has_event_sequences != plan.event_sequences.is_some()
            || has_events != plan.events.is_some()
        {
            return Err(GenerationDeleteError::Stale);
        }
        for expected in plan
            .events
            .iter()
            .chain(plan.event_sequences.iter())
            .chain(&plan.cascade_dependents)
        {
            let actual = row_snapshot_sqlite_connection(&mut connection, expected)
                .await
                .map_err(|_| GenerationDeleteError::Stale)?;
            if actual != *expected {
                return Err(GenerationDeleteError::Stale);
            }
        }
        let mut deleted_ids = HashSet::new();
        let generations = child_first_generations(plan).ok_or(GenerationDeleteError::Stale)?;
        for (target, generation) in generations {
            let table = target.table.name();
            let deleted = sqlx::query(&format!("DELETE FROM {table} WHERE id = ?"))
                .bind(&generation.id)
                .execute(&mut connection)
                .await
                .map_err(|_| GenerationDeleteError::Failed)?;
            if deleted.rows_affected() != 1 {
                return Err(GenerationDeleteError::Stale);
            }
            deleted_ids.insert(generation.id.as_str());
        }
        {
            let tables = session_tables_sqlite_connection(&mut connection)
                .await
                .map_err(|_| GenerationDeleteError::Failed)?;
            for session_id in deleted_ids {
                let mut still_present = false;
                for table in &tables {
                    let query =
                        format!("SELECT EXISTS(SELECT 1 FROM {} WHERE id = ?)", table.name());
                    if sqlx::query_scalar::<_, i64>(&query)
                        .bind(session_id)
                        .fetch_one(&mut connection)
                        .await
                        .map_err(|_| GenerationDeleteError::Failed)?
                        == 1
                    {
                        still_present = true;
                        break;
                    }
                }
                if !still_present {
                    if has_events {
                        sqlx::query("DELETE FROM event WHERE aggregate_id = ?")
                            .bind(session_id)
                            .execute(&mut connection)
                            .await
                            .map_err(|_| GenerationDeleteError::Failed)?;
                    }
                    if has_event_sequences {
                        sqlx::query("DELETE FROM event_sequence WHERE aggregate_id = ?")
                            .bind(session_id)
                            .execute(&mut connection)
                            .await
                            .map_err(|_| GenerationDeleteError::Failed)?;
                    }
                    if has_lineage {
                        sqlx::query("DELETE FROM _devhatch_session_lineage WHERE session_id = ?")
                            .bind(session_id)
                            .execute(&mut connection)
                            .await
                            .map_err(|_| GenerationDeleteError::Failed)?;
                    }
                }
            }
        }
        if !deletion_postconditions_hold(
            &mut connection,
            plan,
            &schemas,
            has_events,
            has_event_sequences,
            has_lineage,
        )
        .await
        .map_err(|_| GenerationDeleteError::Failed)?
        {
            return Err(GenerationDeleteError::Stale);
        }
        if !handle.connection_is_current(&mut connection).await
            || !handle.is_private_current_user_file()
            || !handle.matches_metadata(
                &fs::metadata(&handle.path).map_err(|_| GenerationDeleteError::Stale)?,
            )
        {
            return Err(GenerationDeleteError::Stale);
        }
        Ok(())
    }
    .await;
    if result.is_ok() {
        #[cfg(test)]
        handle.test_before_delete_commit().await;
        match sqlx::query("COMMIT").execute(&mut connection).await {
            Ok(_) => Ok(()),
            Err(_) => {
                let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
                Err(GenerationDeleteError::Failed)
            }
        }
    } else {
        let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
        result
    }
}

#[cfg(not(target_os = "linux"))]
async fn delete_generations_at(
    _: &HistoryPoolHandle,
    _: &DeletionPlan,
) -> Result<(), GenerationDeleteError> {
    Err(GenerationDeleteError::Stale)
}

async fn session_generation_is_shared(
    connection: &mut SqliteConnection,
    table: &str,
    generations: &[SessionGeneration],
) -> Result<bool, ()> {
    if table_has_columns_connection(connection, table, &["share_url"]).await? {
        for generation in generations {
            let query = format!(
                "SELECT share_url IS NOT NULL AND share_url <> '' FROM {table} WHERE id = ?"
            );
            if sqlx::query_scalar::<_, i64>(&query)
                .bind(&generation.id)
                .fetch_one(&mut *connection)
                .await
                .map_err(|_| ())?
                == 1
            {
                return Ok(true);
            }
        }
    }
    if compatible_table_sqlite_connection(connection, "session_share", &["session_id"]).await? {
        for generation in generations {
            if sqlx::query_scalar::<_, i64>(
                "SELECT EXISTS(SELECT 1 FROM session_share WHERE session_id = ?)",
            )
            .bind(&generation.id)
            .fetch_one(&mut *connection)
            .await
            .map_err(|_| ())?
                == 1
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

async fn table_has_columns_connection(
    connection: &mut SqliteConnection,
    table: &str,
    required: &[&str],
) -> Result<bool, ()> {
    let query = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&query)
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    Ok(required.iter().all(|name| columns.contains(*name)))
}

#[cfg(test)]
async fn remove_legacy_copy_at(
    path: &Path,
    id: &str,
    time_created: i64,
    time_updated: i64,
    expected: Option<&HistoryPoolHandle>,
) -> Result<(), ()> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(2));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| ())?;
    if expected.is_some_and(|handle| !handle.file_is_current()) {
        return Err(());
    }
    let result = sqlx::query(
        "WITH RECURSIVE descendants(id) AS (SELECT id FROM session WHERE id = ? AND time_created = ? AND time_updated = ? UNION SELECT child.id FROM session child JOIN descendants parent ON child.parent_id = parent.id) DELETE FROM session WHERE id IN (SELECT id FROM descendants)",
    )
    .bind(id)
    .bind(time_created)
    .bind(time_updated)
    .execute(&mut connection)
    .await
    .map_err(|_| ())?;
    (result.rows_affected() > 0).then_some(()).ok_or(())
}

#[cfg(test)]
pub(crate) async fn root_session_ids(pool: Option<&SqlitePool>) -> Result<HashSet<String>, ()> {
    let Some(pool) = pool else {
        return Ok(HashSet::new());
    };
    let table = session_table(pool).await.map_err(|_| ())?;
    let query = format!(
        "SELECT id FROM {} WHERE parent_id IS NULL AND time_archived IS NULL",
        table.name()
    );
    sqlx::query_scalar::<_, String>(&query)
        .fetch_all(pool)
        .await
        .map(|ids| ids.into_iter().collect())
        .map_err(|_| ())
}

#[cfg(test)]
pub(crate) async fn new_session_candidates(
    pool: Option<&SqlitePool>,
    directory: &str,
    launched_at: i64,
    baseline: &HashSet<String>,
) -> Result<Vec<String>, ()> {
    let Some(pool) = pool else {
        return Ok(Vec::new());
    };
    let table = session_table(pool).await.map_err(|_| ())?;
    let directory = canonical_identity(directory);
    let query = format!(
        "SELECT id, directory FROM {} WHERE parent_id IS NULL AND time_archived IS NULL AND time_created >= ? ORDER BY time_created ASC",
        table.name()
    );
    sqlx::query_as::<_, (String, String)>(&query)
        .bind(launched_at.saturating_sub(2_000))
        .fetch_all(pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .filter(|(id, candidate_directory)| {
                    !baseline.contains(id) && canonical_identity(candidate_directory) == directory
                })
                .map(|(id, _)| id)
                .collect()
        })
        .map_err(|_| ())
}

#[cfg(test)]
pub(crate) fn unique_unclaimed_session(
    candidates: Vec<String>,
    claimed: &HashSet<String>,
) -> Option<String> {
    let mut candidates = candidates.into_iter().filter(|id| !claimed.contains(id));
    let candidate = candidates.next();
    candidate.filter(|_| candidates.next().is_none())
}

#[cfg(test)]
pub(crate) async fn fork_successor_id(
    pool: Option<&SqlitePool>,
    current_id: &str,
    directory: &str,
    launched_at: i64,
) -> Result<Option<String>, ()> {
    let Some(pool) = pool else { return Ok(None) };
    let table = session_table(pool).await.map_err(|_| ())?;
    let directory = canonical_identity(directory);
    let current_query = format!(
        "SELECT COALESCE(title, ''), time_created, directory FROM {} WHERE id = ? AND parent_id IS NULL AND time_archived IS NULL",
        table.name()
    );
    let current = sqlx::query_as::<_, (String, i64, String)>(&current_query)
        .bind(current_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| ())?;
    let Some((title, created_at, current_directory)) = current else {
        return Ok(None);
    };
    if canonical_identity(&current_directory) != directory {
        return Ok(None);
    }
    let candidates_query = format!(
        "SELECT id, directory FROM {} WHERE parent_id IS NULL AND time_archived IS NULL AND title = ? AND time_created > ? AND time_created >= ? ORDER BY time_created DESC",
        table.name()
    );
    let candidates = sqlx::query_as::<_, (String, String)>(&candidates_query)
        .bind(next_fork_title(&title))
        .bind(created_at)
        .bind(launched_at.saturating_sub(2_000))
        .fetch_all(pool)
        .await
        .map_err(|_| ())?;
    Ok(candidates
        .into_iter()
        .find(|(_, candidate_directory)| canonical_identity(candidate_directory) == directory)
        .map(|(id, _)| id))
}

pub(crate) fn watch_lineage_initialization(
    session: &Arc<crate::session::Session>,
    state: Arc<AppState>,
) {
    let mut events = session.subscribe();
    tokio::spawn(async move {
        if matches!(initialize_lineage(&state).await, Ok(true)) {
            return;
        }
        let deadline = tokio::time::sleep(Duration::from_secs(10));
        tokio::pin!(deadline);
        let mut retries = 0_u8;
        loop {
            tokio::select! {
                _ = &mut deadline => {
                    let _ = initialize_lineage(&state).await;
                    return;
                }
                event = events.recv() => match event {
                    Ok(crate::session::SessionEvent::Output(_)) if retries < 4 => {
                        retries += 1;
                        if matches!(initialize_lineage(&state).await, Ok(true)) {
                            return;
                        }
                    }
                    Ok(crate::session::SessionEvent::Exit(_)
                        | crate::session::SessionEvent::Removed(_)
                        | crate::session::SessionEvent::Terminate)
                    | Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                }
            }
        }
    });
}

pub(crate) async fn initialize_lineage(state: &AppState) -> Result<bool, ()> {
    let _reconciliation = state.history_reconciliation().lock().await;
    initialize_lineage_locked(state).await
}

pub(crate) async fn initialize_lineage_locked(state: &AppState) -> Result<bool, ()> {
    let Some(handle) = state.history_pool().await else {
        return Ok(false);
    };
    let result = reconcile_lineage(&handle).await;
    if result.is_err() {
        state.invalidate_history_pool(&handle).await;
    }
    result
}

async fn reconcile_lineage(handle: &HistoryPoolHandle) -> Result<bool, ()> {
    if !handle.file_is_current() {
        return Err(());
    }
    let ready = reconcile_lineage_at(&handle.path, &handle.pool, Some(handle)).await?;
    handle.file_is_current().then_some(ready).ok_or(())
}

async fn reconcile_lineage_at(
    path: &Path,
    pool: &SqlitePool,
    expected: Option<&HistoryPoolHandle>,
) -> Result<bool, ()> {
    if session_tables(pool).await.map_err(|_| ())?.len() < 2 {
        return Ok(false);
    }
    if lineage_schema_ready(pool).await? {
        return Ok(true);
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(2));
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|_| ())?;
    if let Some(handle) = expected
        && !handle.connection_is_current(&mut connection).await
    {
        return Err(());
    }
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut connection)
        .await
        .map_err(|_| ())?;
    let result = async {
        let table_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'session_v2')",
        )
        .fetch_one(&mut connection)
        .await
        .map_err(|_| ())?;
        if table_count != 2 {
            return Err(());
        }
        let existing_table = sqlx::query_scalar::<_, String>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .bind(LINEAGE_TABLE)
        .fetch_optional(&mut connection)
        .await
        .map_err(|_| ())?;
        for (name, _, _) in LINEAGE_TRIGGERS {
            sqlx::query(&format!("DROP TRIGGER IF EXISTS {name}"))
                .execute(&mut connection)
                .await
                .map_err(|_| ())?;
        }
        match existing_table.as_deref() {
            None => {
                sqlx::query(LINEAGE_CREATE)
                    .execute(&mut connection)
                    .await
                    .map_err(|_| ())?;
            }
            Some(PREVIOUS_LINEAGE_CREATE) => {
                sqlx::query(
                    "ALTER TABLE _devhatch_session_lineage ADD COLUMN v2_time_created INTEGER",
                )
                .execute(&mut connection)
                .await
                .map_err(|_| ())?;
            }
            Some(LINEAGE_CREATE | UPGRADED_LINEAGE_CREATE) => {}
            Some(_) => return Err(()),
        }
        for (_, _, statement) in LINEAGE_TRIGGERS {
            sqlx::query(statement)
                .execute(&mut connection)
                .await
                .map_err(|_| ())?;
        }
        sqlx::query("INSERT INTO _devhatch_session_lineage (session_id, v1_time_created, v1_time_updated, v2_time_created, v2_time_updated, v1_present, v2_present, v2_deleted) SELECT id, time_created, time_updated, NULL, NULL, 1, 0, 0 FROM session WHERE 1 ON CONFLICT(session_id) DO UPDATE SET v2_deleted = CASE WHEN _devhatch_session_lineage.v2_deleted = 1 AND _devhatch_session_lineage.v1_time_created = excluded.v1_time_created AND excluded.v1_time_updated <= _devhatch_session_lineage.v2_time_updated THEN 1 ELSE 0 END, v1_time_created = excluded.v1_time_created, v1_time_updated = excluded.v1_time_updated, v1_present = 1")
            .execute(&mut connection)
            .await
            .map_err(|_| ())?;
        sqlx::query("INSERT INTO _devhatch_session_lineage (session_id, v1_time_created, v1_time_updated, v2_time_created, v2_time_updated, v1_present, v2_present, v2_deleted) SELECT id, NULL, NULL, time_created, time_updated, 0, 1, 0 FROM session_v2 WHERE 1 ON CONFLICT(session_id) DO UPDATE SET v2_time_created = excluded.v2_time_created, v2_time_updated = excluded.v2_time_updated, v2_present = 1, v2_deleted = 0")
            .execute(&mut connection)
            .await
            .map_err(|_| ())?;
        sqlx::query("UPDATE _devhatch_session_lineage SET v1_present = 0 WHERE v1_present = 1 AND NOT EXISTS (SELECT 1 FROM session WHERE session.id = _devhatch_session_lineage.session_id AND session.time_created = _devhatch_session_lineage.v1_time_created)")
            .execute(&mut connection)
            .await
            .map_err(|_| ())?;
        sqlx::query("UPDATE _devhatch_session_lineage SET v2_present = 0, v2_deleted = CASE WHEN v1_present = 1 AND v1_time_created = v2_time_created AND v1_time_updated <= v2_time_updated THEN 1 ELSE 0 END WHERE v2_present = 1 AND NOT EXISTS (SELECT 1 FROM session_v2 WHERE session_v2.id = _devhatch_session_lineage.session_id AND session_v2.time_created = _devhatch_session_lineage.v2_time_created)")
            .execute(&mut connection)
            .await
            .map_err(|_| ())?;
        sqlx::query("DELETE FROM _devhatch_session_lineage WHERE v1_present = 0 AND v2_present = 0 AND v2_deleted = 0")
            .execute(&mut connection)
            .await
            .map_err(|_| ())?;
        Ok(())
    }
    .await;
    if result.is_ok() {
        sqlx::query("COMMIT")
            .execute(&mut connection)
            .await
            .map_err(|_| ())?;
        Ok(true)
    } else {
        let _ = sqlx::query("ROLLBACK").execute(&mut connection).await;
        Err(())
    }
}

async fn lineage_schema_ready(pool: &SqlitePool) -> Result<bool, ()> {
    let columns = sqlx::query(&format!("PRAGMA table_info({LINEAGE_TABLE})"))
        .fetch_all(pool)
        .await
        .map_err(|_| ())?
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    if !REQUIRED_LINEAGE_COLUMNS
        .iter()
        .all(|column| columns.contains(*column))
    {
        return Ok(false);
    }
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE (type = 'table' AND name = ?) OR (type = 'trigger' AND name IN ('_devhatch_lineage_v1_insert', '_devhatch_lineage_v1_update', '_devhatch_lineage_v1_delete', '_devhatch_lineage_v2_insert', '_devhatch_lineage_v2_update', '_devhatch_lineage_v2_delete'))",
    )
    .bind(LINEAGE_TABLE)
    .fetch_all(pool)
    .await
    .map_err(|_| ())?;
    Ok(lineage_objects_ready(rows))
}

fn lineage_objects_ready(rows: Vec<(String, String, String)>) -> bool {
    if rows.len() != LINEAGE_TRIGGERS.len() + 1 {
        return false;
    }
    let objects = rows
        .into_iter()
        .map(|(name, table, sql)| (name, (table, sql)))
        .collect::<HashMap<_, _>>();
    if objects.get(LINEAGE_TABLE).is_none_or(|(table, sql)| {
        table != LINEAGE_TABLE || !matches!(sql.as_str(), LINEAGE_CREATE | UPGRADED_LINEAGE_CREATE)
    }) {
        return false;
    }
    LINEAGE_TRIGGERS.iter().all(|(name, table, sql)| {
        objects
            .get(*name)
            .is_some_and(|(actual_table, actual_sql)| actual_table == table && actual_sql == sql)
    })
}

#[cfg(test)]
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

async fn lineage_states_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ids: &[String],
) -> Result<Vec<LineageState>, ()> {
    if ids.is_empty() || !lineage_tombstones_available_connection(transaction).await? {
        return Ok(Vec::new());
    }
    let values = std::iter::repeat_n("(?)", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let columns = table_columns_connection(transaction, LINEAGE_TABLE).await?;
    let selected = selected_columns("lineage", &columns);
    let query = format!(
        "WITH requested(id) AS (VALUES {values}) SELECT {selected} FROM _devhatch_session_lineage lineage JOIN requested ON requested.id = lineage.session_id ORDER BY lineage.session_id"
    );
    let mut query = sqlx::query(&query);
    for id in ids {
        query = query.bind(id);
    }
    query
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?
        .into_iter()
        .map(|row| row_fingerprint(&row, columns.len()))
        .collect()
}

async fn lineage_tombstones_available_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<bool, ()> {
    let rows = sqlx::query(&format!("PRAGMA table_info({LINEAGE_TABLE})"))
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    Ok(TOMBSTONE_LINEAGE_COLUMNS
        .iter()
        .all(|name| columns.contains(*name)))
}

async fn resumable_session_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    schemas: &HashMap<SessionTable, Option<SessionSchema>>,
) -> Result<Option<ResumableSession>, ()> {
    let has_lineage = lineage_tombstones_available_connection(transaction).await?;
    let tombstoned_generation = if has_lineage {
        sqlx::query_scalar::<_, i64>(
            "SELECT v1_time_created FROM _devhatch_session_lineage WHERE session_id = ? AND v1_present = 1 AND v2_present = 0 AND v2_deleted = 1",
        )
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await
        .map_err(|_| ())?
    } else {
        None
    };
    let mut selected: Option<ResumableSession> = None;
    for table in [SessionTable::V2, SessionTable::V1] {
        let Some(schema) = schemas.get(&table).and_then(Option::as_ref) else {
            continue;
        };
        let Some(generation) =
            session_generation_connection(transaction, table, schema, id).await?
        else {
            continue;
        };
        if table == SessionTable::V1 && tombstoned_generation == Some(generation.time_created) {
            continue;
        }
        let replace = selected.as_ref().is_none_or(|current| {
            generation.time_updated > current.generation.time_updated
                || (generation.time_updated == current.generation.time_updated
                    && table == SessionTable::V2
                    && current.table == SessionTable::V1)
        });
        if replace {
            selected = Some(ResumableSession { generation, table });
        }
    }
    Ok(selected.filter(|session| {
        session.generation.parent_id.is_none() && session.generation.time_archived.is_none()
    }))
}

async fn resumable_session(
    pool: Option<&SqlitePool>,
    id: &str,
) -> Result<Option<ResumableSession>, ()> {
    let Some(pool) = pool else { return Ok(None) };
    let mut transaction = pool.begin().await.map_err(|_| ())?;
    let mut schemas = HashMap::new();
    for table in [SessionTable::V2, SessionTable::V1] {
        schemas.insert(
            table,
            session_schema_connection(&mut transaction, table).await?,
        );
    }
    if schemas.values().all(Option::is_none) {
        return Err(());
    }
    let selected = resumable_session_connection(&mut transaction, id, &schemas).await?;
    transaction.commit().await.map_err(|_| ())?;
    Ok(selected)
}

pub(crate) fn valid_session_id(value: &str) -> bool {
    let suffix = value.strip_prefix("ses_");
    matches!(suffix, Some(value) if !value.is_empty() && value.len() <= 124 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

async fn history_rows(pool: &SqlitePool) -> Result<Vec<HistoryRow>, &'static str> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| "OPENCODE_HISTORY_QUERY_FAILED")?;
    let tables = session_tables_connection(&mut transaction).await?;
    let has_lineage = lineage_tombstones_available_connection(&mut transaction)
        .await
        .map_err(|_| "OPENCODE_HISTORY_QUERY_FAILED")?;
    let tombstones = if has_lineage {
        sqlx::query_as::<_, (String, i64)>(
            "SELECT session_id, v1_time_created FROM _devhatch_session_lineage WHERE v1_present = 1 AND v2_present = 0 AND v2_deleted = 1",
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(|_| "OPENCODE_HISTORY_QUERY_FAILED")?
        .into_iter()
        .collect::<HashMap<_, _>>()
    } else {
        HashMap::new()
    };
    let mut selected = HashMap::<String, (HistoryRow, SessionTable)>::new();
    for table in tables {
        let query = format!(
            "SELECT s.id, COALESCE(s.title, 'Untitled session') AS title, s.directory, s.project_id, p.name AS project_name, p.worktree AS project_worktree, s.time_created, s.time_updated, s.parent_id, s.time_archived FROM {} s LEFT JOIN project p ON p.id = s.project_id",
            table.name()
        );
        let table_rows = sqlx::query_as::<_, HistoryRow>(&query)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|_| "OPENCODE_HISTORY_QUERY_FAILED")?;
        for row in table_rows {
            if table == SessionTable::V1 && tombstones.get(&row.id) == Some(&row.time_created) {
                continue;
            }
            let replace = selected
                .get(&row.id)
                .is_none_or(|(current, current_table)| {
                    row.time_updated > current.time_updated
                        || (row.time_updated == current.time_updated
                            && table == SessionTable::V2
                            && *current_table == SessionTable::V1)
                });
            if replace {
                selected.insert(row.id.clone(), (row, table));
            }
        }
    }
    transaction
        .commit()
        .await
        .map_err(|_| "OPENCODE_HISTORY_QUERY_FAILED")?;
    let mut rows = selected
        .into_values()
        .map(|(row, _)| row)
        .filter(|row| row.parent_id.is_none() && row.time_archived.is_none())
        .collect::<Vec<_>>();
    rows.sort_unstable_by(|left, right| {
        right
            .time_updated
            .cmp(&left.time_updated)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(rows)
}

async fn session_schema_sqlite_connection(
    connection: &mut SqliteConnection,
    table: SessionTable,
) -> Result<Option<SessionSchema>, ()> {
    let Some(sql) = sqlx::query_scalar::<_, String>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(table.name())
    .fetch_optional(&mut *connection)
    .await
    .map_err(|_| ())?
    else {
        return Ok(None);
    };
    let rows = sqlx::query(&format!("PRAGMA table_xinfo({})", table.name()))
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<Vec<_>>();
    if !REQUIRED_SESSION_COLUMNS
        .iter()
        .all(|required| columns.iter().any(|column| column == required))
    {
        return Err(());
    }
    Ok(Some(SessionSchema { sql, columns }))
}

async fn session_generations_sqlite_connection(
    connection: &mut SqliteConnection,
    table: SessionTable,
    schema: &SessionSchema,
    union: &str,
    id: &str,
) -> Result<Vec<SessionGeneration>, ()> {
    let selected = selected_columns("row", &schema.columns);
    let query = format!(
        "WITH RECURSIVE descendant_ids(id) AS (VALUES (?) UNION SELECT candidate.id FROM ({union}) candidate JOIN descendant_ids parent ON candidate.parent_id = parent.id) SELECT {selected} FROM {} row JOIN descendant_ids ON descendant_ids.id = row.id ORDER BY row.id",
        table.name()
    );
    sqlx::query(&query)
        .bind(id)
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| ())?
        .into_iter()
        .map(|row| session_generation_from_row(row, schema.columns.len()))
        .collect()
}

async fn table_columns_sqlite_connection(
    connection: &mut SqliteConnection,
    table: &str,
) -> Result<Vec<String>, ()> {
    let rows = sqlx::query(&format!("PRAGMA table_xinfo({})", quote_identifier(table)))
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| ())?;
    let columns = rows
        .into_iter()
        .map(|row| row.try_get::<String, _>("name").map_err(|_| ()))
        .collect::<Result<Vec<_>, _>>()?;
    (!columns.is_empty()).then_some(columns).ok_or(())
}

async fn row_snapshot_sqlite_connection(
    connection: &mut SqliteConnection,
    expected: &RowSnapshot,
) -> Result<RowSnapshot, ()> {
    let columns = table_columns_sqlite_connection(connection, &expected.table).await?;
    let selected = selected_columns("row", &columns);
    let query = format!(
        "SELECT {selected} FROM {} row WHERE ({})",
        quote_identifier(&expected.table),
        expected.predicate
    );
    let mut query = sqlx::query(&query);
    for binding in &expected.bindings {
        query = query.bind(binding);
    }
    let mut rows = query
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| ())?
        .into_iter()
        .map(|row| row_fingerprint(&row, columns.len()))
        .collect::<Result<Vec<_>, _>>()?;
    rows.sort_unstable();
    Ok(RowSnapshot {
        table: expected.table.clone(),
        predicate: expected.predicate.clone(),
        bindings: expected.bindings.clone(),
        rows,
    })
}

async fn database_schema_objects_sqlite_connection(
    connection: &mut SqliteConnection,
) -> Result<Vec<(String, String, String, String)>, ()> {
    sqlx::query_as::<_, (String, String, String, String)>(
        "SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger') ORDER BY type, name",
    )
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| ())
}

async fn compatible_table_sqlite_connection(
    connection: &mut SqliteConnection,
    table: &str,
    required: &[&str],
) -> Result<bool, ()> {
    let objects = sqlx::query_as::<_, (String, String)>(
        "SELECT name, type FROM sqlite_master WHERE name = ? COLLATE NOCASE AND type IN ('table', 'index', 'view', 'trigger')",
    )
    .bind(table)
    .fetch_all(&mut *connection)
    .await
    .map_err(|_| ())?;
    if objects.is_empty() {
        return Ok(false);
    }
    if objects.len() != 1 || objects[0].0 != table || objects[0].1 != "table" {
        return Err(());
    }
    table_has_columns_connection(connection, table, required)
        .await?
        .then_some(true)
        .ok_or(())
}

async fn lineage_states_sqlite_connection(
    connection: &mut SqliteConnection,
    ids: &[String],
) -> Result<Vec<LineageState>, ()> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let values = std::iter::repeat_n("(?)", ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let columns = table_columns_sqlite_connection(connection, LINEAGE_TABLE).await?;
    let selected = selected_columns("lineage", &columns);
    let query = format!(
        "WITH requested(id) AS (VALUES {values}) SELECT {selected} FROM _devhatch_session_lineage lineage JOIN requested ON requested.id = lineage.session_id ORDER BY lineage.session_id"
    );
    let mut query = sqlx::query(&query);
    for id in ids {
        query = query.bind(id);
    }
    query
        .fetch_all(&mut *connection)
        .await
        .map_err(|_| ())?
        .into_iter()
        .map(|row| row_fingerprint(&row, columns.len()))
        .collect()
}

async fn session_tables_sqlite_connection(
    connection: &mut SqliteConnection,
) -> Result<Vec<SessionTable>, ()> {
    let mut tables = Vec::new();
    for table in [SessionTable::V2, SessionTable::V1] {
        if table_has_columns_connection(connection, table.name(), REQUIRED_SESSION_COLUMNS).await? {
            tables.push(table);
        }
    }
    (!tables.is_empty()).then_some(tables).ok_or(())
}

async fn session_tables_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<Vec<SessionTable>, &'static str> {
    let mut tables = Vec::new();
    if table_has_required_columns_connection(transaction, SessionTable::V2.name()).await? {
        tables.push(SessionTable::V2);
    }
    if table_has_required_columns_connection(transaction, SessionTable::V1.name()).await? {
        tables.push(SessionTable::V1);
    }
    if tables.is_empty() {
        Err("OPENCODE_HISTORY_SCHEMA_UNSUPPORTED")
    } else {
        Ok(tables)
    }
}

async fn table_has_required_columns_connection(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    table: &str,
) -> Result<bool, &'static str> {
    let query = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&query)
        .fetch_all(&mut **transaction)
        .await
        .map_err(|_| "OPENCODE_HISTORY_SCHEMA_UNAVAILABLE")?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    Ok(REQUIRED_SESSION_COLUMNS
        .iter()
        .all(|name| columns.contains(*name)))
}

async fn session_tables(pool: &SqlitePool) -> Result<Vec<SessionTable>, &'static str> {
    let mut tables = Vec::new();
    if table_has_required_columns(pool, SessionTable::V2.name()).await? {
        tables.push(SessionTable::V2);
    }
    if table_has_required_columns(pool, SessionTable::V1.name()).await? {
        tables.push(SessionTable::V1);
    }
    if tables.is_empty() {
        Err("OPENCODE_HISTORY_SCHEMA_UNSUPPORTED")
    } else {
        Ok(tables)
    }
}

#[cfg(test)]
async fn session_table(pool: &SqlitePool) -> Result<SessionTable, &'static str> {
    session_tables(pool).await.map(|tables| tables[0])
}

async fn table_has_required_columns(pool: &SqlitePool, table: &str) -> Result<bool, &'static str> {
    let query = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|_| "OPENCODE_HISTORY_SCHEMA_UNAVAILABLE")?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    Ok(REQUIRED_SESSION_COLUMNS
        .iter()
        .all(|name| columns.contains(*name)))
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
    if current_time.saturating_sub(row.time_updated) > RECENT_MILLIS {
        return Presence::Inactive;
    }
    let directory = canonical_identity(&row.directory);
    if external_directories.contains(&directory) {
        Presence::PossiblyActiveElsewhere
    } else {
        Presence::Inactive
    }
}

async fn external_opencode_directories(owned: HashSet<u32>) -> HashSet<String> {
    tokio::task::spawn_blocking(move || scan_external_opencode_directories(&owned))
        .await
        .unwrap_or_default()
}

fn scan_external_opencode_directories(owned: &HashSet<u32>) -> HashSet<String> {
    let Ok(entries) = fs::read_dir("/proc") else {
        return HashSet::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_string_lossy().parse::<u32>().ok()?;
            if owned.contains(&pid) {
                return None;
            }
            let comm = fs::read_to_string(entry.path().join("comm")).ok()?;
            if comm.trim() != "opencode" || has_owned_ancestor(pid, owned) {
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
    use super::{
        GenerationDeleteError, HistoryRow, Presence, SessionTable, canonical_identity,
        delete_generations_at, deletion_plan, deletion_targets, fork_successor_id, history_rows,
        new_session_candidates, next_fork_title, presence_for, reconcile_lineage_at,
        remove_legacy_copy_at, resumable_session, session_generation_is_shared, session_table,
        unique_unclaimed_session,
    };
    use sqlx::{
        Connection, SqliteConnection, SqlitePool,
        sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    };
    use std::{
        collections::HashSet, fs, os::unix::fs::PermissionsExt, path::Path, sync::Arc,
        time::Duration,
    };
    use tempfile::TempDir;

    use crate::state::{AppState, OpenCodeHistoryPool};

    async fn history_database() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(":memory:")
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT, worktree TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn v2_history_database() -> SqlitePool {
        let pool = history_database().await;
        sqlx::query("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    async fn file_history_database(root: &TempDir) -> (std::path::PathBuf, SqlitePool) {
        let path = root.path().join("opencode.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        #[cfg(unix)]
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        sqlx::query("CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT, worktree TEXT); CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, share_url TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER); CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT, share_url TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        (path, pool)
    }

    async fn insert_session(
        pool: &SqlitePool,
        id: &str,
        title: &str,
        directory: &Path,
        created: i64,
    ) {
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES (?, NULL, NULL, ?, ?, ?, ?, NULL)")
            .bind(id)
            .bind(directory.to_string_lossy().as_ref())
            .bind(title)
            .bind(created)
            .bind(created)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn test_state(root: &TempDir, history_path: std::path::PathBuf) -> AppState {
        let application_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&application_pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        AppState::new(
            root.path().to_owned(),
            application_pool,
            OpenCodeHistoryPool::new(history_path),
            skillink,
            None,
            false,
        )
    }

    async fn resumable_identity(pool: &SqlitePool, id: &str) -> Option<(String, SessionTable)> {
        resumable_session(Some(pool), id)
            .await
            .unwrap()
            .map(|session| (session.generation.directory, session.table))
    }

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
            parent_id: None,
            time_archived: None,
        }
    }

    #[tokio::test]
    async fn prepare_resume_fails_closed_without_opening_history_database() {
        let root = TempDir::new().unwrap();
        let history_path = root.path().join("missing-opencode.db");
        let state = test_state(&root, history_path.clone()).await;

        assert_eq!(
            super::prepare(&state, Some("ses_target"), true).await,
            Err(crate::history::HistoryError::Unavailable)
        );
        assert!(!history_path.exists());
    }

    #[tokio::test]
    async fn prepare_resume_uses_the_trusted_history_cwd_for_v1_and_v2() {
        for v2 in [false, true] {
            let root = TempDir::new().unwrap();
            let cwd = root.path().join("work");
            fs::create_dir(&cwd).unwrap();
            let (path, pool) = file_history_database(&root).await;
            let table = if v2 { "session_v2" } else { "session" };
            sqlx::query(&format!(
                "INSERT INTO {table} (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_resume', NULL, NULL, ?, 'Resume', 1, 2, NULL)"
            ))
            .bind(cwd.to_string_lossy().as_ref())
            .execute(&pool)
            .await
            .unwrap();
            pool.close().await;
            let state = test_state(&root, path).await;

            assert_eq!(
                super::prepare(&state, Some("ses_resume"), v2).await,
                Ok(crate::history::PreparedLaunch::OpenCodeResume {
                    id: "ses_resume".into(),
                    cwd: fs::canonicalize(&cwd).unwrap(),
                })
            );
        }
    }

    #[tokio::test]
    async fn prepare_resume_rejects_a_session_from_the_other_runtime_generation() {
        let root = TempDir::new().unwrap();
        let v1_cwd = root.path().join("v1-work");
        let v2_cwd = root.path().join("v2-work");
        fs::create_dir(&v1_cwd).unwrap();
        fs::create_dir(&v2_cwd).unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_resume', NULL, NULL, ?, 'V1', 1, 1, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_resume', NULL, NULL, ?, 'V2', 1, 2, NULL)")
            .bind(v1_cwd.to_string_lossy().as_ref())
            .bind(v2_cwd.to_string_lossy().as_ref())
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let state = test_state(&root, path).await;

        assert_eq!(
            super::prepare(&state, Some("ses_resume"), false).await,
            Err(crate::history::HistoryError::Unavailable)
        );
        assert_eq!(
            super::prepare(&state, Some("ses_resume"), true).await,
            Ok(crate::history::PreparedLaunch::OpenCodeResume {
                id: "ses_resume".into(),
                cwd: fs::canonicalize(&v2_cwd).unwrap(),
            })
        );
    }

    #[tokio::test]
    async fn prepare_resume_rejects_non_root_archived_and_untrusted_directories() {
        let root = TempDir::new().unwrap();
        let cwd = root.path().join("work");
        fs::create_dir(&cwd).unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_parent', NULL, NULL, ?, 'Parent', 1, 1, NULL), ('ses_child', NULL, 'ses_parent', ?, 'Child', 2, 2, NULL), ('ses_archived', NULL, NULL, ?, 'Archived', 3, 3, 4), ('ses_relative', NULL, NULL, 'relative', 'Relative', 5, 5, NULL), ('ses_missing', NULL, NULL, ?, 'Missing', 6, 6, NULL)")
            .bind(cwd.to_string_lossy().as_ref())
            .bind(cwd.to_string_lossy().as_ref())
            .bind(cwd.to_string_lossy().as_ref())
            .bind(root.path().join("missing").to_string_lossy().as_ref())
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let state = test_state(&root, path).await;

        for id in ["ses_child", "ses_archived"] {
            assert_eq!(
                super::prepare(&state, Some(id), true).await,
                Err(crate::history::HistoryError::NotFound)
            );
        }
        for id in ["ses_relative", "ses_missing"] {
            assert_eq!(
                super::prepare(&state, Some(id), true).await,
                Err(crate::history::HistoryError::InvalidCwd)
            );
        }
    }

    #[tokio::test]
    async fn prepare_resume_rejects_invalid_ids_before_database_access() {
        let root = TempDir::new().unwrap();
        let history_path = root.path().join("missing-opencode.db");
        let state = test_state(&root, history_path.clone()).await;

        assert_eq!(
            super::prepare(&state, Some("../session"), true).await,
            Err(crate::history::HistoryError::InvalidId)
        );
        assert!(!history_path.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reconciliation_matches_canonical_directory_aliases() {
        use std::os::unix::fs::symlink;

        let root = TempDir::new().unwrap();
        let canonical = root.path().join("canonical");
        let alias = root.path().join("alias");
        fs::create_dir(&canonical).unwrap();
        symlink(&canonical, &alias).unwrap();
        let pool = history_database().await;
        insert_session(&pool, "ses_current", "Original", &canonical, 10_000).await;
        insert_session(
            &pool,
            "ses_successor",
            "Original (fork #1)",
            &canonical,
            11_000,
        )
        .await;

        assert_eq!(
            new_session_candidates(
                Some(&pool),
                alias.to_string_lossy().as_ref(),
                10_000,
                &HashSet::from(["ses_successor".to_string()]),
            )
            .await
            .unwrap(),
            vec!["ses_current".to_string()]
        );
        assert_eq!(
            fork_successor_id(
                Some(&pool),
                "ses_current",
                alias.to_string_lossy().as_ref(),
                10_000,
            )
            .await
            .unwrap(),
            Some("ses_successor".to_string())
        );
    }

    #[tokio::test]
    async fn prefers_v2_history_schema_when_both_are_present() {
        let pool = v2_history_database().await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v2', NULL, NULL, '/tmp', NULL, 1, 1, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(session_table(&pool).await.unwrap(), SessionTable::V2);
        assert_eq!(
            super::root_session_ids(Some(&pool)).await.unwrap(),
            HashSet::from(["ses_v2".to_string()])
        );
    }

    #[tokio::test]
    async fn merges_schemas_by_latest_update_and_deduplicates_ids() {
        let pool = v2_history_database().await;
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v1_only', NULL, NULL, '/v1', 'V1 only', 1, 3, NULL), ('ses_shared', NULL, NULL, '/legacy', 'Later V1 duplicate', 1, 9, NULL), ('ses_v1_reactivated', NULL, NULL, '/legacy-reactivated', 'Later V1 active copy', 1, 10, NULL), ('ses_v2_archived', NULL, NULL, '/legacy-archived', 'Older V1 active copy', 1, 1, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v2_only', NULL, NULL, '/v2', NULL, 1, 4, NULL), ('ses_shared', NULL, NULL, '/canonical', 'Older V2 duplicate', 1, 2, NULL), ('ses_v1_reactivated', NULL, NULL, '/canonical-archived', 'Older V2 archived copy', 1, 8, 7), ('ses_v2_archived', NULL, NULL, '/canonical-archived-newer', 'Later V2 archived copy', 1, 8, 7)")
            .execute(&pool)
            .await
            .unwrap();

        let rows = history_rows(&pool).await.unwrap();
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec![
                "ses_v1_reactivated",
                "ses_shared",
                "ses_v2_only",
                "ses_v1_only"
            ]
        );
        assert_eq!(rows[1].directory, "/legacy");
        assert_eq!(rows[1].title, "Later V1 duplicate");
        assert_eq!(
            resumable_identity(&pool, "ses_v1_only").await,
            Some(("/v1".into(), SessionTable::V1))
        );
        assert_eq!(
            resumable_identity(&pool, "ses_shared").await,
            Some(("/legacy".into(), SessionTable::V1))
        );
        assert_eq!(
            resumable_identity(&pool, "ses_v1_reactivated").await,
            Some(("/legacy-reactivated".into(), SessionTable::V1))
        );
        let targets = deletion_targets(&pool, "ses_shared", SessionTable::V1)
            .await
            .unwrap();
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].table, SessionTable::V2);
        assert_eq!(targets[0].generations[0].directory, "/canonical");
        assert_eq!(targets[0].generations[0].time_updated, 2);
        assert_eq!(targets[1].table, SessionTable::V1);
        assert_eq!(targets[1].generations[0].directory, "/legacy");
        assert_eq!(targets[1].generations[0].time_updated, 9);
        assert_eq!(
            resumable_session(Some(&pool), "ses_v2_archived")
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn external_v2_delete_tombstones_the_observed_legacy_copy() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/legacy', 'Legacy', 1, 1, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/v2', 'Current', 1, 1, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        assert_eq!(
            sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT v1_present, v2_present, v2_deleted FROM _devhatch_session_lineage WHERE session_id = 'ses_shared'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            (1, 1, 0)
        );

        let mut external = SqliteConnection::connect_with(
            &SqliteConnectOptions::new()
                .filename(&path)
                .foreign_keys(true),
        )
        .await
        .unwrap();
        sqlx::query("DELETE FROM session_v2 WHERE id = 'ses_shared'")
            .execute(&mut external)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT v1_present, v2_present, v2_deleted FROM _devhatch_session_lineage WHERE session_id = 'ses_shared'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            (1, 0, 1)
        );
        assert!(history_rows(&pool).await.unwrap().is_empty());
        assert_eq!(
            resumable_session(Some(&pool), "ses_shared").await.unwrap(),
            None
        );
        sqlx::query("UPDATE session SET time_updated = time_updated WHERE id = 'ses_shared'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(history_rows(&pool).await.unwrap().is_empty());
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT v2_deleted FROM _devhatch_session_lineage WHERE session_id = 'ses_shared'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );

        sqlx::query("INSERT OR REPLACE INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/same-generation', 'Same generation', 1, 1, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(history_rows(&pool).await.unwrap().is_empty());
        sqlx::query("UPDATE session SET time_updated = 2 WHERE id = 'ses_shared'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            history_rows(&pool).await.unwrap()[0].directory,
            "/same-generation"
        );

        sqlx::query("DELETE FROM session WHERE id = 'ses_shared'; INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/new-v1', 'New V1', 2, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(history_rows(&pool).await.unwrap()[0].directory, "/new-v1");

        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_reactivated', NULL, NULL, '/reactivated', 'Reactivated', 3, 10, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_reactivated', NULL, NULL, '/stale-v2', 'Stale V2', 3, 8, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        sqlx::query("DELETE FROM session_v2 WHERE id = 'ses_reactivated'")
            .execute(&mut external)
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_as::<_, (i64, i64, i64)>(
                "SELECT v1_present, v2_present, v2_deleted FROM _devhatch_session_lineage WHERE session_id = 'ses_reactivated'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            (1, 0, 0)
        );
        assert_eq!(
            resumable_identity(&pool, "ses_reactivated").await,
            Some(("/reactivated".into(), SessionTable::V1))
        );
    }

    #[tokio::test]
    async fn lineage_triggers_do_not_depend_on_the_other_session_table() {
        let first = TempDir::new().unwrap();
        let (first_path, first_pool) = file_history_database(&first).await;
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/legacy', 'Legacy', 1, 1, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/v2', 'V2', 1, 1, NULL)")
            .execute(&first_pool)
            .await
            .unwrap();
        reconcile_lineage_at(&first_path, &first_pool, None)
            .await
            .unwrap();
        sqlx::query("DELETE FROM session_v2 WHERE id = 'ses_shared'; DROP TABLE session_v2")
            .execute(&first_pool)
            .await
            .unwrap();
        assert!(history_rows(&first_pool).await.unwrap().is_empty());
        assert_eq!(
            resumable_session(Some(&first_pool), "ses_shared")
                .await
                .unwrap(),
            None
        );
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v1_after_drop', NULL, NULL, '/v1', 'V1', 1, 1, NULL)")
            .execute(&first_pool)
            .await
            .unwrap();

        let second = TempDir::new().unwrap();
        let (second_path, second_pool) = file_history_database(&second).await;
        reconcile_lineage_at(&second_path, &second_pool, None)
            .await
            .unwrap();
        sqlx::query("DROP TABLE session; INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v2_after_drop', NULL, NULL, '/v2', 'V2', 1, 1, NULL)")
            .execute(&second_pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn deletion_rejects_a_malformed_reserved_trigger_without_repairing_it() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        let malformed = "CREATE TRIGGER _devhatch_lineage_v2_delete AFTER DELETE ON session_v2 BEGIN SELECT 1; END";
        sqlx::query("DROP TRIGGER _devhatch_lineage_v2_delete")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(malformed).execute(&pool).await.unwrap();
        pool.close().await;

        let application_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&application_pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        let state = AppState::new(
            root.path().to_owned(),
            application_pool,
            OpenCodeHistoryPool::new(path.clone()),
            skillink,
            None,
            false,
        );
        let coordinator = state.history_coordinator();
        let _reconciliation = coordinator.lock().lock().await;
        let mut deletion = coordinator
            .begin(crate::agent::OPENCODE_ID, "ses_root")
            .unwrap();
        assert!(matches!(
            super::delete(&state, "ses_root".into(), &mut deletion).await,
            Err(crate::history::DeleteError::History(
                crate::history::HistoryError::Unavailable
            ))
        ));
        let handle = state.history_pool().await.unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = '_devhatch_lineage_v2_delete'",
            )
            .fetch_one(&handle.pool)
            .await
            .unwrap(),
            malformed
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_root'",)
                .fetch_one(&handle.pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn deletion_plan_rejects_mixed_case_durable_tables() {
        let root = TempDir::new().unwrap();
        let (_path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE Event (id TEXT PRIMARY KEY, aggregate_id TEXT); CREATE TABLE Event_Part (id TEXT PRIMARY KEY, event_id TEXT REFERENCES Event(id) ON DELETE CASCADE); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); INSERT INTO Event VALUES ('event_1', 'ses_root'); INSERT INTO Event_Part VALUES ('part_1', 'event_1')")
            .execute(&pool)
            .await
            .unwrap();

        assert!(deletion_plan(&pool, "ses_root").await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM Event_Part")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_root'",)
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn reconciliation_repairs_a_same_named_invalid_trigger() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/legacy', 'Legacy', 1, 1, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/v2', 'V2', 1, 1, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        sqlx::query("DROP TRIGGER _devhatch_lineage_v2_delete; CREATE TRIGGER _devhatch_lineage_v2_delete AFTER DELETE ON session_v2 BEGIN SELECT 1; END")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        sqlx::query("DELETE FROM session_v2 WHERE id = 'ses_shared'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(history_rows(&pool).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn reconciliation_rejects_an_unknown_lineage_schema_without_replacing_it() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY, v1_time_created INTEGER NOT NULL, state TEXT NOT NULL); INSERT INTO _devhatch_session_lineage VALUES ('ses_preserved', 7, 'custom'); INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/legacy', 'Legacy', 1, 1, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/v2', 'V2', 1, 1, NULL)")
            .execute(&pool)
            .await
            .unwrap();

        assert!(reconcile_lineage_at(&path, &pool, None).await.is_err());
        assert_eq!(
            sqlx::query_as::<_, (String, i64, String)>(
                "SELECT session_id, v1_time_created, state FROM _devhatch_session_lineage",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            ("ses_preserved".into(), 7, "custom".into())
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE '_devhatch_lineage_%'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn reconciliation_rejects_unknown_lineage_ddl_even_with_every_required_column() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        let custom_sql = "CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY, v1_time_created INTEGER, v1_time_updated INTEGER, v2_time_created INTEGER, v2_time_updated INTEGER, v1_present INTEGER NOT NULL, v2_present INTEGER NOT NULL, v2_deleted INTEGER NOT NULL, owner TEXT NOT NULL)";
        sqlx::query(custom_sql).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO _devhatch_session_lineage VALUES ('ses_preserved', 1, 2, 3, 4, 1, 1, 0, 'custom')")
            .execute(&pool)
            .await
            .unwrap();

        assert!(reconcile_lineage_at(&path, &pool, None).await.is_err());
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '_devhatch_session_lineage'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            custom_sql
        );
        assert_eq!(
            sqlx::query_as::<_, (String, String)>(
                "SELECT session_id, owner FROM _devhatch_session_lineage"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            ("ses_preserved".into(), "custom".into())
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name LIKE '_devhatch_lineage_%'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn reconciliation_upgrades_the_previous_lineage_schema_without_losing_tombstones() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY, v1_time_created INTEGER, v1_time_updated INTEGER, v2_time_updated INTEGER, v1_present INTEGER NOT NULL CHECK (v1_present IN (0, 1)), v2_present INTEGER NOT NULL CHECK (v2_present IN (0, 1)), v2_deleted INTEGER NOT NULL CHECK (v2_deleted IN (0, 1))); INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_tombstoned', NULL, NULL, '/legacy', 'Legacy', 1, 2, NULL); INSERT INTO _devhatch_session_lineage VALUES ('ses_tombstoned', 1, 2, 3, 1, 0, 1)")
            .execute(&pool)
            .await
            .unwrap();

        assert!(reconcile_lineage_at(&path, &pool, None).await.unwrap());
        assert_eq!(
            sqlx::query_as::<_, (Option<i64>, i64, i64, i64)>(
                "SELECT v2_time_created, v1_present, v2_present, v2_deleted FROM _devhatch_session_lineage WHERE session_id = 'ses_tombstoned'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            (None, 1, 0, 1)
        );
        assert_eq!(
            resumable_session(Some(&pool), "ses_tombstoned")
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn readable_history_survives_lineage_write_failure() {
        let pool = v2_history_database().await;
        sqlx::query("CREATE TABLE _devhatch_session_lineage (session_id TEXT PRIMARY KEY); INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v1', NULL, NULL, '/v1', 'V1', 1, 2, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_v2', NULL, NULL, '/v2', 'V2', 1, 3, NULL)")
            .execute(&pool)
            .await
            .unwrap();

        assert!(
            reconcile_lineage_at(Path::new("/unavailable/opencode.db"), &pool, None)
                .await
                .is_err()
        );
        assert_eq!(
            history_rows(&pool)
                .await
                .unwrap()
                .into_iter()
                .map(|row| row.id)
                .collect::<Vec<_>>(),
            vec!["ses_v2", "ses_v1"]
        );
        assert_eq!(
            resumable_identity(&pool, "ses_v1").await,
            Some(("/v1".into(), SessionTable::V1))
        );
    }

    #[tokio::test]
    async fn v1_only_history_remains_read_only() {
        let pool = history_database().await;
        reconcile_lineage_at(Path::new("/unused"), &pool, None)
            .await
            .unwrap();
        let objects: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '_devhatch_%'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(objects, 0);
    }

    #[tokio::test]
    async fn preserves_v1_only_rows_when_v2_migration_marker_is_newer() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, time_updated INTEGER NOT NULL); INSERT INTO kv (key, value, time_updated) VALUES ('migration.v1-v2', '{\"phase\":\"completed\"}', 100)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_old_v1', NULL, NULL, '/old-v1', 'Old V1 session', 1, 90, NULL), ('ses_both', NULL, NULL, '/legacy', 'Legacy copy', 1, 90, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_both', NULL, NULL, '/v2', 'Migrated copy', 1, 90, NULL)")
            .execute(&pool)
            .await
            .unwrap();

        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        let rows = history_rows(&pool).await.unwrap();
        assert_eq!(
            rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
            vec!["ses_old_v1", "ses_both"]
        );
        assert_eq!(rows[1].directory, "/v2");
        assert_eq!(
            resumable_identity(&pool, "ses_old_v1").await,
            Some(("/old-v1".into(), SessionTable::V1))
        );
        let targets = deletion_targets(&pool, "ses_both", SessionTable::V2)
            .await
            .unwrap();
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].table, SessionTable::V1);
        assert_eq!(targets[0].generations[0].directory, "/legacy");
        assert_eq!(targets[1].table, SessionTable::V2);
        assert_eq!(targets[1].generations[0].directory, "/v2");
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_is_atomic_and_cleans_trees_events_and_lineage() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL, FOREIGN KEY(aggregate_id) REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE); CREATE TABLE session_v2_dependent (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES session_v2(id) ON DELETE CASCADE)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/v1', 'V1 root', 1, 2, NULL), ('ses_v1_child', NULL, 'ses_root', '/v1', 'V1 child', 3, 4, NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/v2', 'V2 root', 1, 5, NULL), ('ses_v2_child', NULL, 'ses_root', '/v2', 'V2 child', 6, 7, NULL); INSERT INTO event_sequence (aggregate_id, seq) VALUES ('ses_root', 1), ('ses_v1_child', 1), ('ses_v2_child', 1); INSERT INTO event (id, aggregate_id) VALUES ('evt_root', 'ses_root'), ('evt_v1_child', 'ses_v1_child'), ('evt_v2_child', 'ses_v2_child'); INSERT INTO session_v2_dependent (id, session_id) VALUES ('dependent', 'ses_v2_child')")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(plan.targets.len(), 2);
        assert_eq!(plan.targets[0].generations.len(), 2);
        assert_eq!(plan.targets[1].generations.len(), 2);
        handle.pool.close().await;
        delete_generations_at(&handle, &plan).await.unwrap();

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        for table in [
            "session",
            "session_v2",
            "event_sequence",
            "event",
            "session_v2_dependent",
            "_devhatch_session_lineage",
        ] {
            let count = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0, "{table} retained rows");
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rolls_back_when_deferred_constraint_rejects_commit() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL); CREATE TABLE commit_blocker (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES session_v2(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); INSERT INTO event_sequence VALUES ('ses_root', 1); INSERT INTO event VALUES ('evt', 'ses_root'); INSERT INTO commit_blocker VALUES ('blocker', 'ses_root')")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Failed)
        );

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        for (table, column) in [
            ("session_v2", "id"),
            ("event", "aggregate_id"),
            ("event_sequence", "aggregate_id"),
            ("_devhatch_session_lineage", "session_id"),
        ] {
            let count = sqlx::query_scalar::<_, i64>(&format!(
                "SELECT COUNT(*) FROM {table} WHERE {column} = 'ses_root'"
            ))
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(count, 1, "{table} deletion was not rolled back");
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM commit_blocker")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_event_and_sequence_changes_after_planning() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); INSERT INTO event_sequence VALUES ('ses_root', 1); INSERT INTO event VALUES ('evt_initial', 'ses_root')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(plan.events.as_ref().unwrap().rows.len(), 1);
        assert_eq!(plan.event_sequences.as_ref().unwrap().rows.len(), 1);
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("INSERT INTO event VALUES ('evt_late', 'ses_root')")
            .execute(&writer)
            .await
            .unwrap();
        let changed = deletion_plan(&writer, "ses_root").await.unwrap().unwrap();
        assert_ne!(changed.events, plan.events);
        writer.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("UPDATE event_sequence SET seq = 2 WHERE aggregate_id = 'ses_root'")
            .execute(&writer)
            .await
            .unwrap();
        let changed = deletion_plan(&writer, "ses_root").await.unwrap().unwrap();
        assert_ne!(changed.event_sequences, plan.event_sequences);
        writer.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_event_dependent_changes_after_planning() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL); CREATE TABLE event_part (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, FOREIGN KEY(event_id) REFERENCES event(id) ON DELETE CASCADE); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); INSERT INTO event_sequence VALUES ('ses_root', 1); INSERT INTO event VALUES ('evt', 'ses_root')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        assert!(
            plan.cascade_dependents
                .iter()
                .any(|snapshot| snapshot.table == "event_part" && snapshot.rows.is_empty())
        );
        handle.pool.close().await;
        let writer = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO event_part VALUES ('late', 'evt')")
            .execute(&writer)
            .await
            .unwrap();
        let changed = deletion_plan(&writer, "ses_root").await.unwrap().unwrap();
        assert_ne!(changed.cascade_dependents, plan.cascade_dependents);
        writer.close().await;

        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_new_cascade_dependent_after_planning() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE dependent (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, value TEXT, FOREIGN KEY(session_id) REFERENCES session_v2(id) ON DELETE CASCADE); CREATE TABLE attachment (id TEXT PRIMARY KEY, dependent_id TEXT NOT NULL, value TEXT, FOREIGN KEY(dependent_id) REFERENCES dependent(id) ON DELETE CASCADE); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); INSERT INTO dependent VALUES ('initial', 'ses_root', 'old')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        assert!(
            plan.cascade_dependents
                .iter()
                .any(|snapshot| snapshot.table == "attachment" && snapshot.rows.is_empty())
        );
        handle.pool.close().await;
        let writer = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::query("INSERT INTO attachment VALUES ('late', 'initial', 'new')")
            .execute(&writer)
            .await
            .unwrap();
        let changed = deletion_plan(&writer, "ses_root").await.unwrap().unwrap();
        assert_ne!(changed.cascade_dependents, plan.cascade_dependents);
        writer.close().await;

        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM attachment")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_fingerprint_includes_text_after_embedded_nul() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("ALTER TABLE session_v2 ADD COLUMN note TEXT; INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived, note) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL, CAST(X'610062' AS TEXT))")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("UPDATE session_v2 SET note = CAST(X'610063' AS TEXT) WHERE id = 'ses_root'")
            .execute(&writer)
            .await
            .unwrap();
        let changed = deletion_plan(&writer, "ses_root").await.unwrap().unwrap();
        assert_ne!(changed.targets, plan.targets);
        writer.close().await;

        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_index_and_view_changes_after_planning() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE INDEX late_session_index ON session_v2(time_updated)")
            .execute(&writer)
            .await
            .unwrap();
        writer.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("DROP INDEX late_session_index; CREATE INDEX late_session_index ON session_v2(time_created)")
            .execute(&writer)
            .await
            .unwrap();
        writer.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE VIEW late_session_view AS SELECT id FROM session_v2")
            .execute(&writer)
            .await
            .unwrap();
        writer.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
    }

    #[tokio::test]
    async fn absent_session_share_is_compatible() {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        assert_eq!(
            session_generation_is_shared(&mut connection, "session_v2", &[]).await,
            Ok(false)
        );
    }

    #[tokio::test]
    async fn generation_delete_rejects_incompatible_or_non_table_session_share() {
        for ddl in [
            "CREATE TABLE session_share (wrong_id TEXT)",
            "CREATE VIEW session_share AS SELECT id AS session_id FROM session_v2",
        ] {
            let root = TempDir::new().unwrap();
            let (_, pool) = file_history_database(&root).await;
            sqlx::query(&format!(
                "{ddl}; INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)"
            ))
            .execute(&pool)
            .await
            .unwrap();

            assert!(deletion_plan(&pool, "ses_root").await.is_err());
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_detects_session_share_for_v2_generation() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE session_share (session_id TEXT NOT NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/shared', 'Shared', 1, 2, NULL); INSERT INTO session_share VALUES ('ses_shared')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_shared")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Shared)
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_detects_session_share_for_v1_generation() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE session_share (session_id TEXT NOT NULL); INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/shared', 'Shared', 1, 2, NULL); INSERT INTO session_share VALUES ('ses_shared')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_shared")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Shared)
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_same_id_replacement() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/old', 'Old', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;

        let replacement = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("UPDATE session_v2 SET directory = '/replacement', title = 'Replacement' WHERE id = 'ses_root'")
            .execute(&replacement)
            .await
            .unwrap();
        replacement.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_as::<_, (String, i64, i64)>(
                "SELECT directory, time_created, time_updated FROM session_v2 WHERE id = 'ses_root'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            ("/replacement".into(), 1, 2)
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_database_path_replacement() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/old', 'Old', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;

        let old_path = root.path().join("opencode-old.db");
        fs::rename(&path, &old_path).unwrap();
        let replacement = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE session_v2 (id TEXT PRIMARY KEY, parent_id TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL); INSERT INTO session_v2 (id, parent_id, time_created, time_updated) VALUES ('ses_root', NULL, 1, 2)")
            .execute(&replacement)
            .await
            .unwrap();
        replacement.close().await;

        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_root'",)
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_new_copy_and_cross_schema_descendant_changes() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); DROP TABLE session")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let writer = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER); INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_child', NULL, 'ses_root', '/child', 'Child', 3, 4, NULL)")
            .execute(&writer)
            .await
            .unwrap();
        writer.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Stale)
        );
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_root'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_cleans_event_rows_without_cascade() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE event_sequence (aggregate_id TEXT PRIMARY KEY, seq INTEGER NOT NULL); CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT NOT NULL); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL); INSERT INTO event_sequence VALUES ('ses_root', 1); INSERT INTO event VALUES ('evt', 'ses_root')")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        pool.close().await;
        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        delete_generations_at(&handle, &plan).await.unwrap();
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM event")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM event_sequence")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_rejects_unknown_triggers_before_mutation() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("CREATE TABLE audit (value TEXT); CREATE TRIGGER custom_audit AFTER INSERT ON audit BEGIN SELECT 1; END; INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        assert!(deletion_plan(&handle.pool, "ses_root").await.is_err());
        handle.pool.close().await;

        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_root'")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'custom_audit'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn generation_delete_fails_closed_for_shared_sessions() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, share_url, time_created, time_updated, time_archived) VALUES ('ses_shared', NULL, NULL, '/shared', 'Shared', 'https://example.invalid/share', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        pool.close().await;
        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_shared")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::Shared)
        );
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_shared'",
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn delete_preserves_pool_on_failure_and_invalidates_it_only_after_commit() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        pool.close().await;

        let application_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&application_pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            root.path().to_owned(),
            application_pool,
            OpenCodeHistoryPool::new(path.clone()),
            skillink,
            None,
            false,
        ));
        let handle = state.history_pool().await.unwrap();
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .busy_timeout(Duration::from_millis(100));
        let mut reader = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("BEGIN").execute(&mut reader).await.unwrap();
        sqlx::query("SELECT * FROM session_v2")
            .fetch_all(&mut reader)
            .await
            .unwrap();

        let coordinator = state.history_coordinator();
        let _reconciliation = coordinator.lock().lock().await;
        let mut deletion = coordinator
            .begin(crate::agent::OPENCODE_ID, "ses_root")
            .unwrap();
        assert!(matches!(
            super::delete(&state, "ses_root".into(), &mut deletion).await,
            Err(crate::history::DeleteError::History(
                crate::history::HistoryError::ExternalActive
            ))
        ));
        assert!(state.opencode_history_handle_is_current(&handle));
        assert!(!handle.pool.is_closed());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session_v2 WHERE id = 'ses_root'")
                .fetch_one(&handle.pool)
                .await
                .unwrap(),
            1
        );

        sqlx::query("ROLLBACK").execute(&mut reader).await.unwrap();
        reader.close().await.unwrap();
        assert!(
            super::delete(&state, "ses_root".into(), &mut deletion)
                .await
                .is_ok()
        );
        assert!(!state.opencode_history_handle_is_current(&handle));
        assert!(handle.pool.is_closed());
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn external_database_holder_blocks_generation_delete() {
        let root = TempDir::new().unwrap();
        let (path, pool) = file_history_database(&root).await;
        sqlx::query("INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)")
            .execute(&pool)
            .await
            .unwrap();
        reconcile_lineage_at(&path, &pool, None).await.unwrap();
        pool.close().await;
        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let plan = deletion_plan(&handle.pool, "ses_root")
            .await
            .unwrap()
            .unwrap();
        handle.pool.close().await;
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .busy_timeout(Duration::from_millis(100));
        let mut reader = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("BEGIN").execute(&mut reader).await.unwrap();
        sqlx::query("SELECT * FROM session_v2")
            .fetch_all(&mut reader)
            .await
            .unwrap();
        assert_eq!(
            delete_generations_at(&handle, &plan).await,
            Err(GenerationDeleteError::ExternalActive)
        );
        sqlx::query("ROLLBACK").execute(&mut reader).await.unwrap();
        reader.close().await.unwrap();
        assert_eq!(delete_generations_at(&handle, &plan).await, Ok(()));
    }

    #[tokio::test]
    async fn removes_only_the_expected_legacy_copy_and_its_dependents() {
        let root = TempDir::new().unwrap();
        let path = root.path().join("opencode.db");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&path)
                    .create_if_missing(true)
                    .foreign_keys(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, FOREIGN KEY(parent_id) REFERENCES session(id) ON DELETE CASCADE)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, FOREIGN KEY(session_id) REFERENCES session(id) ON DELETE CASCADE)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO session (id, parent_id, time_created, time_updated) VALUES ('ses_root', NULL, 80, 90), ('ses_child', 'ses_root', 81, 91); INSERT INTO message (id, session_id) VALUES ('msg_root', 'ses_root'), ('msg_child', 'ses_child')")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        assert!(
            remove_legacy_copy_at(&path, "ses_root", 79, 90, None)
                .await
                .is_err()
        );
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session")
                .fetch_one(&pool)
                .await
                .unwrap(),
            2
        );
        pool.close().await;

        remove_legacy_copy_at(&path, "ses_root", 80, 90, None)
            .await
            .unwrap();
        let pool = SqlitePool::connect(&format!("sqlite://{}", path.display()))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM session")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM message")
                .fetch_one(&pool)
                .await
                .unwrap(),
            0
        );
    }

    #[test]
    fn claim_selection_rechecks_current_claims() {
        let candidates = vec!["ses_first".to_string(), "ses_second".to_string()];
        assert!(unique_unclaimed_session(candidates.clone(), &HashSet::new()).is_none());
        assert_eq!(
            unique_unclaimed_session(candidates, &HashSet::from(["ses_first".to_string()])),
            Some("ses_second".to_string())
        );
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
    fn external_directory_evidence_is_strong_without_recency() {
        let external = HashSet::from(["/tmp".into()]);
        assert!(external.contains(&canonical_identity(&row().directory)));
        assert_eq!(
            presence_for(&row(), &HashSet::new(), &external, 301_000),
            Presence::PossiblyActiveElsewhere
        );
        assert_eq!(
            presence_for(&row(), &HashSet::new(), &external, 301_001),
            Presence::Inactive
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
