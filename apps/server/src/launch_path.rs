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
struct LaunchPath {
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
pub(crate) struct CreateRequest {
    path: String,
    alias: Option<String>,
    #[serde(default)]
    pinned: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRequest {
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

pub(crate) async fn list(State(state): State<Arc<AppState>>) -> Response {
    match list_items(state.pool()).await {
        Ok(paths) => Json(serde_json::json!({ "launchPaths": paths })).into_response(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn create(
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
    match ensure_item(state.pool(), &path, alias.as_deref(), request.pinned).await {
        Ok(item) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "launchPath": item })),
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
    let alias_supplied = request.alias.is_some();
    if !alias_supplied && request.pinned.is_none() {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    }
    let alias = match request.alias {
        Some(value) => match validate_alias(value) {
            Ok(value) => value,
            Err(code) => return error(StatusCode::BAD_REQUEST, code),
        },
        None => None,
    };
    match sqlx::query_as::<_, LaunchPath>("UPDATE launch_paths SET alias = CASE WHEN ? THEN ? ELSE alias END, pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ? RETURNING id, path, alias, pinned, last_used_at, created_at, updated_at")
        .bind(alias_supplied)
        .bind(alias)
        .bind(request.pinned)
        .bind(now() as i64)
        .bind(&id)
        .fetch_optional(state.pool())
        .await
    {
        Ok(Some(item)) => Json(serde_json::json!({ "launchPath": item })).into_response(),
        Ok(None) => not_found(),
        Err(_) => database_error(),
    }
}

pub(crate) async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match sqlx::query("DELETE FROM launch_paths WHERE id = ?")
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
    sqlx::query("INSERT INTO launch_paths (id, path, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at")
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
    pinned: bool,
) -> Result<LaunchPath, sqlx::Error> {
    let timestamp = now() as i64;
    sqlx::query_as::<_, LaunchPath>("INSERT INTO launch_paths (id, path, alias, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at RETURNING id, path, alias, pinned, last_used_at, created_at, updated_at")
        .bind(Uuid::new_v4().to_string())
        .bind(path)
        .bind(alias)
        .bind(pinned)
        .bind(timestamp)
        .bind(timestamp)
        .bind(timestamp)
        .fetch_one(pool)
        .await
}

async fn list_items(pool: &SqlitePool) -> Result<Vec<LaunchPath>, sqlx::Error> {
    sqlx::query_as::<_, LaunchPath>("SELECT id, path, alias, pinned, last_used_at, created_at, updated_at FROM launch_paths ORDER BY pinned DESC, last_used_at DESC, path COLLATE NOCASE")
        .fetch_all(pool)
        .await
}

pub(crate) async fn paths(state: &AppState) -> Result<Vec<std::path::PathBuf>, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT path FROM launch_paths")
        .fetch_all(state.pool())
        .await
        .map(|paths| paths.into_iter().map(Into::into).collect())
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
    error(StatusCode::NOT_FOUND, "LAUNCH_PATH_NOT_FOUND")
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &'static str) -> Response {
    ApiError::new(status, code).into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{Json, body::to_bytes, extract::State, http::StatusCode, response::Response};
    use serde_json::Value;
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        CreateRequest, UpdateRequest, create, ensure, ensure_item, list, list_items, remove,
        update, validate_alias,
    };
    use crate::state::{AppState, OpenCodeHistoryPool};

    async fn pool() -> sqlx::SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    async fn state() -> (tempfile::TempDir, Arc<AppState>) {
        let root = tempfile::tempdir().unwrap();
        let pool = pool().await;
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            root.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(root.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        (root, state)
    }

    async fn response_json(response: Response) -> Value {
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
    }

    #[test]
    fn validates_requests_and_aliases() {
        assert_eq!(
            validate_alias(Some("  label  ".into())).unwrap(),
            Some("label".into())
        );
        assert_eq!(validate_alias(Some("  ".into())).unwrap(), None);
        assert!(validate_alias(Some("x".repeat(121))).is_err());
        assert!(serde_json::from_str::<CreateRequest>(r#"{"path":"/tmp","extra":1}"#).is_err());
    }

    #[tokio::test]
    async fn handlers_use_unified_response_shapes_and_delete_status() {
        let (root, state) = state().await;
        let response = create(
            State(state.clone()),
            Json(CreateRequest {
                path: root.path().to_string_lossy().into_owned(),
                alias: Some("Root".into()),
                pinned: true,
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let created = response_json(response).await;
        assert!(created.get("launchPath").is_some());
        assert!(created.get("agentLaunchPath").is_none());
        let id = created["launchPath"]["id"].as_str().unwrap().to_string();

        let response = list(State(state.clone())).await;
        assert_eq!(response.status(), StatusCode::OK);
        let listed = response_json(response).await;
        assert_eq!(listed["launchPaths"].as_array().unwrap().len(), 1);

        let response = update(
            State(state.clone()),
            axum::extract::Path(id.clone()),
            Json(UpdateRequest {
                alias: Some(Some("Renamed".into())),
                pinned: Some(false),
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let updated = response_json(response).await;
        assert_eq!(updated["launchPath"]["alias"], "Renamed");
        assert_eq!(updated["launchPath"]["pinned"], false);

        let response = remove(State(state), axum::extract::Path(id)).await;
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
    }

    #[tokio::test]
    async fn creates_touches_pins_orders_and_deletes_paths() {
        let pool = pool().await;
        let first = ensure_item(&pool, "/first", Some("First"), false)
            .await
            .unwrap();
        let second = ensure_item(&pool, "/second", None, false).await.unwrap();
        let touched = ensure_item(&pool, "/first", None, true).await.unwrap();
        assert_eq!(first.id, touched.id);
        assert_eq!(touched.alias.as_deref(), Some("First"));
        assert!(!touched.pinned);
        sqlx::query("UPDATE launch_paths SET pinned = 1 WHERE id = ?")
            .bind(&second.id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(list_items(&pool).await.unwrap()[0].id, second.id);
        sqlx::query("DELETE FROM launch_paths WHERE id = ?")
            .bind(&first.id)
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(list_items(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn ensure_uses_the_callers_transaction() {
        let pool = pool().await;
        let mut transaction = pool.begin().await.unwrap();
        ensure(&mut transaction, "/rolled-back").await.unwrap();
        transaction.rollback().await.unwrap();
        assert!(list_items(&pool).await.unwrap().is_empty());

        let mut transaction = pool.begin().await.unwrap();
        ensure(&mut transaction, "/saved").await.unwrap();
        transaction.commit().await.unwrap();
        assert_eq!(list_items(&pool).await.unwrap()[0].path, "/saved");
    }

    #[tokio::test]
    async fn baseline_has_only_the_unified_launch_path_schema() {
        let pool = pool().await;
        let index_sql: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'launch_paths_order'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(index_sql.contains("pinned DESC, last_used_at DESC, path COLLATE NOCASE"));
        sqlx::query("INSERT INTO launch_paths (id, path, pinned, last_used_at, created_at, updated_at) VALUES ('first', '/same', 0, 0, 0, 0)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("INSERT INTO launch_paths (id, path, pinned, last_used_at, created_at, updated_at) VALUES ('duplicate', '/same', 0, 0, 0, 0)")
                .execute(&pool)
                .await
                .is_err()
        );
        for table in [
            "terminal_launch_paths",
            "agent_launch_paths",
            "terminal_workspace_members",
            "terminal_workspaces",
            "agent_workspace_members",
            "agent_workspaces",
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
