use std::{path::PathBuf, sync::Arc};

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::{invalid_request, operation_conflict, skillink_error, views::SkillView};
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateSkillRequest {
    slug: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportSkillRequest {
    source: PathBuf,
    slug: Option<String>,
}

pub(crate) async fn list_skills(State(state): State<Arc<AppState>>) -> Response {
    match state.skillink().list_skills().await {
        Ok(skills) => Json(serde_json::json!({
            "skills": skills.into_iter().map(SkillView::from).collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn create_skill(
    State(state): State<Arc<AppState>>,
    request: Result<Json<CreateSkillRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    match state
        .skillink()
        .create_skill(&request.slug, &request.description)
        .await
    {
        Ok(skill) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "skill": SkillView::from(skill) })),
        )
            .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn import_skill(
    State(state): State<Arc<AppState>>,
    request: Result<Json<ImportSkillRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    let source = match crate::filesystem::validated_import_directory(&request.source) {
        Ok(source) => source,
        Err(_) => return invalid_request(),
    };
    match state
        .skillink()
        .import_skill(&source, request.slug.as_deref())
        .await
    {
        Ok(skill) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "skill": SkillView::from(skill) })),
        )
            .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn remove_skill(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    let repository_id = match state.skillink().skill_repository_id(&id).await {
        Ok(repository_id) => repository_id,
        Err(error) => return skillink_error(error),
    };
    if let Some(repository_id) = repository_id {
        let Some(_deletion) = state
            .skill_repository_operations()
            .begin_deletion(Some(repository_id))
        else {
            return operation_conflict();
        };
        return match state.skillink().remove_skill(&id).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => skillink_error(error),
        };
    }
    match state.skillink().remove_skill(&id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn skill_manifest(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.skillink().read_skill_manifest(&id).await {
        Ok(content) => Json(serde_json::json!({ "content": content })).into_response(),
        Err(error) => skillink_error(error),
    }
}
