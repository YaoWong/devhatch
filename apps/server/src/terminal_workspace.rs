use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

use crate::{clock::now, filesystem::validated_directory, state::AppState};

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWorkspace {
    id: String,
    path: String,
    pinned: bool,
    last_used_at: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateRequest {
    pinned: Option<bool>,
}

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    for path in state.terminal_cwds() {
        if insert_if_missing(state.pool(), &path).await.is_err() {
            return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR");
        }
    }
    match list_items(state.pool()).await {
        Ok(workspaces) => {
            Json(serde_json::json!({ "terminalWorkspaces": workspaces })).into_response()
        }
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    let path = match validated_directory(&request.path) {
        Ok(value) => value,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    match ensure_item(state.pool(), &path).await {
        Ok(item) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "terminalWorkspace": item })),
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
    let Some(pinned) = request.pinned else {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    };
    let result =
        sqlx::query("UPDATE terminal_workspaces SET pinned = ?, updated_at = ? WHERE id = ?")
            .bind(pinned)
            .bind(now() as i64)
            .bind(&id)
            .execute(state.pool())
            .await;
    match result {
        Ok(value) if value.rows_affected() == 1 => get(state.pool(), &id).await,
        Ok(_) => not_found(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    remove_locked(&state, &id).await
}

async fn remove_locked(state: &AppState, id: &str) -> Response {
    let item = match find(state.pool(), id).await {
        Ok(Some(value)) => value,
        Ok(None) => return not_found(),
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    };
    if state.has_terminal_cwd(&item.path) {
        return error(StatusCode::CONFLICT, "WORKSPACE_HAS_TERMINALS");
    }
    match sqlx::query("DELETE FROM terminal_workspaces WHERE id = ?")
        .bind(id)
        .execute(state.pool())
        .await
    {
        Ok(value) if value.rows_affected() == 1 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => not_found(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub(crate) async fn insert_if_missing(pool: &SqlitePool, path: &str) -> Result<(), sqlx::Error> {
    let timestamp = now() as i64;
    sqlx::query("INSERT OR IGNORE INTO terminal_workspaces (id, path, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)")
        .bind(Uuid::new_v4().to_string())
        .bind(path)
        .bind(timestamp)
        .bind(timestamp)
        .bind(timestamp)
        .execute(pool)
        .await
        .map(|_| ())
}

pub(crate) async fn ensure(pool: &SqlitePool, path: &str) -> Result<(), sqlx::Error> {
    ensure_item(pool, path).await.map(|_| ())
}

async fn ensure_item(pool: &SqlitePool, path: &str) -> Result<TerminalWorkspace, sqlx::Error> {
    let timestamp = now() as i64;
    sqlx::query_as::<_, TerminalWorkspace>("INSERT INTO terminal_workspaces (id, path, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at RETURNING id, path, pinned, last_used_at, created_at, updated_at")
        .bind(Uuid::new_v4().to_string())
        .bind(path)
        .bind(timestamp)
        .bind(timestamp)
        .bind(timestamp)
        .fetch_one(pool)
        .await
}

async fn list_items(pool: &SqlitePool) -> Result<Vec<TerminalWorkspace>, sqlx::Error> {
    sqlx::query_as::<_, TerminalWorkspace>("SELECT id, path, pinned, last_used_at, created_at, updated_at FROM terminal_workspaces ORDER BY pinned DESC, last_used_at DESC, path COLLATE NOCASE")
        .fetch_all(pool)
        .await
}

async fn get(pool: &SqlitePool, id: &str) -> Response {
    match find(pool, id).await {
        Ok(Some(item)) => Json(serde_json::json!({ "terminalWorkspace": item })).into_response(),
        Ok(None) => not_found(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

async fn find(pool: &SqlitePool, id: &str) -> Result<Option<TerminalWorkspace>, sqlx::Error> {
    sqlx::query_as::<_, TerminalWorkspace>("SELECT id, path, pinned, last_used_at, created_at, updated_at FROM terminal_workspaces WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "TERMINAL_WORKSPACE_NOT_FOUND")
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{ensure_item, list_items};

    #[tokio::test]
    async fn creates_upserts_pins_orders_and_deletes_workspaces() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let first = ensure_item(&pool, "/first").await.unwrap();
        let second = ensure_item(&pool, "/second").await.unwrap();
        let touched = ensure_item(&pool, "/first").await.unwrap();
        assert_eq!(first.id, touched.id);
        assert!(!touched.pinned);
        sqlx::query("UPDATE terminal_workspaces SET pinned = 1 WHERE id = ?")
            .bind(&second.id)
            .execute(&pool)
            .await
            .unwrap();
        let items = list_items(&pool).await.unwrap();
        assert_eq!(items[0].id, second.id);
        sqlx::query("DELETE FROM terminal_workspaces WHERE id = ?")
            .bind(&first.id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(list_items(&pool).await.unwrap().len(), 1);
    }
}
