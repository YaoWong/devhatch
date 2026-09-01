mod profiles;
mod repositories;
mod skills;
mod views;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use skillink::Error;

pub(crate) use profiles::{
    create_profile, disable_profile_skill, enable_profile_skill, list_profiles, profile_detail,
    replace_profile_skills,
};
pub(crate) use repositories::{
    create_repository, list_repositories, preview_repository_sync, remove_repository,
    repository_operation, sync_repository, update_repository,
};
pub(crate) use skills::{create_skill, import_skill, list_skills, remove_skill, skill_manifest};

pub(crate) fn operation_conflict() -> Response {
    (
        StatusCode::CONFLICT,
        Json(serde_json::json!({
            "error": "SKILL_REPOSITORY_OPERATION_IN_PROGRESS",
            "message": "a Skills repository operation is already in progress"
        })),
    )
        .into_response()
}

pub(crate) fn skillink_error(error: Error) -> Response {
    let (status, code) = match &error {
        Error::InvalidSlug(_)
        | Error::InvalidRepositoryName
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
