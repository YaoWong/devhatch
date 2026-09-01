use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::FromRow;
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
pub struct CreateRequest {
    #[serde(default)]
    agent_id: Option<serde_json::Value>,
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
    match list_items(state.pool()).await {
        Ok(paths) => Json(serde_json::json!({ "agentLaunchPaths": paths })).into_response(),
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    let _ = request.agent_id;
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
        path,
        alias,
        pinned: request.pinned,
        last_used_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
    };
    let result = save(state.pool(), &item).await;
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
        .bind(alias_supplied).bind(alias).bind(request.pinned).bind(now() as i64).bind(&id).execute(state.pool()).await;
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
        .execute(state.pool())
        .await
    {
        Ok(_) => get(&state, &id).await,
        Err(_) => error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    }
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match sqlx::query("DELETE FROM agent_launch_paths WHERE id = ?")
        .bind(id)
        .execute(state.pool())
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

async fn save(pool: &sqlx::SqlitePool, item: &LaunchPath) -> Result<LaunchPath, sqlx::Error> {
    sqlx::query_as::<_, LaunchPath>("INSERT INTO agent_launch_paths (id, path, alias, pinned, last_used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET last_used_at = excluded.last_used_at, updated_at = excluded.updated_at RETURNING id, path, alias, pinned, last_used_at, created_at, updated_at")
        .bind(&item.id)
        .bind(&item.path)
        .bind(&item.alias)
        .bind(item.pinned)
        .bind(item.last_used_at)
        .bind(item.created_at)
        .bind(item.updated_at)
        .fetch_one(pool)
        .await
}

async fn list_items(pool: &sqlx::SqlitePool) -> Result<Vec<LaunchPath>, sqlx::Error> {
    sqlx::query_as::<_, LaunchPath>("SELECT id, path, alias, pinned, last_used_at, created_at, updated_at FROM agent_launch_paths ORDER BY pinned DESC, last_used_at DESC, path COLLATE NOCASE")
        .fetch_all(pool)
        .await
}

async fn find(state: &AppState, id: &str) -> Result<Option<LaunchPath>, sqlx::Error> {
    sqlx::query_as::<_, LaunchPath>("SELECT id, path, alias, pinned, last_used_at, created_at, updated_at FROM agent_launch_paths WHERE id = ?")
        .bind(id).fetch_optional(state.pool()).await
}

pub(crate) async fn paths(state: &AppState) -> Result<Vec<std::path::PathBuf>, sqlx::Error> {
    sqlx::query_scalar::<_, String>("SELECT path FROM agent_launch_paths")
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
    error(StatusCode::NOT_FOUND, "AGENT_LAUNCH_PATH_NOT_FOUND")
}
fn error(status: StatusCode, code: &'static str) -> Response {
    ApiError::new(status, code).into_response()
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{CreateRequest, LaunchPath, list_items, save, validate_alias};

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
        assert_eq!(validate_alias(Some("  ".into())).unwrap(), None);
        assert!(validate_alias(Some("x".repeat(121))).is_err());
    }

    #[test]
    fn accepts_and_ignores_legacy_agent_id() {
        let missing: CreateRequest = serde_json::from_str(r#"{"path":"/tmp"}"#).unwrap();
        assert!(missing.agent_id.is_none());
        let legacy: CreateRequest =
            serde_json::from_str(r#"{"agentId":{"unsupported":true},"path":"/tmp"}"#).unwrap();
        assert!(legacy.agent_id.is_some());
        assert!(serde_json::from_str::<CreateRequest>(r#"{"path":"/tmp","extra":1}"#).is_err());
    }

    #[test]
    fn response_omits_agent_id() {
        let value = serde_json::to_value(LaunchPath {
            id: "id".into(),
            path: "/path".into(),
            alias: None,
            pinned: false,
            last_used_at: 1,
            created_at: 1,
            updated_at: 1,
        })
        .unwrap();
        assert!(value.get("agentId").is_none());
    }

    #[tokio::test]
    async fn path_conflict_is_global_and_listing_uses_global_order() {
        let pool = pool().await;
        let first = LaunchPath {
            id: "first".into(),
            path: "/same".into(),
            alias: Some("First".into()),
            pinned: true,
            last_used_at: 1,
            created_at: 1,
            updated_at: 1,
        };
        let mut duplicate = LaunchPath {
            id: "duplicate".into(),
            path: "/same".into(),
            alias: Some("Duplicate".into()),
            pinned: false,
            last_used_at: 2,
            created_at: 2,
            updated_at: 2,
        };
        let saved = save(&pool, &first).await.unwrap();
        let touched = save(&pool, &duplicate).await.unwrap();
        assert_eq!(touched.id, saved.id);
        assert_eq!(touched.alias, first.alias);
        assert!(touched.pinned);
        assert_eq!(touched.created_at, first.created_at);
        assert_eq!(touched.last_used_at, duplicate.last_used_at);

        duplicate.id = "other".into();
        duplicate.path = "/other".into();
        duplicate.last_used_at = 100;
        save(&pool, &duplicate).await.unwrap();
        let items = list_items(&pool).await.unwrap();
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["first", "other"]
        );
    }

    #[tokio::test]
    async fn fresh_baseline_has_final_agent_schema() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();

        let agent_id_columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('agent_launch_paths') WHERE name = 'agent_id'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(agent_id_columns, 0);
        let index_sql: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'agent_launch_paths_order'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(index_sql.contains("pinned DESC, last_used_at DESC, path COLLATE NOCASE"));
        sqlx::query("INSERT INTO agent_launch_paths (id, path, pinned, last_used_at, created_at, updated_at) VALUES ('first', '/same', 0, 0, 0, 0)")
            .execute(&pool)
            .await
            .unwrap();
        assert!(
            sqlx::query("INSERT INTO agent_launch_paths (id, path, pinned, last_used_at, created_at, updated_at) VALUES ('duplicate', '/same', 0, 0, 0, 0)")
                .execute(&pool)
                .await
                .is_err()
        );
        for table in ["agent_workspaces", "agent_workspace_members"] {
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
            )
            .bind(table)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(exists, 1, "missing {table}");
        }
        let workspace_index: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'agent_workspace_members_workspace'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(workspace_index, 1);
    }
}
