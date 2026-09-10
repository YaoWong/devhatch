use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{
    api::ApiError,
    clock::now,
    filesystem::{home_dir, path_string},
    session::SessionKind,
    state::AppState,
};

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MemberIdentity {
    session_id: String,
    kind: SessionKind,
}

impl MemberIdentity {
    pub(crate) fn new(session_id: impl Into<String>, kind: SessionKind) -> Self {
        Self {
            session_id: session_id.into(),
            kind,
        }
    }

    pub(crate) fn session_id(&self) -> &str {
        &self.session_id
    }

    pub(crate) fn kind(&self) -> SessionKind {
        self.kind
    }
}

#[derive(Clone, FromRow)]
struct WorkspaceRow {
    id: String,
    name: Option<String>,
    active_session_kind: Option<String>,
    active_session_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Workspace {
    id: String,
    name: Option<String>,
    active_session: Option<MemberIdentity>,
    members: Vec<MemberIdentity>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRequest {
    name: Option<String>,
    members: Vec<MemberIdentity>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRequest {
    #[serde(default, deserialize_with = "deserialize_present")]
    name: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_present")]
    active_session: Option<Option<MemberIdentity>>,
}

fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

pub(crate) async fn list(State(state): State<Arc<AppState>>) -> Response {
    let _lifecycle = state.workspace_lifecycle().lock().await;
    let (eligible, sessions) = state.workspace_snapshot();
    let mut transaction = match state.pool().begin().await {
        Ok(transaction) => transaction,
        Err(_) => return database_error(),
    };
    if reconcile_transaction(&mut transaction, &eligible, None)
        .await
        .is_err()
    {
        return database_error();
    }
    let workspaces = match list_items_in_transaction(&mut transaction).await {
        Ok(workspaces) => workspaces,
        Err(_) => return database_error(),
    };
    if transaction.commit().await.is_err() {
        return database_error();
    }
    let home = home_dir();
    match std::fs::canonicalize(&home) {
        Ok(resolved_home) => Json(serde_json::json!({
            "workspaces": workspaces,
            "sessions": sessions,
            "home": path_string(home),
            "resolvedHome": path_string(resolved_home)
        }))
        .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub(crate) async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    let name = match validate_name(request.name) {
        Ok(name) => name,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    if has_invalid_members(&request.members) {
        return error(StatusCode::BAD_REQUEST, "INVALID_WORKSPACE_MEMBERS");
    }
    let _lifecycle = state.workspace_lifecycle().lock().await;
    let (eligible, _) = state.workspace_snapshot();
    if request
        .members
        .iter()
        .any(|member| !eligible.contains(member))
    {
        return error(StatusCode::BAD_REQUEST, "SESSION_NOT_ELIGIBLE");
    }
    match create_workspace(state.pool(), name, &request.members).await {
        Ok(workspace) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "workspace": workspace })),
        )
            .into_response(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateRequest>,
) -> Response {
    if request.name.is_none() && request.active_session.is_none() {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let name = match request.name {
        Some(name) => match validate_name(name) {
            Ok(name) => Some(name),
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    let _lifecycle = state.workspace_lifecycle().lock().await;
    match sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?)")
        .bind(&id)
        .fetch_one(state.pool())
        .await
    {
        Ok(1) => {}
        Ok(_) => return not_found(),
        Err(_) => return database_error(),
    }
    if let Some(Some(active)) = &request.active_session {
        let (eligible, _) = state.workspace_snapshot();
        if !eligible.contains(active) {
            return error(StatusCode::BAD_REQUEST, "SESSION_NOT_ELIGIBLE");
        }
        match member_belongs(state.pool(), &id, active).await {
            Ok(true) => {}
            Ok(false) => return error(StatusCode::BAD_REQUEST, "ACTIVE_SESSION_NOT_MEMBER"),
            Err(_) => return database_error(),
        }
    }
    match update_workspace(state.pool(), &id, name, request.active_session).await {
        Ok(Some(workspace)) => Json(serde_json::json!({ "workspace": workspace })).into_response(),
        Ok(None) => not_found(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let lifecycle = state.workspace_lifecycle().lock().await;
    let members = match delete_workspace(state.pool(), &id).await {
        Ok(Some(members)) => members,
        Ok(None) => return not_found(),
        Err(_) => return database_error(),
    };
    let mut sessions = Vec::new();
    for member in members {
        if let Some(session) = state.remove_session(member.session_id(), member.kind()) {
            session.mark_deleting();
            sessions.push(session);
        }
    }
    drop(lifecycle);
    for session in sessions {
        session.terminate();
    }
    StatusCode::NO_CONTENT.into_response()
}

pub(crate) async fn attach_session(
    pool: &SqlitePool,
    eligible: &HashSet<MemberIdentity>,
    workspace_id: Option<&str>,
    member: &MemberIdentity,
    launch_path: Option<&str>,
) -> Result<Option<Workspace>, sqlx::Error> {
    let launch_path = launch_path
        .map(crate::filesystem::validated_directory)
        .transpose()
        .map_err(|_| sqlx::Error::Protocol("invalid launch path".to_string()))?;
    let mut transaction = pool.begin().await?;
    reconcile_transaction(&mut transaction, eligible, Some(member)).await?;
    if !eligible.contains(member) {
        transaction.commit().await?;
        return Ok(None);
    }
    let id = if let Some(workspace_id) = workspace_id {
        let exists =
            sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?)")
                .bind(workspace_id)
                .fetch_one(&mut *transaction)
                .await?
                != 0;
        if !exists {
            transaction.rollback().await?;
            return Ok(None);
        }
        let position = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM workspace_members WHERE workspace_id = ?",
        )
        .bind(workspace_id)
        .fetch_one(&mut *transaction)
        .await?;
        insert_member(&mut transaction, workspace_id, member, position).await?;
        sqlx::query("UPDATE workspaces SET active_session_kind = ?, active_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(member.kind().as_str())
            .bind(member.session_id())
            .bind(now() as i64)
            .bind(workspace_id)
            .execute(&mut *transaction)
            .await?;
        workspace_id.to_string()
    } else {
        insert_singleton(&mut transaction, member).await?
    };
    if let Some(path) = launch_path.as_deref() {
        crate::launch_path::ensure(&mut transaction, path).await?;
    }
    let workspace = find_in_transaction(&mut transaction, &id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    transaction.commit().await?;
    Ok(Some(workspace))
}

pub(crate) async fn remove_member(
    pool: &SqlitePool,
    member: &MemberIdentity,
) -> Result<Option<Workspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let row = sqlx::query_as::<_, (String, i64)>(
        "SELECT workspace_id, position FROM workspace_members WHERE session_kind = ? AND session_id = ?",
    )
    .bind(member.kind().as_str())
    .bind(member.session_id())
    .fetch_optional(&mut *transaction)
    .await?;
    let Some((workspace_id, position)) = row else {
        transaction.commit().await?;
        return Ok(None);
    };
    let active = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT active_session_kind, active_session_id FROM workspaces WHERE id = ?",
    )
    .bind(&workspace_id)
    .fetch_one(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM workspace_members WHERE session_kind = ? AND session_id = ?")
        .bind(member.kind().as_str())
        .bind(member.session_id())
        .execute(&mut *transaction)
        .await?;
    if active.0.as_deref() == Some(member.kind().as_str())
        && active.1.as_deref() == Some(member.session_id())
    {
        let fallback = sqlx::query_as::<_, (String, String)>("SELECT session_kind, session_id FROM workspace_members WHERE workspace_id = ? ORDER BY CASE WHEN position > ? THEN 0 ELSE 1 END, position, session_kind, session_id LIMIT 1")
            .bind(&workspace_id)
            .bind(position)
            .fetch_optional(&mut *transaction)
            .await?;
        sqlx::query("UPDATE workspaces SET active_session_kind = ?, active_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(fallback.as_ref().map(|value| value.0.as_str()))
            .bind(fallback.as_ref().map(|value| value.1.as_str()))
            .bind(now() as i64)
            .bind(&workspace_id)
            .execute(&mut *transaction)
            .await?;
    } else {
        sqlx::query("UPDATE workspaces SET updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(now() as i64)
            .bind(&workspace_id)
            .execute(&mut *transaction)
            .await?;
    }
    let workspace = find_in_transaction(&mut transaction, &workspace_id).await?;
    transaction.commit().await?;
    Ok(workspace)
}

async fn create_workspace(
    pool: &SqlitePool,
    name: Option<String>,
    members: &[MemberIdentity],
) -> Result<Workspace, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let timestamp = now() as i64;
    let mut transaction = pool.begin().await?;
    let mut affected = HashSet::new();
    for member in members {
        if let Some(workspace_id) = sqlx::query_scalar::<_, String>(
            "SELECT workspace_id FROM workspace_members WHERE session_kind = ? AND session_id = ?",
        )
        .bind(member.kind().as_str())
        .bind(member.session_id())
        .fetch_optional(&mut *transaction)
        .await?
        {
            affected.insert(workspace_id);
        }
        sqlx::query("DELETE FROM workspace_members WHERE session_kind = ? AND session_id = ?")
            .bind(member.kind().as_str())
            .bind(member.session_id())
            .execute(&mut *transaction)
            .await?;
    }
    for workspace_id in affected {
        repair_workspace(&mut transaction, &workspace_id).await?;
    }
    let active = members.first();
    sqlx::query("INSERT INTO workspaces (id, name, active_session_kind, active_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(active.map(|member| member.kind().as_str()))
        .bind(active.map(MemberIdentity::session_id))
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut *transaction)
        .await?;
    for (position, member) in members.iter().enumerate() {
        insert_member(&mut transaction, &id, member, position as i64).await?;
    }
    let workspace = find_in_transaction(&mut transaction, &id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;
    transaction.commit().await?;
    Ok(workspace)
}

async fn update_workspace(
    pool: &SqlitePool,
    id: &str,
    name: Option<Option<String>>,
    active: Option<Option<MemberIdentity>>,
) -> Result<Option<Workspace>, sqlx::Error> {
    let timestamp = now() as i64;
    let mut transaction = pool.begin().await?;
    let result = match (name, active) {
        (Some(name), Some(active)) => {
            sqlx::query("UPDATE workspaces SET name = ?, active_session_kind = ?, active_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
                .bind(name)
                .bind(active.as_ref().map(|member| member.kind().as_str()))
                .bind(active.as_ref().map(MemberIdentity::session_id))
                .bind(timestamp)
                .bind(id)
                .execute(&mut *transaction)
                .await?
        }
        (Some(name), None) => {
            sqlx::query("UPDATE workspaces SET name = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
                .bind(name)
                .bind(timestamp)
                .bind(id)
                .execute(&mut *transaction)
                .await?
        }
        (None, Some(active)) => {
            sqlx::query("UPDATE workspaces SET active_session_kind = ?, active_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
                .bind(active.as_ref().map(|member| member.kind().as_str()))
                .bind(active.as_ref().map(MemberIdentity::session_id))
                .bind(timestamp)
                .bind(id)
                .execute(&mut *transaction)
                .await?
        }
        (None, None) => unreachable!(),
    };
    if result.rows_affected() == 0 {
        transaction.rollback().await?;
        Ok(None)
    } else {
        let workspace = find_in_transaction(&mut transaction, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        transaction.commit().await?;
        Ok(Some(workspace))
    }
}

async fn delete_workspace(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<Vec<MemberIdentity>>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let members = load_members(&mut transaction, id).await?;
    sqlx::query("DELETE FROM workspace_members WHERE workspace_id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    let result = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    if result.rows_affected() == 0 {
        transaction.rollback().await?;
        return Ok(None);
    }
    transaction.commit().await?;
    Ok(Some(members))
}

#[cfg(test)]
async fn reconcile(
    pool: &SqlitePool,
    eligible: &HashSet<MemberIdentity>,
) -> Result<(), sqlx::Error> {
    let mut transaction = pool.begin().await?;
    reconcile_transaction(&mut transaction, eligible, None).await?;
    transaction.commit().await
}

async fn reconcile_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    eligible: &HashSet<MemberIdentity>,
    exclude_unowned: Option<&MemberIdentity>,
) -> Result<(), sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String, String)>(
        "SELECT session_kind, session_id, workspace_id FROM workspace_members",
    )
    .fetch_all(&mut **transaction)
    .await?;
    let mut owned = HashSet::new();
    let mut affected = HashSet::new();
    for (kind, session_id, workspace_id) in rows {
        let member = member_from_parts(kind, session_id)?;
        if eligible.contains(&member) {
            owned.insert(member);
        } else {
            sqlx::query("DELETE FROM workspace_members WHERE session_kind = ? AND session_id = ?")
                .bind(member.kind().as_str())
                .bind(member.session_id())
                .execute(&mut **transaction)
                .await?;
            affected.insert(workspace_id);
        }
    }
    for workspace_id in affected {
        repair_workspace(transaction, &workspace_id).await?;
    }
    let mut unowned = eligible
        .iter()
        .filter(|member| !owned.contains(*member) && exclude_unowned != Some(*member))
        .cloned()
        .collect::<Vec<_>>();
    unowned.sort_by(|left, right| {
        (left.kind().as_str(), left.session_id()).cmp(&(right.kind().as_str(), right.session_id()))
    });
    for member in unowned {
        insert_singleton(transaction, &member).await?;
    }
    Ok(())
}

async fn repair_workspace(
    transaction: &mut Transaction<'_, Sqlite>,
    workspace_id: &str,
) -> Result<(), sqlx::Error> {
    let active = sqlx::query_as::<_, (Option<String>, Option<String>)>(
        "SELECT active_session_kind, active_session_id FROM workspaces WHERE id = ?",
    )
    .bind(workspace_id)
    .fetch_optional(&mut **transaction)
    .await?;
    let Some((active_kind, active_id)) = active else {
        return Ok(());
    };
    let active_valid = match (active_kind.as_deref(), active_id.as_deref()) {
        (Some(kind), Some(id)) => {
            sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id = ? AND session_kind = ? AND session_id = ?)")
                .bind(workspace_id)
                .bind(kind)
                .bind(id)
                .fetch_one(&mut **transaction)
                .await?
                != 0
        }
        (None, None) => true,
        _ => false,
    };
    let fallback = if active_valid {
        None
    } else {
        sqlx::query_as::<_, (String, String)>("SELECT session_kind, session_id FROM workspace_members WHERE workspace_id = ? ORDER BY position, session_kind, session_id LIMIT 1")
            .bind(workspace_id)
            .fetch_optional(&mut **transaction)
            .await?
    };
    if active_valid {
        sqlx::query("UPDATE workspaces SET updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(now() as i64)
            .bind(workspace_id)
            .execute(&mut **transaction)
            .await?;
    } else {
        sqlx::query("UPDATE workspaces SET active_session_kind = ?, active_session_id = ?, updated_at = MAX(?, updated_at + 1) WHERE id = ?")
            .bind(fallback.as_ref().map(|value| value.0.as_str()))
            .bind(fallback.as_ref().map(|value| value.1.as_str()))
            .bind(now() as i64)
            .bind(workspace_id)
            .execute(&mut **transaction)
            .await?;
    }
    Ok(())
}

async fn insert_singleton(
    transaction: &mut Transaction<'_, Sqlite>,
    member: &MemberIdentity,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let timestamp = now() as i64;
    sqlx::query("INSERT INTO workspaces (id, name, active_session_kind, active_session_id, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)")
        .bind(&id)
        .bind(member.kind().as_str())
        .bind(member.session_id())
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut **transaction)
        .await?;
    insert_member(transaction, &id, member, 0).await?;
    Ok(id)
}

async fn insert_member(
    transaction: &mut Transaction<'_, Sqlite>,
    workspace_id: &str,
    member: &MemberIdentity,
    position: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO workspace_members (session_kind, session_id, workspace_id, position) VALUES (?, ?, ?, ?)")
        .bind(member.kind().as_str())
        .bind(member.session_id())
        .bind(workspace_id)
        .bind(position)
        .execute(&mut **transaction)
        .await?;
    Ok(())
}

#[cfg(test)]
async fn list_items(pool: &SqlitePool) -> Result<Vec<Workspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let workspaces = list_items_in_transaction(&mut transaction).await?;
    transaction.commit().await?;
    Ok(workspaces)
}

async fn list_items_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
) -> Result<Vec<Workspace>, sqlx::Error> {
    let rows = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_session_kind, active_session_id, created_at, updated_at FROM workspaces ORDER BY created_at, id")
        .fetch_all(&mut **transaction)
        .await?;
    let member_rows = sqlx::query_as::<_, (String, String, String)>("SELECT workspace_id, session_kind, session_id FROM workspace_members ORDER BY workspace_id, position, session_kind, session_id")
        .fetch_all(&mut **transaction)
        .await?;
    let mut members = HashMap::<String, Vec<MemberIdentity>>::new();
    for (workspace_id, kind, session_id) in member_rows {
        members
            .entry(workspace_id)
            .or_default()
            .push(member_from_parts(kind, session_id)?);
    }
    rows.into_iter()
        .map(|row| {
            let row_members = members.remove(&row.id).unwrap_or_default();
            assemble(row, row_members)
        })
        .collect()
}

#[cfg(test)]
async fn find(pool: &SqlitePool, id: &str) -> Result<Option<Workspace>, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let workspace = find_in_transaction(&mut transaction, id).await?;
    transaction.commit().await?;
    Ok(workspace)
}

async fn find_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<Option<Workspace>, sqlx::Error> {
    let row = sqlx::query_as::<_, WorkspaceRow>("SELECT id, name, active_session_kind, active_session_id, created_at, updated_at FROM workspaces WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let rows = sqlx::query_as::<_, (String, String)>("SELECT session_kind, session_id FROM workspace_members WHERE workspace_id = ? ORDER BY position, session_kind, session_id")
        .bind(id)
        .fetch_all(&mut **transaction)
        .await?;
    let members = rows
        .into_iter()
        .map(|(kind, id)| member_from_parts(kind, id))
        .collect::<Result<Vec<_>, _>>()?;
    assemble(row, members).map(Some)
}

async fn load_members(
    transaction: &mut Transaction<'_, Sqlite>,
    workspace_id: &str,
) -> Result<Vec<MemberIdentity>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String)>("SELECT session_kind, session_id FROM workspace_members WHERE workspace_id = ? ORDER BY position, session_kind, session_id")
        .bind(workspace_id)
        .fetch_all(&mut **transaction)
        .await?;
    rows.into_iter()
        .map(|(kind, id)| member_from_parts(kind, id))
        .collect()
}

fn assemble(row: WorkspaceRow, members: Vec<MemberIdentity>) -> Result<Workspace, sqlx::Error> {
    let active_session = match (row.active_session_kind, row.active_session_id) {
        (Some(kind), Some(id)) => Some(member_from_parts(kind, id)?),
        (None, None) => None,
        _ => {
            return Err(sqlx::Error::Decode(
                "invalid workspace active session".into(),
            ));
        }
    };
    Ok(Workspace {
        id: row.id,
        name: row.name,
        active_session,
        members,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

async fn member_belongs(
    pool: &SqlitePool,
    workspace_id: &str,
    member: &MemberIdentity,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id = ? AND session_kind = ? AND session_id = ?)")
        .bind(workspace_id)
        .bind(member.kind().as_str())
        .bind(member.session_id())
        .fetch_one(pool)
        .await
        .map(|value| value != 0)
}

fn member_from_parts(kind: String, session_id: String) -> Result<MemberIdentity, sqlx::Error> {
    let kind = SessionKind::from_str(&kind)
        .ok_or_else(|| sqlx::Error::Decode("invalid workspace session kind".into()))?;
    Ok(MemberIdentity::new(session_id, kind))
}

fn has_invalid_members(members: &[MemberIdentity]) -> bool {
    let mut unique = HashSet::new();
    members
        .iter()
        .any(|member| member.session_id.is_empty() || !unique.insert(member))
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

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "WORKSPACE_NOT_FOUND")
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &'static str) -> Response {
    ApiError::new(status, code).into_response()
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, sync::Arc, time::Duration};

    use portable_pty::CommandBuilder;
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        MemberIdentity, StatusCode, attach_session, create_workspace, delete_workspace, find,
        list_items, reconcile, remove as remove_workspace, remove_member, update_workspace,
    };
    use crate::{
        session::{Session, SessionKind, SessionSpawn},
        state::{AppState, OpenCodeHistoryPool},
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

    fn terminal(id: &str) -> MemberIdentity {
        MemberIdentity::new(id, SessionKind::Terminal)
    }

    fn agent(id: &str) -> MemberIdentity {
        MemberIdentity::new(id, SessionKind::Agent)
    }

    fn spawn_session(
        state: &Arc<AppState>,
        cwd: &std::path::Path,
        kind: SessionKind,
    ) -> Arc<Session> {
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let agent = kind == SessionKind::Agent;
        Session::spawn(
            state.session_registry(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: cwd.to_owned(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: agent.then_some("test"),
                agent_name: agent.then_some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: agent.then(|| state.agent_exit_cleanup()),
            },
            |_| {},
        )
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delete_endpoint_removes_and_terminates_every_runtime() {
        let temp = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(temp.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            temp.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(temp.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        let terminal_session = spawn_session(&state, temp.path(), SessionKind::Terminal);
        let agent_session = spawn_session(&state, temp.path(), SessionKind::Agent);
        let workspace = create_workspace(
            state.pool(),
            None,
            &[terminal(terminal_session.id()), agent(agent_session.id())],
        )
        .await
        .unwrap();
        let response = remove_workspace(
            axum::extract::State(state.clone()),
            axum::extract::Path(workspace.id.clone()),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(find(state.pool(), &workspace.id).await.unwrap().is_none());
        assert!(
            state
                .session(terminal_session.id(), SessionKind::Terminal)
                .is_none()
        );
        assert!(
            state
                .session(agent_session.id(), SessionKind::Agent)
                .is_none()
        );
        tokio::time::timeout(
            Duration::from_secs(5),
            terminal_session.wait_for_completion(),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), agent_session.wait_for_completion())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn mixed_workspace_preserves_order_and_cross_kind_identity() {
        let pool = pool().await;
        let workspace = create_workspace(
            &pool,
            Some("mixed".into()),
            &[terminal("same"), agent("same"), terminal("last")],
        )
        .await
        .unwrap();
        assert_eq!(
            workspace.members,
            [terminal("same"), agent("same"), terminal("last")]
        );
        assert_eq!(workspace.active_session, Some(terminal("same")));
        let empty = create_workspace(&pool, Some("empty".into()), &[])
            .await
            .unwrap();
        assert!(empty.members.is_empty());
        assert!(empty.active_session.is_none());
        assert_eq!(list_items(&pool).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn create_rehomes_members_and_repairs_old_active() {
        let pool = pool().await;
        let old = create_workspace(&pool, None, &[terminal("a"), agent("b")])
            .await
            .unwrap();
        let grouped = create_workspace(&pool, None, &[terminal("a")])
            .await
            .unwrap();
        assert_eq!(grouped.members, [terminal("a")]);
        let old = find(&pool, &old.id).await.unwrap().unwrap();
        assert_eq!(old.members, [agent("b")]);
        assert_eq!(old.active_session, Some(agent("b")));
    }

    #[tokio::test]
    async fn removal_falls_back_across_kinds_and_retains_empty_workspace() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &[terminal("a"), agent("b")])
            .await
            .unwrap();
        let remaining = remove_member(&pool, &terminal("a")).await.unwrap().unwrap();
        assert_eq!(remaining.active_session, Some(agent("b")));
        let empty = remove_member(&pool, &agent("b")).await.unwrap().unwrap();
        assert_eq!(empty.id, workspace.id);
        assert!(empty.members.is_empty());
        assert!(empty.active_session.is_none());
    }

    #[tokio::test]
    async fn active_update_supports_null_and_mixed_member_identity() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &[terminal("a"), agent("b")])
            .await
            .unwrap();
        let cleared = update_workspace(&pool, &workspace.id, None, Some(None))
            .await
            .unwrap()
            .unwrap();
        assert!(cleared.active_session.is_none());
        let selected = update_workspace(
            &pool,
            &workspace.id,
            Some(Some("renamed".to_string())),
            Some(Some(agent("b"))),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(selected.name.as_deref(), Some("renamed"));
        assert_eq!(selected.active_session, Some(agent("b")));
    }

    #[tokio::test]
    async fn removal_prefers_the_next_member_after_the_removed_active() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &[terminal("a"), agent("b"), terminal("c")])
            .await
            .unwrap();
        update_workspace(&pool, &workspace.id, None, Some(Some(agent("b"))))
            .await
            .unwrap();
        let remaining = remove_member(&pool, &agent("b")).await.unwrap().unwrap();
        assert_eq!(remaining.active_session, Some(terminal("c")));
    }

    #[tokio::test]
    async fn reconciliation_cleans_stale_and_creates_singletons_for_all_unowned() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &[terminal("stale"), agent("live")])
            .await
            .unwrap();
        let eligible = HashSet::from([agent("live"), terminal("unowned")]);
        reconcile(&pool, &eligible).await.unwrap();
        let workspace = find(&pool, &workspace.id).await.unwrap().unwrap();
        assert_eq!(workspace.members, [agent("live")]);
        assert_eq!(workspace.active_session, Some(agent("live")));
        assert!(
            list_items(&pool)
                .await
                .unwrap()
                .iter()
                .any(|workspace| { workspace.members == [terminal("unowned")] })
        );
    }

    #[tokio::test]
    async fn attach_handles_missing_workspace_singleton_and_fast_exit() {
        let pool = pool().await;
        let root = tempfile::tempdir().unwrap();
        let canonical = root.path().canonicalize().unwrap();
        let member = agent("new");
        assert!(
            attach_session(
                &pool,
                &HashSet::from([member.clone()]),
                Some("missing"),
                &member,
                None,
            )
            .await
            .unwrap()
            .is_none()
        );
        let singleton = attach_session(
            &pool,
            &HashSet::from([member.clone()]),
            None,
            &member,
            Some(root.path().to_str().unwrap()),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(singleton.members.as_slice(), std::slice::from_ref(&member));
        let launch_path: String = sqlx::query_scalar("SELECT path FROM launch_paths")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(launch_path, canonical.to_string_lossy());
        let fast = agent("fast");
        assert!(
            attach_session(&pool, &HashSet::new(), None, &fast, None)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn attach_canonicalizes_symlink_launch_paths_to_one_identity() {
        let pool = pool().await;
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("directory");
        let link = root.path().join("link");
        std::fs::create_dir(&directory).unwrap();
        std::os::unix::fs::symlink(&directory, &link).unwrap();
        let first = terminal("first");
        let second = agent("second");

        attach_session(
            &pool,
            &HashSet::from([first.clone()]),
            None,
            &first,
            Some(link.to_str().unwrap()),
        )
        .await
        .unwrap();
        attach_session(
            &pool,
            &HashSet::from([first, second.clone()]),
            None,
            &second,
            Some(directory.to_str().unwrap()),
        )
        .await
        .unwrap();

        let paths = sqlx::query_as::<_, (String, String)>("SELECT id, path FROM launch_paths")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(
            paths[0].1,
            directory.canonicalize().unwrap().to_string_lossy()
        );
    }

    #[tokio::test]
    async fn attach_rolls_back_when_workspace_response_cannot_be_assembled() {
        let pool = pool().await;
        sqlx::query("INSERT INTO workspaces (id, name, active_session_kind, active_session_id, created_at, updated_at) VALUES ('corrupt', NULL, NULL, NULL, 0, 0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA ignore_check_constraints = ON")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER corrupt_workspace_response AFTER UPDATE ON workspaces BEGIN UPDATE workspaces SET active_session_kind = NULL WHERE id = NEW.id; END")
            .execute(&pool)
            .await
            .unwrap();
        let root = tempfile::tempdir().unwrap();
        let member = terminal("rollback-response");
        assert!(
            attach_session(
                &pool,
                &HashSet::from([member.clone()]),
                Some("corrupt"),
                &member,
                Some(root.path().to_str().unwrap()),
            )
            .await
            .is_err()
        );
        sqlx::query("PRAGMA ignore_check_constraints = OFF")
            .execute(&pool)
            .await
            .unwrap();
        let counts = sqlx::query_as::<_, (i64, i64)>(
            "SELECT (SELECT COUNT(*) FROM workspace_members), (SELECT COUNT(*) FROM launch_paths)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(counts, (0, 0));
    }

    #[tokio::test]
    async fn attach_rolls_back_workspace_when_launch_path_touch_fails() {
        let pool = pool().await;
        sqlx::query("DROP TABLE launch_paths")
            .execute(&pool)
            .await
            .unwrap();
        let member = terminal("rollback");
        assert!(
            attach_session(
                &pool,
                &HashSet::from([member.clone()]),
                None,
                &member,
                Some("/missing-table"),
            )
            .await
            .is_err()
        );
        let workspaces: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
            .fetch_one(&pool)
            .await
            .unwrap();
        let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspace_members")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!((workspaces, members), (0, 0));
    }

    #[tokio::test]
    async fn create_and_update_roll_back_when_response_cannot_be_assembled() {
        let pool = pool().await;
        sqlx::query("PRAGMA ignore_check_constraints = ON")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER corrupt_created_workspace AFTER INSERT ON workspaces BEGIN UPDATE workspaces SET active_session_kind = NULL WHERE id = NEW.id; END")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            create_workspace(&pool, Some("created".into()), &[terminal("create")])
                .await
                .is_err()
        );
        let workspaces: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(workspaces, 0);
        sqlx::query("DROP TRIGGER corrupt_created_workspace")
            .execute(&pool)
            .await
            .unwrap();

        let workspace = create_workspace(&pool, Some("original".into()), &[terminal("update")])
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER corrupt_updated_workspace AFTER UPDATE ON workspaces BEGIN UPDATE workspaces SET active_session_kind = NULL WHERE id = NEW.id; END")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            update_workspace(&pool, &workspace.id, Some(Some("changed".into())), None)
                .await
                .is_err()
        );
        sqlx::query("DROP TRIGGER corrupt_updated_workspace")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("PRAGMA ignore_check_constraints = OFF")
            .execute(&pool)
            .await
            .unwrap();
        let unchanged = find(&pool, &workspace.id).await.unwrap().unwrap();
        assert_eq!(unchanged.name.as_deref(), Some("original"));
        assert_eq!(unchanged.active_session, Some(terminal("update")));
    }

    #[tokio::test]
    async fn delete_returns_members_and_removes_workspace_atomically() {
        let pool = pool().await;
        let workspace = create_workspace(&pool, None, &[terminal("a"), agent("b")])
            .await
            .unwrap();
        assert_eq!(
            delete_workspace(&pool, &workspace.id)
                .await
                .unwrap()
                .unwrap(),
            [terminal("a"), agent("b")]
        );
        assert!(find(&pool, &workspace.id).await.unwrap().is_none());
        assert!(delete_workspace(&pool, "missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn migration_namespaces_legacy_workspaces_without_losing_data() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in [
            include_str!("../migrations/0001_global.sql"),
            include_str!("../migrations/0002_terminal.sql"),
            include_str!("../migrations/0003_agent.sql"),
            include_str!("../migrations/0004_display_settings.sql"),
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO terminal_workspaces (id, name, active_terminal_id, created_at, updated_at) VALUES ('same', 'term', 'shared', 1, 2), ('empty', NULL, NULL, 3, 4)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO terminal_workspace_members (terminal_id, workspace_id, position) VALUES ('tail', 'same', 1), ('shared', 'same', 0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_workspaces (id, name, active_agent_session_id, created_at, updated_at) VALUES ('same', 'agent', 'shared', 5, 6), ('empty', NULL, NULL, 7, 8)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_workspace_members (agent_session_id, workspace_id, position) VALUES ('shared', 'same', 0), ('tail', 'same', 1)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO terminal_launch_paths (id, path, alias, pinned, last_used_at, created_at, updated_at) VALUES ('terminal-shared', '/shared', 'Terminal', 0, 5, 20, 30), ('terminal-empty-alias', '/agent-alias', '   ', 1, 4, 8, 12), ('same-path-id', '/terminal-only', NULL, 0, 3, 3, 3)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_launch_paths (id, path, alias, pinned, last_used_at, created_at, updated_at) VALUES ('agent-shared', '/shared', 'Agent', 1, 10, 10, 40), ('agent-alias', '/agent-alias', 'Agent alias', 0, 6, 9, 11), ('same-path-id', '/agent-only', 'Only agent', 1, 7, 7, 7), ('terminal:same-path-id', '/prefixed-collision', NULL, 0, 2, 2, 2)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE app_settings SET agent_launch_paths_max_height_px = 320 WHERE id = 1")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0005_workspace.sql"))
            .execute(&pool)
            .await
            .unwrap();
        let workspaces = list_items(&pool).await.unwrap();
        let terminal_workspace = workspaces
            .iter()
            .find(|workspace| workspace.id == "terminal:same")
            .unwrap();
        assert_eq!(
            terminal_workspace.members,
            [terminal("shared"), terminal("tail")]
        );
        assert_eq!(terminal_workspace.active_session, Some(terminal("shared")));
        let agent_workspace = workspaces
            .iter()
            .find(|workspace| workspace.id == "agent:same")
            .unwrap();
        assert_eq!(agent_workspace.members, [agent("shared"), agent("tail")]);
        assert_eq!(agent_workspace.active_session, Some(agent("shared")));
        assert!(
            workspaces.iter().any(|workspace| {
                workspace.id == "terminal:empty" && workspace.members.is_empty()
            })
        );
        assert!(
            workspaces
                .iter()
                .any(|workspace| { workspace.id == "agent:empty" && workspace.members.is_empty() })
        );
        let shared_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_members WHERE session_id = 'shared'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(shared_count, 2);
        let launch_paths = sqlx::query_as::<_, (String, String, Option<String>, bool, i64, i64, i64)>(
            "SELECT id, path, alias, pinned, last_used_at, created_at, updated_at FROM launch_paths ORDER BY path",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            launch_paths,
            [
                (
                    "terminal:terminal-empty-alias".to_string(),
                    "/agent-alias".to_string(),
                    Some("Agent alias".to_string()),
                    true,
                    6,
                    8,
                    12,
                ),
                (
                    "agent:same-path-id".to_string(),
                    "/agent-only".to_string(),
                    Some("Only agent".to_string()),
                    true,
                    7,
                    7,
                    7,
                ),
                (
                    "agent:terminal:same-path-id".to_string(),
                    "/prefixed-collision".to_string(),
                    None,
                    false,
                    2,
                    2,
                    2,
                ),
                (
                    "terminal:terminal-shared".to_string(),
                    "/shared".to_string(),
                    Some("Terminal".to_string()),
                    true,
                    10,
                    10,
                    40,
                ),
                (
                    "terminal:same-path-id".to_string(),
                    "/terminal-only".to_string(),
                    None,
                    false,
                    3,
                    3,
                    3,
                ),
            ]
        );
        let height: i64 =
            sqlx::query_scalar("SELECT launch_paths_max_height_px FROM app_settings WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(height, 320);
        for table in [
            "terminal_workspace_members",
            "terminal_workspaces",
            "agent_workspace_members",
            "agent_workspaces",
            "terminal_launch_paths",
            "agent_launch_paths",
        ] {
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(exists, 0, "obsolete table {table} remains");
        }
    }
}
