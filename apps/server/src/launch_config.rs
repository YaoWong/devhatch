use std::sync::Arc;

use axum::{
    Json,
    extract::rejection::JsonRejection,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Sqlite, Transaction};
use uuid::Uuid;

use crate::{clock::now, state::AppState};

const SCRIPT_LIMIT: usize = 65_536;

#[derive(Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentLaunchConfig {
    pub(crate) id: String,
    pub(crate) agent_id: String,
    pub(crate) name: String,
    pub(crate) is_default: bool,
    pub(crate) pre_launch_script: String,
    pub(crate) provider_script: String,
    pub(crate) tui_script: String,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListQuery {
    agent_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRequest {
    agent_id: String,
    name: String,
    #[serde(default)]
    is_default: bool,
    #[serde(default)]
    pre_launch_script: String,
    #[serde(default)]
    provider_script: String,
    #[serde(default)]
    tui_script: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRequest {
    agent_id: Option<String>,
    name: Option<String>,
    is_default: Option<bool>,
    pre_launch_script: Option<String>,
    provider_script: Option<String>,
    tui_script: Option<String>,
}

pub(crate) async fn list(
    State(state): State<Arc<AppState>>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Response {
    let Query(query) = match query {
        Ok(query) => query,
        Err(_) => return error(StatusCode::BAD_REQUEST, "INVALID_REQUEST"),
    };
    if !crate::agent::supported(&query.agent_id) {
        return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_ID");
    }
    match sqlx::query_as::<_, AgentLaunchConfig>("SELECT id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at FROM agent_launch_configs WHERE agent_id = ? ORDER BY is_default DESC, name COLLATE NOCASE, id")
        .bind(&query.agent_id)
        .fetch_all(state.pool())
        .await
    {
        Ok(configs) => Json(serde_json::json!({ "agentLaunchConfigs": configs })).into_response(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn create(
    State(state): State<Arc<AppState>>,
    request: Result<Json<CreateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return error(StatusCode::BAD_REQUEST, "INVALID_REQUEST"),
    };
    if !crate::agent::supported(&request.agent_id) {
        return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_ID");
    }
    let name = match validate_name(&request.name) {
        Ok(name) => name,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    if let Err(code) = validate_scripts([
        request.pre_launch_script.as_str(),
        request.provider_script.as_str(),
        request.tui_script.as_str(),
    ]) {
        return error(StatusCode::BAD_REQUEST, code);
    }
    let timestamp = now() as i64;
    let config = AgentLaunchConfig {
        id: Uuid::new_v4().to_string(),
        agent_id: request.agent_id,
        name,
        is_default: request.is_default,
        pre_launch_script: request.pre_launch_script,
        provider_script: request.provider_script,
        tui_script: request.tui_script,
        created_at: timestamp,
        updated_at: timestamp,
    };
    let mut transaction = match state.pool().begin().await {
        Ok(transaction) => transaction,
        Err(_) => return database_error(),
    };
    if config.is_default
        && clear_default(&mut transaction, &config.agent_id, timestamp)
            .await
            .is_err()
    {
        return database_error();
    }
    let result = sqlx::query_as::<_, AgentLaunchConfig>("INSERT INTO agent_launch_configs (id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at")
        .bind(&config.id)
        .bind(&config.agent_id)
        .bind(&config.name)
        .bind(config.is_default)
        .bind(&config.pre_launch_script)
        .bind(&config.provider_script)
        .bind(&config.tui_script)
        .bind(config.created_at)
        .bind(config.updated_at)
        .fetch_one(&mut *transaction)
        .await;
    let config = match result {
        Ok(config) => config,
        Err(database) if unique_violation(&database) => {
            return error(StatusCode::CONFLICT, "AGENT_LAUNCH_CONFIG_NAME_CONFLICT");
        }
        Err(_) => return database_error(),
    };
    if transaction.commit().await.is_err() {
        return database_error();
    }
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "agentLaunchConfig": config })),
    )
        .into_response()
}

pub(crate) async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    request: Result<Json<UpdateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return error(StatusCode::BAD_REQUEST, "INVALID_REQUEST"),
    };
    if request
        .agent_id
        .as_deref()
        .is_some_and(|agent_id| !crate::agent::supported(agent_id))
    {
        return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_ID");
    }
    if request.agent_id.is_some()
        && request.name.is_none()
        && request.is_default.is_none()
        && request.pre_launch_script.is_none()
        && request.provider_script.is_none()
        && request.tui_script.is_none()
    {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    if request.agent_id.is_none()
        && request.name.is_none()
        && request.is_default.is_none()
        && request.pre_launch_script.is_none()
        && request.provider_script.is_none()
        && request.tui_script.is_none()
    {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let current = match find(state.pool(), &id).await {
        Ok(Some(config)) => config,
        Ok(None) => return not_found(),
        Err(_) => return database_error(),
    };
    if request
        .agent_id
        .as_deref()
        .is_some_and(|agent_id| agent_id != current.agent_id)
    {
        return not_found();
    }
    if current.is_default && request.is_default == Some(false) {
        return error(StatusCode::CONFLICT, "AGENT_LAUNCH_CONFIG_DEFAULT_REQUIRED");
    }
    let name = match request.name.as_deref() {
        Some(value) => match validate_name(value) {
            Ok(name) => Some(name),
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    if let Err(code) = validate_scripts(
        [
            request.pre_launch_script.as_deref(),
            request.provider_script.as_deref(),
            request.tui_script.as_deref(),
        ]
        .into_iter()
        .flatten(),
    ) {
        return error(StatusCode::BAD_REQUEST, code);
    }
    let mut transaction = match state.pool().begin().await {
        Ok(transaction) => transaction,
        Err(_) => return database_error(),
    };
    let timestamp = now() as i64;
    if request.is_default == Some(true)
        && clear_default(&mut transaction, &current.agent_id, timestamp)
            .await
            .is_err()
    {
        return database_error();
    }
    let result = sqlx::query_as::<_, AgentLaunchConfig>("UPDATE agent_launch_configs SET name = COALESCE(?, name), is_default = COALESCE(?, is_default), pre_launch_script = COALESCE(?, pre_launch_script), provider_script = COALESCE(?, provider_script), tui_script = COALESCE(?, tui_script), updated_at = ? WHERE id = ? AND agent_id = ? RETURNING id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at")
        .bind(name)
        .bind(request.is_default)
        .bind(request.pre_launch_script)
        .bind(request.provider_script)
        .bind(request.tui_script)
        .bind(timestamp)
        .bind(&id)
        .bind(&current.agent_id)
        .fetch_one(&mut *transaction)
        .await;
    let config = match result {
        Ok(config) => config,
        Err(database) if unique_violation(&database) => {
            return error(StatusCode::CONFLICT, "AGENT_LAUNCH_CONFIG_NAME_CONFLICT");
        }
        Err(sqlx::Error::RowNotFound) => return not_found(),
        Err(_) => return database_error(),
    };
    if transaction.commit().await.is_err() {
        return database_error();
    }
    Json(serde_json::json!({ "agentLaunchConfig": config })).into_response()
}

pub(crate) async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let mut transaction = match state.pool().begin().await {
        Ok(transaction) => transaction,
        Err(_) => return database_error(),
    };
    let config = match find_in_transaction(&mut transaction, &id).await {
        Ok(Some(config)) => config,
        Ok(None) => return not_found(),
        Err(_) => return database_error(),
    };
    if config.is_default {
        return error(
            StatusCode::CONFLICT,
            "AGENT_LAUNCH_CONFIG_DEFAULT_DELETE_FORBIDDEN",
        );
    }
    let count = match sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM agent_launch_configs WHERE agent_id = ?",
    )
    .bind(&config.agent_id)
    .fetch_one(&mut *transaction)
    .await
    {
        Ok(count) => count,
        Err(_) => return database_error(),
    };
    if count <= 1 {
        return error(
            StatusCode::CONFLICT,
            "AGENT_LAUNCH_CONFIG_ONLY_DELETE_FORBIDDEN",
        );
    }
    let result = sqlx::query("DELETE FROM agent_launch_configs WHERE id = ? AND agent_id = ?")
        .bind(id)
        .bind(&config.agent_id)
        .execute(&mut *transaction)
        .await;
    match result {
        Ok(result) if result.rows_affected() == 1 => {
            if transaction.commit().await.is_err() {
                database_error()
            } else {
                StatusCode::NO_CONTENT.into_response()
            }
        }
        Ok(_) => not_found(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn resolve(
    state: &AppState,
    agent_id: &str,
    id: Option<&str>,
) -> Result<Option<AgentLaunchConfig>, sqlx::Error> {
    let query = if id.is_some() {
        "SELECT id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at FROM agent_launch_configs WHERE agent_id = ? AND id = ?"
    } else {
        "SELECT id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at FROM agent_launch_configs WHERE agent_id = ? AND is_default = 1 AND ? IS NULL"
    };
    sqlx::query_as(query)
        .bind(agent_id)
        .bind(id)
        .fetch_optional(state.pool())
        .await
}

pub(crate) async fn summary(
    state: &AppState,
    agent_id: &str,
) -> Result<(i64, Option<String>), sqlx::Error> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM agent_launch_configs WHERE agent_id = ?",
    )
    .bind(agent_id)
    .fetch_one(state.pool())
    .await?;
    let default = sqlx::query_scalar::<_, String>(
        "SELECT id FROM agent_launch_configs WHERE agent_id = ? AND is_default = 1",
    )
    .bind(agent_id)
    .fetch_optional(state.pool())
    .await?;
    Ok((count, default))
}

async fn find(pool: &sqlx::SqlitePool, id: &str) -> Result<Option<AgentLaunchConfig>, sqlx::Error> {
    sqlx::query_as("SELECT id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at FROM agent_launch_configs WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

async fn find_in_transaction(
    transaction: &mut Transaction<'_, Sqlite>,
    id: &str,
) -> Result<Option<AgentLaunchConfig>, sqlx::Error> {
    sqlx::query_as("SELECT id, agent_id, name, is_default, pre_launch_script, provider_script, tui_script, created_at, updated_at FROM agent_launch_configs WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut **transaction)
        .await
}

async fn clear_default(
    transaction: &mut Transaction<'_, Sqlite>,
    agent_id: &str,
    timestamp: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE agent_launch_configs SET is_default = 0, updated_at = ? WHERE agent_id = ? AND is_default = 1",
    )
    .bind(timestamp)
    .bind(agent_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn validate_name(value: &str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 {
        Err("INVALID_AGENT_LAUNCH_CONFIG_NAME")
    } else {
        Ok(value.to_string())
    }
}

fn validate_scripts<'a>(scripts: impl IntoIterator<Item = &'a str>) -> Result<(), &'static str> {
    if scripts
        .into_iter()
        .any(|script| script.len() > SCRIPT_LIMIT || script.contains('\0'))
    {
        Err("INVALID_AGENT_LAUNCH_CONFIG_SCRIPT")
    } else {
        Ok(())
    }
}

fn unique_violation(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_unique_violation)
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "AGENT_LAUNCH_CONFIG_NOT_FOUND")
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{validate_name, validate_scripts};

    #[test]
    fn validates_names() {
        assert_eq!(validate_name("  Work  ").unwrap(), "Work");
        assert!(validate_name("  ").is_err());
        assert!(validate_name(&"x".repeat(121)).is_err());
        assert!(validate_name(&"é".repeat(120)).is_ok());
    }

    #[test]
    fn validates_scripts() {
        assert!(validate_scripts(["", "printf '%s' arbitrary"]).is_ok());
        assert!(validate_scripts(["x\0y"]).is_err());
        assert!(validate_scripts(["x".repeat(65_537).as_str()]).is_err());
    }
}
