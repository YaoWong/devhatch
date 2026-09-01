use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::{
    invalid_request, operation_conflict, skillink_error, views::RepositoryView, views::SyncPlanView,
};
use crate::state::{AppState, SkillRepositoryOperationKind};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRepositoryRequest {
    url: String,
    git_ref: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRepositoryRequest {
    name: String,
}

pub(crate) async fn repository_operation(State(state): State<Arc<AppState>>) -> Response {
    Json(state.skill_repository_operations().current()).into_response()
}

pub(crate) async fn list_repositories(State(state): State<Arc<AppState>>) -> Response {
    match state.skillink().list_repositories().await {
        Ok(repositories) => Json(serde_json::json!({
            "skillRepositories": repositories.into_iter().map(RepositoryView::from).collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn create_repository(
    State(state): State<Arc<AppState>>,
    request: Result<Json<CreateRepositoryRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    let Some(operation) = state
        .skill_repository_operations()
        .begin(SkillRepositoryOperationKind::Add, None)
    else {
        return operation_conflict();
    };
    match state
        .skillink()
        .add_repository_with_progress(
            &request.url,
            request.git_ref.as_deref(),
            operation.reporter(),
        )
        .await
    {
        Ok(repository) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "skillRepository": RepositoryView::from(repository) })),
        )
            .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn update_repository(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    request: Result<Json<UpdateRepositoryRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    match state.skillink().rename_repository(&id, &request.name).await {
        Ok(repository) => Json(serde_json::json!({
            "skillRepository": RepositoryView::from(repository)
        }))
        .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn remove_repository(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    let Some(_deletion) = state
        .skill_repository_operations()
        .begin_deletion(Some(id.clone()))
    else {
        return operation_conflict();
    };
    match state.skillink().remove_repository(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn preview_repository_sync(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    let Some(operation) = state
        .skill_repository_operations()
        .begin(SkillRepositoryOperationKind::Preview, Some(id.clone()))
    else {
        return operation_conflict();
    };
    match state
        .skillink()
        .preview_repository_sync_with_progress(&id, operation.reporter())
        .await
    {
        Ok(plan) => {
            Json(serde_json::json!({ "syncPlan": SyncPlanView::from(plan) })).into_response()
        }
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn sync_repository(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    let Some(operation) = state
        .skill_repository_operations()
        .begin(SkillRepositoryOperationKind::Sync, Some(id.clone()))
    else {
        return operation_conflict();
    };
    match state
        .skillink()
        .sync_repository_with_progress(&id, operation.reporter())
        .await
    {
        Ok(result) => {
            Json(serde_json::json!({ "syncResult": SyncPlanView::from(result) })).into_response()
        }
        Err(error) => skillink_error(error),
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, extract::State, http::StatusCode};
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;
    use crate::state::OpenCodeHistoryPool;

    async fn state() -> Arc<AppState> {
        let root = tempfile::tempdir().unwrap().keep();
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.join("skillink")))
            .await
            .unwrap();
        Arc::new(AppState::new(
            root.clone(),
            pool,
            OpenCodeHistoryPool::new(root.join("history.db")),
            skillink,
            None,
            false,
        ))
    }

    #[tokio::test]
    async fn operation_response_includes_revision() {
        let response = repository_operation(State(state().await)).await;
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({ "operation": null, "revision": 0 })
        );
    }

    #[tokio::test]
    async fn repository_delete_rejects_conflicting_operation() {
        let state = state().await;
        let _operation = state
            .skill_repository_operations()
            .begin(SkillRepositoryOperationKind::Sync, Some("repo".into()))
            .unwrap();
        let response = remove_repository(State(state), Path("repo".into())).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
            "SKILL_REPOSITORY_OPERATION_IN_PROGRESS"
        );
    }
}
