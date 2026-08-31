use std::{collections::HashSet, sync::Arc};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, clock::now, session::SessionKind, state::AppState};

#[derive(Clone, FromRow)]
struct WorkspaceRow {
    id: String,
    name: Option<String>,
    active_terminal_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalWorkspaceMember {
    terminal_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalWorkspace {
    id: String,
    name: Option<String>,
    active_terminal_id: Option<String>,
    members: Vec<TerminalWorkspaceMember>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    name: Option<String>,
    terminal_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRequest {
    #[serde(default, deserialize_with = "deserialize_present")]
    name: Option<Option<String>>,
    active_terminal_id: Option<String>,
}

fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    let live = state.terminal_ids();
    if reconcile(state.pool(), &live).await.is_err() {
        return database_error();
    }
    match list_items(state.pool()).await {
        Ok(workspaces) => {
            Json(serde_json::json!({ "terminalWorkspaces": workspaces })).into_response()
        }
        Err(_) => database_error(),
    }
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    let name = match validate_name(request.name) {
        Ok(name) => name,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    if has_duplicates(&request.terminal_ids) {
        return error(StatusCode::BAD_REQUEST, "INVALID_TERMINAL_IDS");
    }
    let terminal_ids = request.terminal_ids;
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    if terminal_ids
        .iter()
        .any(|terminal_id| state.session(terminal_id, SessionKind::Terminal).is_none())
    {
        return error(StatusCode::BAD_REQUEST, "TERMINAL_NOT_LIVE");
    }
    match create_workspace(state.pool(), name, &terminal_ids).await {
        Ok(workspace) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "terminalWorkspace": workspace })),
        )
            .into_response(),
        Err(error) => database_result(error),
    }
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateRequest>,
) -> Response {
    if request.name.is_none() && request.active_terminal_id.is_none() {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let name = match request.name {
        Some(name) => match validate_name(name) {
            Ok(name) => Some(name),
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    if let Some(terminal_id) = &request.active_terminal_id {
        if state.session(terminal_id, SessionKind::Terminal).is_none() {
            return error(StatusCode::BAD_REQUEST, "TERMINAL_NOT_LIVE");
        }
        match member_belongs(state.pool(), &id, terminal_id).await {
            Ok(true) => {}
            Ok(false) => return error(StatusCode::BAD_REQUEST, "ACTIVE_TERMINAL_NOT_MEMBER"),
            Err(_) => return database_error(),
        }
    }
    let timestamp = now() as i64;
    let result = if let Some(name) = name {
        sqlx::query("UPDATE terminal_workspaces SET name = ?, active_terminal_id = COALESCE(?, active_terminal_id), updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(name)
            .bind(request.active_terminal_id)
            .bind(timestamp)
            .bind(&id)
            .execute(state.pool())
            .await
    } else {
        sqlx::query("UPDATE terminal_workspaces SET active_terminal_id = COALESCE(?, active_terminal_id), updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(request.active_terminal_id)
            .bind(timestamp)
            .bind(&id)
            .execute(state.pool())
            .await
    };
    match result {
        Ok(value) if value.rows_affected() == 1 => workspace_response(state.pool(), &id).await,
        Ok(_) => not_found(),
        Err(_) => database_error(),
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    let live = state.terminal_ids();
    match disband(state.pool(), &id, &live).await {
        Ok(Some(workspaces)) => {
            Json(serde_json::json!({ "terminalWorkspaces": workspaces })).into_response()
        }
        Ok(None) => not_found(),
        Err(_) => database_error(),
    }
}

async fn disband(
    pool: &SqlitePool,
    workspace_id: &str,
    live: &HashSet<String>,
) -> Result<Option<Vec<TerminalWorkspace>>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let members = sqlx::query_scalar::<_, String>(
        "SELECT terminal_id FROM terminal_workspace_members WHERE workspace_id = ? ORDER BY position, terminal_id",
    )
    .bind(workspace_id)
    .fetch_all(&mut *transaction)
    .await?;
    let result = sqlx::query("DELETE FROM terminal_workspaces WHERE id = ?")
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        transaction.rollback().await?;
        return Ok(None);
    }
    let mut ids = Vec::new();
    for terminal_id in members
        .into_iter()
        .filter(|terminal_id| live.contains(terminal_id))
    {
        ids.push(insert_singleton(&mut transaction, &terminal_id).await?);
    }
    let mut workspaces = Vec::with_capacity(ids.len());
    for id in ids {
        workspaces.push(find_in_transaction(&mut transaction, &id).await?);
    }
    transaction.commit().await?;
    Ok(Some(workspaces))
}

pub(crate) async fn attach_terminal(
    pool: &SqlitePool,
    workspace_id: Option<&str>,
    terminal_id: &str,
    launch_path: &str,
) -> Result<Option<TerminalWorkspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let id = if let Some(workspace_id) = workspace_id {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT EXISTS(SELECT 1 FROM terminal_workspaces WHERE id = ?)",
        )
        .bind(workspace_id)
        .fetch_one(&mut *transaction)
        .await?
            != 0;
        if !exists {
            transaction.rollback().await?;
            return Ok(None);
        }
        let position = sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(position), -1) + 1 FROM terminal_workspace_members WHERE workspace_id = ?")
            .bind(workspace_id)
            .fetch_one(&mut *transaction)
            .await?;
        sqlx::query("INSERT INTO terminal_workspace_members (terminal_id, workspace_id, position) VALUES (?, ?, ?)")
            .bind(terminal_id)
            .bind(workspace_id)
            .bind(position)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            "UPDATE terminal_workspaces SET active_terminal_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?",
        )
        .bind(terminal_id)
        .bind(now() as i64)
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
        workspace_id.to_string()
    } else {
        insert_singleton(&mut transaction, terminal_id).await?
    };
    crate::terminal_launch_path::ensure(&mut transaction, launch_path).await?;
    transaction.commit().await?;
    find(pool, &id).await
}

async fn insert_singleton(
    transaction: &mut Transaction<'_, Sqlite>,
    terminal_id: &str,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let timestamp = now() as i64;
    sqlx::query("INSERT INTO terminal_workspaces (id, name, active_terminal_id, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)")
        .bind(&id)
        .bind(terminal_id)
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut **transaction)
        .await?;
    sqlx::query("INSERT INTO terminal_workspace_members (terminal_id, workspace_id, position) VALUES (?, ?, 0)")
        .bind(terminal_id)
        .bind(&id)
        .execute(&mut **transaction)
        .await?;
    Ok(id)
}

pub(crate) async fn remove_terminal(
    pool: &SqlitePool,
    terminal_id: &str,
) -> Result<Option<TerminalWorkspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let workspace_id = sqlx::query_scalar::<_, String>(
        "SELECT workspace_id FROM terminal_workspace_members WHERE terminal_id = ?",
    )
    .bind(terminal_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(workspace_id) = workspace_id else {
        transaction.commit().await?;
        return Ok(None);
    };
    sqlx::query("DELETE FROM terminal_workspace_members WHERE terminal_id = ?")
        .bind(terminal_id)
        .execute(&mut *transaction)
        .await?;
    let fallback = sqlx::query_scalar::<_, String>("SELECT terminal_id FROM terminal_workspace_members WHERE workspace_id = ? ORDER BY position, terminal_id LIMIT 1")
        .bind(&workspace_id)
        .fetch_optional(&mut *transaction)
        .await?;
    sqlx::query("UPDATE terminal_workspaces SET active_terminal_id = CASE WHEN active_terminal_id = ? OR ? IS NULL THEN ? ELSE active_terminal_id END, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
        .bind(terminal_id)
        .bind(&fallback)
        .bind(&fallback)
        .bind(now() as i64)
        .bind(&workspace_id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    find(pool, &workspace_id).await
}

async fn create_workspace(
    pool: &SqlitePool,
    name: Option<String>,
    terminal_ids: &[String],
) -> Result<TerminalWorkspace, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let timestamp = now() as i64;
    let mut transaction = pool.begin().await?;
    sqlx::query("INSERT INTO terminal_workspaces (id, name, active_terminal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(terminal_ids.first())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
    insert_members(&mut transaction, &id, terminal_ids).await?;
    transaction.commit().await?;
    find(pool, &id).await?.ok_or(sqlx::Error::RowNotFound)
}

async fn insert_members(
    transaction: &mut Transaction<'_, Sqlite>,
    workspace_id: &str,
    terminal_ids: &[String],
) -> Result<(), sqlx::Error> {
    for (position, terminal_id) in terminal_ids.iter().enumerate() {
        sqlx::query("INSERT INTO terminal_workspace_members (terminal_id, workspace_id, position) VALUES (?, ?, ?)")
            .bind(terminal_id)
            .bind(workspace_id)
            .bind(position as i64)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn reconcile(pool: &SqlitePool, live: &HashSet<String>) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let members = sqlx::query_as::<_, (String, String)>(
        "SELECT terminal_id, workspace_id FROM terminal_workspace_members",
    )
    .fetch_all(&mut *transaction)
    .await?;
    let affected = members
        .iter()
        .filter(|(terminal_id, _)| !live.contains(terminal_id))
        .map(|(_, workspace_id)| workspace_id.clone())
        .collect::<HashSet<_>>();
    for (terminal_id, _) in members
        .iter()
        .filter(|(terminal_id, _)| !live.contains(terminal_id))
    {
        sqlx::query("DELETE FROM terminal_workspace_members WHERE terminal_id = ?")
            .bind(terminal_id)
            .execute(&mut *transaction)
            .await?;
    }
    for workspace_id in affected {
        let fallback = sqlx::query_scalar::<_, String>("SELECT terminal_id FROM terminal_workspace_members WHERE workspace_id = ? ORDER BY position, terminal_id LIMIT 1")
            .bind(&workspace_id)
            .fetch_optional(&mut *transaction)
            .await?;
        if let Some(fallback) = fallback {
            sqlx::query("UPDATE terminal_workspaces SET active_terminal_id = CASE WHEN active_terminal_id IN (SELECT terminal_id FROM terminal_workspace_members WHERE workspace_id = ?) THEN active_terminal_id ELSE ? END, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
                .bind(&workspace_id)
                .bind(fallback)
                .bind(now() as i64)
                .bind(&workspace_id)
                .execute(&mut *transaction)
                .await?;
        } else {
            sqlx::query("UPDATE terminal_workspaces SET active_terminal_id = NULL, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
                .bind(now() as i64)
                .bind(workspace_id)
                .execute(&mut *transaction)
                .await?;
        }
    }
    transaction.commit().await
}

async fn list_items(pool: &SqlitePool) -> Result<Vec<TerminalWorkspace>, sqlx::Error> {
    let rows = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_terminal_id, created_at, updated_at FROM terminal_workspaces ORDER BY created_at, id")
        .fetch_all(pool)
        .await?;
    let mut workspaces = Vec::with_capacity(rows.len());
    for row in rows {
        workspaces.push(assemble(pool, row).await?);
    }
    Ok(workspaces)
}

async fn find_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<TerminalWorkspace, sqlx::Error> {
    let row = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_terminal_id, created_at, updated_at FROM terminal_workspaces WHERE id = ?")
        .bind(id)
        .fetch_one(&mut **transaction)
        .await?;
    let members = sqlx::query_as::<_, TerminalWorkspaceMember>("SELECT terminal_id FROM terminal_workspace_members WHERE workspace_id = ? ORDER BY position, terminal_id")
        .bind(id)
        .fetch_all(&mut **transaction)
        .await?;
    Ok(TerminalWorkspace {
        id: row.id,
        name: row.name,
        active_terminal_id: row.active_terminal_id,
        members,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

async fn find(pool: &SqlitePool, id: &str) -> Result<Option<TerminalWorkspace>, sqlx::Error> {
    let row = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_terminal_id, created_at, updated_at FROM terminal_workspaces WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    match row {
        Some(row) => assemble(pool, row).await.map(Some),
        None => Ok(None),
    }
}

async fn assemble(pool: &SqlitePool, row: WorkspaceRow) -> Result<TerminalWorkspace, sqlx::Error> {
    let members = sqlx::query_as::<_, TerminalWorkspaceMember>("SELECT terminal_id FROM terminal_workspace_members WHERE workspace_id = ? ORDER BY position, terminal_id")
        .bind(&row.id)
        .fetch_all(pool)
        .await?;
    Ok(TerminalWorkspace {
        id: row.id,
        name: row.name,
        active_terminal_id: row.active_terminal_id,
        members,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

async fn member_belongs(
    pool: &SqlitePool,
    workspace_id: &str,
    terminal_id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM terminal_workspace_members WHERE workspace_id = ? AND terminal_id = ?)")
        .bind(workspace_id)
        .bind(terminal_id)
        .fetch_one(pool)
        .await
        .map(|value| value != 0)
}

fn has_duplicates(values: &[String]) -> bool {
    let mut unique = HashSet::new();
    values
        .iter()
        .any(|value| value.is_empty() || !unique.insert(value))
}

fn validate_name(value: Option<String>) -> Result<Option<String>, &'static str> {
    let value = value.map(|name| name.trim().to_string());
    if value
        .as_ref()
        .is_some_and(|name| name.is_empty() || name.encode_utf16().count() > 120)
    {
        Err("INVALID_WORKSPACE_NAME")
    } else {
        Ok(value)
    }
}

async fn workspace_response(pool: &SqlitePool, id: &str) -> Response {
    match find(pool, id).await {
        Ok(Some(workspace)) => {
            Json(serde_json::json!({ "terminalWorkspace": workspace })).into_response()
        }
        Ok(None) => not_found(),
        Err(_) => database_error(),
    }
}

fn database_result(error_value: sqlx::Error) -> Response {
    if matches!(&error_value, sqlx::Error::Database(error) if error.is_unique_violation()) {
        error(StatusCode::CONFLICT, "TERMINAL_ALREADY_IN_WORKSPACE")
    } else {
        database_error()
    }
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "TERMINAL_WORKSPACE_NOT_FOUND")
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &'static str) -> Response {
    ApiError::new(status, code).into_response()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use sqlx::sqlite::SqlitePoolOptions;

    use super::{attach_terminal, create_workspace, disband, find, reconcile, remove_terminal};

    async fn pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    fn members(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[tokio::test]
    async fn creates_in_stable_member_order_and_enforces_global_membership() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, Some("one".into()), &members(&["b", "a"]))
            .await
            .unwrap();
        assert_eq!(
            workspace
                .members
                .iter()
                .map(|member| member.terminal_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert_eq!(workspace.active_terminal_id.as_deref(), Some("b"));
        let attached = attach_terminal(&pool, Some(&workspace.id), "c", "/tmp")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            attached
                .members
                .iter()
                .map(|member| member.terminal_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a", "c"]
        );
        assert!(attached.updated_at > workspace.updated_at);
        let empty = create_workspace(&pool, None, &[]).await.unwrap();
        assert!(empty.members.is_empty());
        assert_eq!(empty.active_terminal_id, None);
        assert!(
            create_workspace(&pool, None, &members(&["a"]))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn disband_rehomes_only_live_members_as_singletons() {
        let pool = pool().await;
        let workspace =
            create_workspace(&pool, Some("group".into()), &members(&["a", "b", "gone"]))
                .await
                .unwrap();
        let singletons = disband(
            &pool,
            &workspace.id,
            &HashSet::from(["a".to_string(), "b".to_string()]),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(find(&pool, &workspace.id).await.unwrap().is_none());
        assert_eq!(singletons.len(), 2);
        assert!(singletons.iter().all(|item| item.members.len() == 1));
        let terminal_ids = singletons
            .iter()
            .map(|item| item.members[0].terminal_id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(terminal_ids, HashSet::from(["a", "b"]));
    }

    #[tokio::test]
    async fn attach_terminal_rolls_back_membership_when_launch_path_touch_fails() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &members(&["a"]))
            .await
            .unwrap();
        sqlx::query("DROP TABLE terminal_launch_paths")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            attach_terminal(&pool, Some(&workspace.id), "b", "/tmp")
                .await
                .is_err()
        );
        let workspace = find(&pool, &workspace.id).await.unwrap().unwrap();
        assert_eq!(workspace.members.len(), 1);
        assert_eq!(workspace.members[0].terminal_id, "a");
    }

    #[tokio::test]
    async fn terminal_removal_falls_back_then_retains_empty_workspace() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &members(&["a", "b"]))
            .await
            .unwrap();
        let remaining = remove_terminal(&pool, "a").await.unwrap().unwrap();
        assert_eq!(remaining.active_terminal_id.as_deref(), Some("b"));
        let empty = remove_terminal(&pool, "b").await.unwrap().unwrap();
        assert_eq!(empty.id, workspace.id);
        assert!(empty.members.is_empty());
        assert_eq!(empty.active_terminal_id, None);
        assert!(find(&pool, &workspace.id).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn reconciliation_removes_stale_members_and_retains_empty_workspaces() {
        let pool = pool().await;
        let first = create_workspace(&pool, None, &members(&["stale", "live"]))
            .await
            .unwrap();
        let second = create_workspace(&pool, None, &members(&["gone"]))
            .await
            .unwrap();
        reconcile(&pool, &HashSet::from(["live".to_string()]))
            .await
            .unwrap();
        let first = find(&pool, &first.id).await.unwrap().unwrap();
        assert_eq!(first.members.len(), 1);
        assert_eq!(first.active_terminal_id.as_deref(), Some("live"));
        let second = find(&pool, &second.id).await.unwrap().unwrap();
        assert!(second.members.is_empty());
        assert_eq!(second.active_terminal_id, None);
    }
}
