use std::{fs, sync::Arc};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    filesystem::{path_string, resolve_path},
    terminal::{AppState, now},
};

const OPENCODE_AGENT_ID: &str = "opencode";

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPath {
    id: String,
    agent_id: String,
    path: String,
    alias: Option<String>,
    pinned: bool,
    last_used_at: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    agent_id: String,
    path: String,
    alias: Option<String>,
    #[serde(default)]
    pinned: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRequest {
    #[serde(default, deserialize_with = "deserialize_optional_alias")]
    alias: Option<Option<String>>,
    pinned: Option<bool>,
}

fn deserialize_optional_alias<'de, D>(deserializer: D) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    match sqlx::query_as::<_, LaunchPath>("SELECT id, agent_id, path, alias, pinned, last_used_at, created_at, updated_at FROM agent_launch_paths ORDER BY pinned DESC, last_used_at DESC, COALESCE(NULLIF(alias, ''), path) COLLATE NOCASE")
        .fetch_all(&state.pool).await
    {
        Ok(paths) => Json(serde_json::json!({ "agentLaunchPaths": paths })).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    if request.agent_id != OPENCODE_AGENT_ID {
        return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_ID");
    }
    let alias = match validate_alias(request.alias) {
        Ok(value) => value,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    let path = match validated_directory(&request.path) {
        Ok(value) => value,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    let timestamp = now() as i64;
    let item = LaunchPath {
        id: Uuid::new_v4().to_string(),
        agent_id: request.agent_id,
        path,
        alias,
        pinned: request.pinned,
        last_used_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
    };
    let result = sqlx::query_as::<_, LaunchPath>("INSERT INTO agent_launch_paths (id, agent_id, path, alias, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (agent_id, path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at RETURNING id, agent_id, path, alias, pinned, last_used_at, created_at, updated_at")
        .bind(&item.id).bind(&item.agent_id).bind(&item.path).bind(&item.alias).bind(item.pinned)
        .bind(item.last_used_at).bind(item.created_at).bind(item.updated_at).fetch_one(&state.pool).await;
    match result {
        Ok(item) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "agentLaunchPath": item })),
        )
            .into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateRequest>,
) -> Response {
    let alias_supplied = request.alias.is_some();
    let alias = match request.alias {
        Some(value) => match validate_alias(value) {
            Ok(value) => value,
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    if !alias_supplied && request.pinned.is_none() {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let result = sqlx::query("UPDATE agent_launch_paths SET alias = CASE WHEN ? THEN ? ELSE alias END, pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ?")
        .bind(alias_supplied).bind(alias).bind(request.pinned).bind(now() as i64).bind(&id).execute(&state.pool).await;
    match result {
        Ok(value) if value.rows_affected() == 1 => get(&state, &id).await,
        Ok(_) => not_found(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn touch(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let item = match find(&state, &id).await {
        Ok(Some(value)) => value,
        Ok(None) => return not_found(),
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    };
    if validated_directory(&item.path).is_err() {
        return error(StatusCode::BAD_REQUEST, "INVALID_LAUNCH_PATH");
    }
    match sqlx::query("UPDATE agent_launch_paths SET last_used_at = ?, updated_at = ? WHERE id = ?")
        .bind(now() as i64)
        .bind(now() as i64)
        .bind(&id)
        .execute(&state.pool)
        .await
    {
        Ok(_) => get(&state, &id).await,
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match sqlx::query("DELETE FROM agent_launch_paths WHERE id = ?")
        .bind(id)
        .execute(&state.pool)
        .await
    {
        Ok(value) if value.rows_affected() == 1 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => not_found(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

async fn get(state: &AppState, id: &str) -> Response {
    match find(state, id).await {
        Ok(Some(value)) => Json(serde_json::json!({ "agentLaunchPath": value })).into_response(),
        Ok(None) => not_found(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

async fn find(state: &AppState, id: &str) -> Result<Option<LaunchPath>, sqlx::Error> {
    sqlx::query_as::<_, LaunchPath>("SELECT id, agent_id, path, alias, pinned, last_used_at, created_at, updated_at FROM agent_launch_paths WHERE id = ?")
        .bind(id).fetch_optional(&state.pool).await
}

fn validate_alias(value: Option<String>) -> Result<Option<String>, &'static str> {
    let value = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    if value
        .as_ref()
        .is_some_and(|item| item.encode_utf16().count() > 120)
    {
        Err("INVALID_LAUNCH_PATH_ALIAS")
    } else {
        Ok(value)
    }
}

pub fn validated_directory(value: &str) -> Result<String, &'static str> {
    let path = resolve_path(value).map_err(|_| "INVALID_LAUNCH_PATH")?;
    let metadata = fs::metadata(&path).map_err(|_| "INVALID_LAUNCH_PATH")?;
    if !metadata.is_dir() {
        return Err("INVALID_LAUNCH_PATH");
    }
    fs::canonicalize(path)
        .map(path_string)
        .map_err(|_| "INVALID_LAUNCH_PATH")
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "AGENT_LAUNCH_PATH_NOT_FOUND")
}
fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{validate_alias, validated_directory};

    #[test]
    fn validates_alias_and_directory() {
        assert_eq!(validate_alias(Some("  ".into())).unwrap(), None);
        assert!(validate_alias(Some("x".repeat(121))).is_err());
        assert!(validated_directory("/definitely/not/a/devhatch/path").is_err());
    }
}
