use std::{path::PathBuf, sync::Arc};

use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use skillink::{
    Error, Profile, ProfileDetail, Repository, Skill, SyncItem, SyncPlan, repository_name,
};

use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryView {
    id: String,
    name: String,
    url: String,
    git_ref: Option<String>,
    commit_hash: String,
    sync_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillView {
    id: String,
    slug: String,
    description: String,
    source_type: String,
    repository_id: Option<String>,
    revision: Option<String>,
    relative_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileView {
    id: String,
    slug: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileDetailView {
    profile: ProfileView,
    skills: Vec<SkillView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncItemView {
    id: Option<String>,
    slug: String,
    relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncPlanView {
    repository_id: String,
    old_commit: Option<String>,
    new_commit: String,
    noop: bool,
    add: Vec<SyncItemView>,
    update: Vec<SyncItemView>,
    remove: Vec<SyncItemView>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRepositoryRequest {
    url: String,
    git_ref: Option<String>,
}

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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateProfileRequest {
    slug: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReplaceProfileSkillsRequest {
    skill_ids: Vec<String>,
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
    match state
        .skillink()
        .import_skill(&request.source, request.slug.as_deref())
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

impl From<Repository> for RepositoryView {
    fn from(value: Repository) -> Self {
        let name = repository_name(&value.url);
        Self {
            id: value.id,
            name,
            url: value.url,
            git_ref: value.git_ref,
            commit_hash: value.commit_hash,
            sync_version: value.sync_version,
        }
    }
}

impl From<Skill> for SkillView {
    fn from(value: Skill) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
            description: value.description,
            source_type: value.source_type,
            repository_id: value.repository_id,
            revision: value.revision,
            relative_path: value.relative_path,
        }
    }
}

impl From<Profile> for ProfileView {
    fn from(value: Profile) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
        }
    }
}

impl From<ProfileDetail> for ProfileDetailView {
    fn from(value: ProfileDetail) -> Self {
        Self {
            profile: value.profile.into(),
            skills: value.skills.into_iter().map(SkillView::from).collect(),
        }
    }
}

impl From<SyncItem> for SyncItemView {
    fn from(value: SyncItem) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
            relative_path: value.relative_path,
        }
    }
}

impl From<SyncPlan> for SyncPlanView {
    fn from(value: SyncPlan) -> Self {
        Self {
            repository_id: value.repository_id,
            old_commit: value.old_commit,
            new_commit: value.new_commit,
            noop: value.noop,
            add: value.add.into_iter().map(SyncItemView::from).collect(),
            update: value.update.into_iter().map(SyncItemView::from).collect(),
            remove: value.remove.into_iter().map(SyncItemView::from).collect(),
        }
    }
}

pub(crate) fn skillink_error(error: Error) -> Response {
    let (status, code) = match &error {
        Error::InvalidSlug(_)
        | Error::InvalidRepositoryUrl
        | Error::Manifest { .. }
        | Error::UnsafeEntry(_)
        | Error::MissingManifest
        | Error::Url(_) => (StatusCode::BAD_REQUEST, "SKILLINK_INVALID_REQUEST"),
        Error::NotFound(_) => (StatusCode::NOT_FOUND, "SKILLINK_NOT_FOUND"),
        Error::Conflict(_)
        | Error::DuplicateRepositorySlug { .. }
        | Error::SkillConflict { .. }
        | Error::RepositorySkillInUse { .. }
        | Error::ConcurrentSync { .. } => (StatusCode::CONFLICT, "SKILLINK_CONFLICT"),
        Error::Git(_) => (StatusCode::BAD_GATEWAY, "SKILLINK_GIT_ERROR"),
        Error::Unsupported(_) => (StatusCode::NOT_IMPLEMENTED, "SKILLINK_UNSUPPORTED"),
        Error::Database(database)
            if database
                .as_database_error()
                .is_some_and(|database| database.is_unique_violation()) =>
        {
            (StatusCode::CONFLICT, "SKILLINK_CONFLICT")
        }
        Error::Io(_) | Error::Database(_) | Error::Migration(_) | Error::Walk(_) => {
            (StatusCode::INTERNAL_SERVER_ERROR, "SKILLINK_ERROR")
        }
    };
    (
        status,
        Json(serde_json::json!({
            "error": code,
            "message": error.to_string()
        })),
    )
        .into_response()
}

fn invalid_request() -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(serde_json::json!({
            "error": "INVALID_REQUEST",
            "message": "invalid request body"
        })),
    )
        .into_response()
}
