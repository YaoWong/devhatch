use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use super::{
    invalid_request, skillink_error,
    views::{ProfileDetailView, ProfileView},
};
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateProfileRequest {
    slug: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateProfileRequest {
    slug: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReplaceProfileSkillsRequest {
    skill_ids: Vec<String>,
}

pub(crate) async fn list_profiles(State(state): State<Arc<AppState>>) -> Response {
    match state.skillink().list_profiles().await {
        Ok(profiles) => Json(serde_json::json!({
            "skillProfiles": profiles.into_iter().map(ProfileView::from).collect::<Vec<_>>()
        }))
        .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn create_profile(
    State(state): State<Arc<AppState>>,
    request: Result<Json<CreateProfileRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    match state.skillink().create_profile(&request.slug).await {
        Ok(profile) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "skillProfile": ProfileView::from(profile) })),
        )
            .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn update_profile(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    request: Result<Json<UpdateProfileRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    match state.skillink().rename_profile(&id, &request.slug).await {
        Ok(profile) => Json(serde_json::json!({
            "skillProfile": ProfileView::from(profile)
        }))
        .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn profile_detail(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Response {
    match state.skillink().show_profile(&id).await {
        Ok(profile) => Json(serde_json::json!({
            "skillProfileDetail": ProfileDetailView::from(profile)
        }))
        .into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn replace_profile_skills(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    request: Result<Json<ReplaceProfileSkillsRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return invalid_request(),
    };
    match state
        .skillink()
        .replace_profile_skills(&id, &request.skill_ids)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn enable_profile_skill(
    State(state): State<Arc<AppState>>,
    Path((profile_id, skill_id)): Path<(String, String)>,
) -> Response {
    match state.skillink().enable_skill(&profile_id, &skill_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => skillink_error(error),
    }
}

pub(crate) async fn disable_profile_skill(
    State(state): State<Arc<AppState>>,
    Path((profile_id, skill_id)): Path<(String, String)>,
) -> Response {
    match state.skillink().disable_skill(&profile_id, &skill_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => skillink_error(error),
    }
}
