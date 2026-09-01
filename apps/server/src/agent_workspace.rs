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

use crate::{api::ApiError, clock::now, state::AppState};

#[derive(Clone, FromRow)]
struct WorkspaceRow {
    id: String,
    name: Option<String>,
    active_agent_session_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspaceMember {
    agent_session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentWorkspace {
    id: String,
    name: Option<String>,
    active_agent_session_id: Option<String>,
    members: Vec<AgentWorkspaceMember>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    name: Option<String>,
    agent_session_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRequest {
    #[serde(default, deserialize_with = "deserialize_present")]
    name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present")]
    active_agent_session_id: Option<Option<String>>,
}

fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    let _lifecycle = state.agent_workspace_lifecycle().lock().await;
    let (live, agent_sessions) = state.agent_snapshot();
    if reconcile(state.pool(), &live).await.is_err() {
        return database_error();
    }
    match list_items(state.pool()).await {
        Ok(workspaces) => Json(serde_json::json!({
            "agentWorkspaces": workspaces,
            "agentSessions": agent_sessions
        }))
        .into_response(),
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
    if has_duplicates(&request.agent_session_ids) {
        return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_SESSION_IDS");
    }
    let agent_session_ids = request.agent_session_ids;
    let _lifecycle = state.agent_workspace_lifecycle().lock().await;
    let live = state.agent_ids();
    if !session_ids_are_live(&agent_session_ids, &live) {
        return error(StatusCode::BAD_REQUEST, "AGENT_SESSION_NOT_LIVE");
    }
    match create_workspace(state.pool(), name, &agent_session_ids).await {
        Ok(workspace) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "agentWorkspace": workspace })),
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
    if request.name.is_none() && request.active_agent_session_id.is_none() {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let name = match request.name {
        Some(name) => match validate_name(name) {
            Ok(name) => Some(name),
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    let _lifecycle = state.agent_workspace_lifecycle().lock().await;
    let live = state.agent_ids();
    if let Some(Some(agent_session_id)) = &request.active_agent_session_id {
        if !live.contains(agent_session_id) {
            return error(StatusCode::BAD_REQUEST, "AGENT_SESSION_NOT_LIVE");
        }
        match member_belongs(state.pool(), &id, agent_session_id).await {
            Ok(true) => {}
            Ok(false) => {
                return error(StatusCode::BAD_REQUEST, "ACTIVE_AGENT_SESSION_NOT_MEMBER");
            }
            Err(_) => return database_error(),
        }
    }
    let timestamp = now() as i64;
    let result = match (name, request.active_agent_session_id) {
        (Some(name), Some(active)) => sqlx::query("UPDATE agent_workspaces SET name = ?, active_agent_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(name).bind(active).bind(timestamp).bind(&id).execute(state.pool()).await,
        (Some(name), None) => sqlx::query("UPDATE agent_workspaces SET name = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(name).bind(timestamp).bind(&id).execute(state.pool()).await,
        (None, Some(active)) => sqlx::query("UPDATE agent_workspaces SET active_agent_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(active).bind(timestamp).bind(&id).execute(state.pool()).await,
        (None, None) => unreachable!(),
    };
    match result {
        Ok(value) if value.rows_affected() == 1 => workspace_response(state.pool(), &id).await,
        Ok(_) => not_found(),
        Err(_) => database_error(),
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let _lifecycle = state.agent_workspace_lifecycle().lock().await;
    let live = state.agent_ids();
    match disband(state.pool(), &id, &live).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => not_found(),
        Err(_) => database_error(),
    }
}

async fn disband(
    pool: &SqlitePool,
    workspace_id: &str,
    live: &HashSet<String>,
) -> Result<bool, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let members = sqlx::query_scalar::<_, String>("SELECT agent_session_id FROM agent_workspace_members WHERE workspace_id = ? ORDER BY position, agent_session_id")
        .bind(workspace_id).fetch_all(&mut *transaction).await?;
    let result = sqlx::query("DELETE FROM agent_workspaces WHERE id = ?")
        .bind(workspace_id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        transaction.rollback().await?;
        return Ok(false);
    }
    for id in members.into_iter().filter(|id| live.contains(id)) {
        insert_singleton(&mut transaction, &id).await?;
    }
    transaction.commit().await?;
    Ok(true)
}

pub(crate) async fn reconcile_and_attach_agent_session(
    pool: &SqlitePool,
    live: &HashSet<String>,
    workspace_id: Option<&str>,
    agent_session_id: &str,
) -> Result<Option<AgentWorkspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    reconcile_transaction(&mut transaction, live, Some(agent_session_id)).await?;
    if !live.contains(agent_session_id) {
        transaction.commit().await?;
        return Ok(None);
    }
    let id = if let Some(workspace_id) = workspace_id {
        let exists = sqlx::query_scalar::<_, i64>(
            "SELECT EXISTS(SELECT 1 FROM agent_workspaces WHERE id = ?)",
        )
        .bind(workspace_id)
        .fetch_one(&mut *transaction)
        .await?
            != 0;
        if !exists {
            transaction.rollback().await?;
            return Ok(None);
        }
        let position = sqlx::query_scalar::<_, i64>("SELECT COALESCE(MAX(position), -1) + 1 FROM agent_workspace_members WHERE workspace_id = ?")
            .bind(workspace_id).fetch_one(&mut *transaction).await?;
        sqlx::query("INSERT INTO agent_workspace_members (agent_session_id, workspace_id, position) VALUES (?, ?, ?)")
            .bind(agent_session_id).bind(workspace_id).bind(position).execute(&mut *transaction).await?;
        sqlx::query("UPDATE agent_workspaces SET active_agent_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(agent_session_id).bind(now() as i64).bind(workspace_id).execute(&mut *transaction).await?;
        workspace_id.to_string()
    } else {
        insert_singleton(&mut transaction, agent_session_id).await?
    };
    transaction.commit().await?;
    find(pool, &id).await
}

async fn insert_singleton(
    transaction: &mut Transaction<'_, Sqlite>,
    agent_session_id: &str,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let timestamp = now() as i64;
    sqlx::query("INSERT INTO agent_workspaces (id, name, active_agent_session_id, created_at, updated_at) VALUES (?, NULL, ?, ?, ?)")
        .bind(&id).bind(agent_session_id).bind(timestamp).bind(timestamp).execute(&mut **transaction).await?;
    sqlx::query("INSERT INTO agent_workspace_members (agent_session_id, workspace_id, position) VALUES (?, ?, 0)")
        .bind(agent_session_id).bind(&id).execute(&mut **transaction).await?;
    Ok(id)
}

pub(crate) async fn remove_agent_session(
    pool: &SqlitePool,
    agent_session_id: &str,
) -> Result<Option<AgentWorkspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let workspace_id = sqlx::query_scalar::<_, String>(
        "SELECT workspace_id FROM agent_workspace_members WHERE agent_session_id = ?",
    )
    .bind(agent_session_id)
    .fetch_optional(&mut *transaction)
    .await?;
    let Some(workspace_id) = workspace_id else {
        transaction.commit().await?;
        return Ok(None);
    };
    sqlx::query("DELETE FROM agent_workspace_members WHERE agent_session_id = ?")
        .bind(agent_session_id)
        .execute(&mut *transaction)
        .await?;
    let fallback = sqlx::query_scalar::<_, String>("SELECT agent_session_id FROM agent_workspace_members WHERE workspace_id = ? ORDER BY position, agent_session_id LIMIT 1")
        .bind(&workspace_id).fetch_optional(&mut *transaction).await?;
    sqlx::query("UPDATE agent_workspaces SET active_agent_session_id = CASE WHEN active_agent_session_id = ? OR ? IS NULL THEN ? ELSE active_agent_session_id END, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
        .bind(agent_session_id).bind(&fallback).bind(&fallback).bind(now() as i64).bind(&workspace_id).execute(&mut *transaction).await?;
    transaction.commit().await?;
    find(pool, &workspace_id).await
}

async fn create_workspace(
    pool: &SqlitePool,
    name: Option<String>,
    agent_session_ids: &[String],
) -> Result<AgentWorkspace, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let timestamp = now() as i64;
    let mut transaction = pool.begin().await?;
    sqlx::query("INSERT INTO agent_workspaces (id, name, active_agent_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id).bind(name).bind(agent_session_ids.first()).bind(timestamp).bind(timestamp).execute(&mut *transaction).await?;
    for (position, agent_session_id) in agent_session_ids.iter().enumerate() {
        sqlx::query("INSERT INTO agent_workspace_members (agent_session_id, workspace_id, position) VALUES (?, ?, ?)")
            .bind(agent_session_id).bind(&id).bind(position as i64).execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    find(pool, &id).await?.ok_or(sqlx::Error::RowNotFound)
}

async fn reconcile(pool: &SqlitePool, live: &HashSet<String>) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    reconcile_transaction(&mut transaction, live, None).await?;
    transaction.commit().await
}

async fn reconcile_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    live: &HashSet<String>,
    exclude_unowned: Option<&str>,
) -> Result<(), sqlx::Error> {
    let members = sqlx::query_as::<_, (String, String)>(
        "SELECT agent_session_id, workspace_id FROM agent_workspace_members",
    )
    .fetch_all(&mut **transaction)
    .await?;
    let affected = members
        .iter()
        .filter(|(id, _)| !live.contains(id))
        .map(|(_, workspace_id)| workspace_id.clone())
        .collect::<HashSet<_>>();
    for (id, _) in members.iter().filter(|(id, _)| !live.contains(id)) {
        sqlx::query("DELETE FROM agent_workspace_members WHERE agent_session_id = ?")
            .bind(id)
            .execute(&mut **transaction)
            .await?;
    }
    for workspace_id in affected {
        let fallback = sqlx::query_scalar::<_, String>("SELECT agent_session_id FROM agent_workspace_members WHERE workspace_id = ? ORDER BY position, agent_session_id LIMIT 1")
            .bind(&workspace_id).fetch_optional(&mut **transaction).await?;
        sqlx::query("UPDATE agent_workspaces SET active_agent_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ? AND (active_agent_session_id IS NULL OR active_agent_session_id NOT IN (SELECT agent_session_id FROM agent_workspace_members WHERE workspace_id = ?))")
            .bind(&fallback).bind(now() as i64).bind(&workspace_id).bind(&workspace_id).execute(&mut **transaction).await?;
    }
    let owned =
        sqlx::query_scalar::<_, String>("SELECT agent_session_id FROM agent_workspace_members")
            .fetch_all(&mut **transaction)
            .await?
            .into_iter()
            .collect::<HashSet<_>>();
    let mut unowned = live
        .iter()
        .filter(|id| !owned.contains(*id) && exclude_unowned != Some(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    unowned.sort();
    for id in unowned {
        insert_singleton(transaction, &id).await?;
    }
    Ok(())
}

async fn list_items(pool: &SqlitePool) -> Result<Vec<AgentWorkspace>, sqlx::Error> {
    let rows = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_agent_session_id, created_at, updated_at FROM agent_workspaces ORDER BY created_at, id")
        .fetch_all(pool).await?;
    let mut workspaces = Vec::with_capacity(rows.len());
    for row in rows {
        workspaces.push(assemble(pool, row).await?);
    }
    Ok(workspaces)
}

async fn find(pool: &SqlitePool, id: &str) -> Result<Option<AgentWorkspace>, sqlx::Error> {
    let row = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_agent_session_id, created_at, updated_at FROM agent_workspaces WHERE id = ?")
        .bind(id).fetch_optional(pool).await?;
    match row {
        Some(row) => assemble(pool, row).await.map(Some),
        None => Ok(None),
    }
}

pub(crate) async fn exists(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM agent_workspaces WHERE id = ?)")
        .bind(id)
        .fetch_one(pool)
        .await
        .map(|value| value != 0)
}

async fn assemble(pool: &SqlitePool, row: WorkspaceRow) -> Result<AgentWorkspace, sqlx::Error> {
    let members = sqlx::query_as::<_, AgentWorkspaceMember>("SELECT agent_session_id FROM agent_workspace_members WHERE workspace_id = ? ORDER BY position, agent_session_id")
        .bind(&row.id).fetch_all(pool).await?;
    Ok(AgentWorkspace {
        id: row.id,
        name: row.name,
        active_agent_session_id: row.active_agent_session_id,
        members,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

async fn member_belongs(
    pool: &SqlitePool,
    workspace_id: &str,
    id: &str,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM agent_workspace_members WHERE workspace_id = ? AND agent_session_id = ?)")
        .bind(workspace_id).bind(id).fetch_one(pool).await.map(|value| value != 0)
}

fn session_ids_are_live(values: &[String], live: &HashSet<String>) -> bool {
    values.iter().all(|value| live.contains(value))
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
            Json(serde_json::json!({ "agentWorkspace": workspace })).into_response()
        }
        Ok(None) => not_found(),
        Err(_) => database_error(),
    }
}

fn database_result(error_value: sqlx::Error) -> Response {
    if matches!(&error_value, sqlx::Error::Database(error) if error.is_unique_violation()) {
        error(StatusCode::CONFLICT, "AGENT_SESSION_ALREADY_IN_WORKSPACE")
    } else {
        database_error()
    }
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "AGENT_WORKSPACE_NOT_FOUND")
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

    use super::{
        create_workspace, exists, find, reconcile, reconcile_and_attach_agent_session,
        remove_agent_session, session_ids_are_live,
    };

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

    #[test]
    fn workspace_session_validation_requires_every_id_in_live_snapshot() {
        let live = HashSet::from(["live-a".to_string(), "live-b".to_string()]);
        assert!(session_ids_are_live(&members(&[]), &live));
        assert!(session_ids_are_live(&members(&["live-a", "live-b"]), &live));
        assert!(!session_ids_are_live(
            &members(&["live-a", "exited"]),
            &live
        ));
    }

    #[tokio::test]
    async fn workspace_existence_matches_persisted_workspace() {
        let pool = pool().await;
        assert!(!exists(&pool, "missing").await.unwrap());
        let workspace = create_workspace(&pool, None, &[]).await.unwrap();
        assert!(exists(&pool, &workspace.id).await.unwrap());
    }

    #[tokio::test]
    async fn mixed_agents_share_workspace_and_membership_is_global() {
        let pool = pool().await;
        let workspace =
            create_workspace(&pool, None, &members(&["opencode-session", "pi-session"]))
                .await
                .unwrap();
        assert_eq!(workspace.members.len(), 2);
        assert_eq!(
            workspace.active_agent_session_id.as_deref(),
            Some("opencode-session")
        );
        let other = create_workspace(&pool, None, &[]).await.unwrap();
        assert!(
            reconcile_and_attach_agent_session(
                &pool,
                &HashSet::from(["opencode-session".to_string(), "pi-session".to_string(),]),
                Some(&other.id),
                "pi-session",
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn attach_reconciles_stale_members_without_preowning_new_session() {
        let pool = pool().await;
        let target = create_workspace(&pool, None, &members(&["stale", "live"]))
            .await
            .unwrap();
        let live = HashSet::from(["live".to_string(), "new".to_string()]);
        let attached = reconcile_and_attach_agent_session(&pool, &live, Some(&target.id), "new")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            attached
                .members
                .iter()
                .map(|member| member.agent_session_id.as_str())
                .collect::<Vec<_>>(),
            vec!["live", "new"]
        );
        assert_eq!(attached.active_agent_session_id.as_deref(), Some("new"));
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM agent_workspace_members WHERE agent_session_id = 'new'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn removal_falls_back_and_retains_empty_workspace() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &members(&["a", "b"]))
            .await
            .unwrap();
        let remaining = remove_agent_session(&pool, "a").await.unwrap().unwrap();
        assert_eq!(remaining.active_agent_session_id.as_deref(), Some("b"));
        let empty = remove_agent_session(&pool, "b").await.unwrap().unwrap();
        assert_eq!(empty.id, workspace.id);
        assert!(empty.members.is_empty());
        assert_eq!(empty.active_agent_session_id, None);
    }

    #[tokio::test]
    async fn reconciliation_removes_stale_retains_empty_and_owns_live_sessions() {
        let pool = pool().await;
        let first = create_workspace(&pool, None, &members(&["stale", "live"]))
            .await
            .unwrap();
        let empty = create_workspace(&pool, None, &members(&["gone"]))
            .await
            .unwrap();
        reconcile(
            &pool,
            &HashSet::from(["live".to_string(), "unowned".to_string()]),
        )
        .await
        .unwrap();
        let first = find(&pool, &first.id).await.unwrap().unwrap();
        assert_eq!(first.active_agent_session_id.as_deref(), Some("live"));
        assert!(
            find(&pool, &empty.id)
                .await
                .unwrap()
                .unwrap()
                .members
                .is_empty()
        );
        let owner: String = sqlx::query_scalar(
            "SELECT workspace_id FROM agent_workspace_members WHERE agent_session_id = 'unowned'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(find(&pool, &owner).await.unwrap().unwrap().members.len(), 1);
    }
}
