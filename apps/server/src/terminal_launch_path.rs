use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{api::ApiError, clock::now, filesystem::validated_directory, state::AppState};

#[derive(FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalLaunchPath {
    id: String,
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
    path: String,
    alias: Option<String>,
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
    match list_items(state.pool()).await {
        Ok(paths) => Json(serde_json::json!({ "terminalLaunchPaths": paths })).into_response(),
        Err(_) => database_error(),
    }
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    let alias = match validate_alias(request.alias) {
        Ok(value) => value,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    let path = match validated_directory(&request.path) {
        Ok(value) => value,
        Err(code) => return error(StatusCode::BAD_REQUEST, code),
    };
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    match ensure_item(state.pool(), &path, alias.as_deref()).await {
        Ok(item) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "terminalLaunchPath": item })),
        )
            .into_response(),
        Err(_) => database_error(),
    }
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<UpdateRequest>,
) -> Response {
    let alias_supplied = request.alias.is_some();
    if update_is_empty(&request) {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let alias = match request.alias {
        Some(value) => match validate_alias(value) {
            Ok(value) => value,
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    match sqlx::query("UPDATE terminal_launch_paths SET alias = CASE WHEN ? THEN ? ELSE alias END, pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ?")
        .bind(alias_supplied)
        .bind(alias)
        .bind(request.pinned)
        .bind(now() as i64)
        .bind(&id)
        .execute(state.pool())
        .await
    {
        Ok(value) if value.rows_affected() == 1 => get(state.pool(), &id).await,
        Ok(_) => not_found(),
        Err(_) => database_error(),
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match sqlx::query("DELETE FROM terminal_launch_paths WHERE id = ?")
        .bind(id)
        .execute(state.pool())
        .await
    {
        Ok(value) if value.rows_affected() == 1 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => not_found(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn ensure(
    transaction: &mut Transaction<'_, Sqlite>,
    path: &str,
) -> Result<(), sqlx::Error> {
    let timestamp = now() as i64;
    sqlx::query("INSERT INTO terminal_launch_paths (id, path, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at")
        .bind(Uuid::new_v4().to_string())
        .bind(path)
        .bind(timestamp)
        .bind(timestamp)
        .bind(timestamp)
        .execute(&mut **transaction)
        .await
        .map(|_| ())
}

async fn ensure_item(
    pool: &SqlitePool,
    path: &str,
    alias: Option<&str>,
) -> Result<TerminalLaunchPath, sqlx::Error> {
    let timestamp = now() as i64;
    sqlx::query_as::<_, TerminalLaunchPath>("INSERT INTO terminal_launch_paths (id, path, alias, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at RETURNING id, path, alias, pinned, last_used_at, created_at, updated_at")
        .bind(Uuid::new_v4().to_string())
        .bind(path)
        .bind(alias)
        .bind(timestamp)
        .bind(timestamp)
        .bind(timestamp)
        .fetch_one(pool)
        .await
}

async fn list_items(pool: &SqlitePool) -> Result<Vec<TerminalLaunchPath>, sqlx::Error> {
    sqlx::query_as::<_, TerminalLaunchPath>("SELECT id, path, alias, pinned, last_used_at, created_at, updated_at FROM terminal_launch_paths ORDER BY pinned DESC, last_used_at DESC, path COLLATE NOCASE")
        .fetch_all(pool)
        .await
}

async fn get(pool: &SqlitePool, id: &str) -> Response {
    match find(pool, id).await {
        Ok(Some(item)) => Json(serde_json::json!({ "terminalLaunchPath": item })).into_response(),
        Ok(None) => not_found(),
        Err(_) => database_error(),
    }
}

async fn find(pool: &SqlitePool, id: &str) -> Result<Option<TerminalLaunchPath>, sqlx::Error> {
    sqlx::query_as::<_, TerminalLaunchPath>("SELECT id, path, alias, pinned, last_used_at, created_at, updated_at FROM terminal_launch_paths WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
}

fn update_is_empty(request: &UpdateRequest) -> bool {
    request.alias.is_none() && request.pinned.is_none()
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

fn not_found() -> Response {
    error(StatusCode::NOT_FOUND, "TERMINAL_LAUNCH_PATH_NOT_FOUND")
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &'static str) -> Response {
    ApiError::new(status, code).into_response()
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        CreateRequest, UpdateRequest, ensure_item, list_items, update_is_empty, validate_alias,
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

    #[test]
    fn validates_alias() {
        assert_eq!(
            validate_alias(Some("  label  ".into())).unwrap(),
            Some("label".into())
        );
        assert_eq!(validate_alias(Some("  ".into())).unwrap(), None);
        assert!(validate_alias(Some("x".repeat(121))).is_err());
    }

    #[test]
    fn request_contracts_support_alias_and_reject_unknown_fields() {
        let create =
            serde_json::from_str::<CreateRequest>(r#"{"path":"/tmp","alias":" work "}"#).unwrap();
        assert_eq!(create.alias.as_deref(), Some(" work "));
        assert!(serde_json::from_str::<CreateRequest>(r#"{"path":"/tmp","extra":1}"#).is_err());

        let empty = serde_json::from_str::<UpdateRequest>(r#"{}"#).unwrap();
        assert!(update_is_empty(&empty));
        let absent = serde_json::from_str::<UpdateRequest>(r#"{"pinned":true}"#).unwrap();
        assert!(absent.alias.is_none());
        assert!(!update_is_empty(&absent));
        let null = serde_json::from_str::<UpdateRequest>(r#"{"alias":null}"#).unwrap();
        assert_eq!(null.alias, Some(None));
        assert!(!update_is_empty(&null));
        assert!(serde_json::from_str::<UpdateRequest>(r#"{"extra":1}"#).is_err());
    }

    #[tokio::test]
    async fn ensure_does_not_clear_existing_alias() {
        let pool = pool().await;
        let created = ensure_item(&pool, "/aliased", Some("Alias")).await.unwrap();
        let touched = ensure_item(&pool, "/aliased", None).await.unwrap();
        assert_eq!(created.id, touched.id);
        assert_eq!(touched.alias.as_deref(), Some("Alias"));
    }

    #[tokio::test]
    async fn creates_upserts_pins_orders_and_deletes_paths() {
        let pool = pool().await;
        let first = ensure_item(&pool, "/first", None).await.unwrap();
        let second = ensure_item(&pool, "/second", None).await.unwrap();
        let touched = ensure_item(&pool, "/first", None).await.unwrap();
        assert_eq!(first.id, touched.id);
        assert!(!touched.pinned);
        sqlx::query("UPDATE terminal_launch_paths SET pinned = 1 WHERE id = ?")
            .bind(&second.id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(list_items(&pool).await.unwrap()[0].id, second.id);
        sqlx::query("DELETE FROM terminal_launch_paths WHERE id = ?")
            .bind(&first.id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(list_items(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn listing_does_not_recreate_deleted_paths() {
        let pool = pool().await;
        let item = ensure_item(&pool, "/deleted", None).await.unwrap();
        sqlx::query("DELETE FROM terminal_launch_paths WHERE id = ?")
            .bind(item.id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(list_items(&pool).await.unwrap().is_empty());
        assert!(list_items(&pool).await.unwrap().is_empty());
    }
}
