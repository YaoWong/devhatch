use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::{invalid_request, skillink_error, views::RepositoryView, views::SyncPlanView};
use crate::state::AppState;

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
    match state
        .skillink()
        .add_repository(&request.url, request.git_ref.as_deref())
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
    match state.skillink().remove_repository(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn preview_repository_sync(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.skillink().preview_repository_sync(&id).await {
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
    match state.skillink().sync_repository(&id).await {
        Ok(result) => {
            Json(serde_json::json!({ "syncResult": SyncPlanView::from(result) })).into_response()
        }
        Err(error) => skillink_error(error),
    }
}
