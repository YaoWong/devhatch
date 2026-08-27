use std::sync::Arc;

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::state::AppState;

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    Json(serde_json::json!({ "webApps": [state.web_apps().view().await] })).into_response()
}

pub async fn install(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().begin_install() {
        Ok(()) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "accepted": true })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
    }
}

pub async fn check_update(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().check_update().await {
        Ok(()) => {
            Json(serde_json::json!({ "webApp": state.web_apps().view().await })).into_response()
        }
        Err(message) if message == super::OPERATION_CONFLICT => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": super::OPERATION_CONFLICT, "message": message })),
        )
            .into_response(),
        Err(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "WEB_APP_UPDATE_CHECK_FAILED", "message": message })),
        )
            .into_response(),
    }
}

pub async fn update(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().begin_update() {
        Ok(()) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "accepted": true })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": error })),
        )
            .into_response(),
    }
}

pub async fn start(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().start().await {
        Ok(()) => {
            Json(serde_json::json!({ "webApp": state.web_apps().view().await })).into_response()
        }
        Err(message) if message == super::OPERATION_CONFLICT => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": super::OPERATION_CONFLICT, "message": message })),
        )
            .into_response(),
        Err(message) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "error": "WEB_APP_START_FAILED", "message": message })),
        )
            .into_response(),
    }
}

pub async fn stop(State(state): State<Arc<AppState>>) -> Response {
    match state.web_apps().stop().await {
        Ok(()) => {
            Json(serde_json::json!({ "webApp": state.web_apps().view().await })).into_response()
        }
        Err(message) if message == super::OPERATION_CONFLICT => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({ "error": super::OPERATION_CONFLICT, "message": message })),
        )
            .into_response(),
        Err(message) => {
            let status = if message.contains("manual cleanup is required") {
                StatusCode::CONFLICT
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            (
                status,
                Json(serde_json::json!({ "error": "WEB_APP_STOP_FAILED", "message": message })),
            )
                .into_response()
        }
    }
}
