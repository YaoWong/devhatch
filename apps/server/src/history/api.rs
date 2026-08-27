use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{agent::AgentKind, state::AppState};

use super::{DeleteError, HistoryError};

pub async fn list(State(state): State<Arc<AppState>>, Path(agent_id): Path<String>) -> Response {
    let kind = match AgentKind::try_from(agent_id.as_str()) {
        Ok(kind) => kind,
        Err(()) => return error(StatusCode::BAD_REQUEST, "AGENT_HISTORY_UNSUPPORTED"),
    };
    match kind.history_backend().items(&state).await {
        Ok(sessions) => {
            Json(serde_json::json!({ "available": true, "diagnostic": null, "sessions": sessions }))
                .into_response()
        }
        Err(diagnostic) => Json(
            serde_json::json!({ "available": false, "diagnostic": diagnostic, "sessions": [] }),
        )
        .into_response(),
    }
}

pub async fn remove(
    State(state): State<Arc<AppState>>,
    Path((agent_id, id)): Path<(String, String)>,
) -> Response {
    let kind = match AgentKind::try_from(agent_id.as_str()) {
        Ok(kind) => kind,
        Err(()) => return error(StatusCode::BAD_REQUEST, "AGENT_HISTORY_UNSUPPORTED"),
    };
    let agent_id = kind.as_str();
    let coordinator = state.history_coordinator();
    let deletion;
    {
        let _history_guard = coordinator.lock().lock().await;
        if state
            .active_upstream_session_ids_for(agent_id)
            .contains(&id)
        {
            return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
        }
        let Some(guard) = coordinator.begin(agent_id, &id) else {
            return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
        };
        deletion = guard;
    }
    let result = kind.history_backend().delete(&state, id).await;
    drop(deletion);
    match result {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(DeleteError::History(error_kind)) => history_error_response(kind, error_kind),
        Err(DeleteError::Failed {
            status,
            code,
            message,
        }) => match message {
            Some(message) => (
                status,
                Json(serde_json::json!({ "error": code, "message": message })),
            )
                .into_response(),
            None => error(status, code),
        },
    }
}

pub(crate) fn prepare_error_response(kind: AgentKind, value: HistoryError) -> Response {
    history_error_response(kind, value)
}

fn history_error_response(kind: AgentKind, value: HistoryError) -> Response {
    match value {
        HistoryError::InvalidId => error(StatusCode::BAD_REQUEST, "INVALID_UPSTREAM_SESSION_ID"),
        HistoryError::NotFound => error(StatusCode::NOT_FOUND, "UPSTREAM_SESSION_NOT_FOUND"),
        HistoryError::InvalidCwd => error(StatusCode::BAD_REQUEST, "INVALID_CWD"),
        HistoryError::Active => error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE"),
        HistoryError::ExternalActive => error(
            StatusCode::CONFLICT,
            "UPSTREAM_SESSION_POSSIBLY_ACTIVE_ELSEWHERE",
        ),
        HistoryError::Ambiguous => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "PI_HISTORY_SESSION_AMBIGUOUS",
        ),
        HistoryError::Unavailable => error(
            StatusCode::SERVICE_UNAVAILABLE,
            match kind {
                AgentKind::Codex => "CODEX_HISTORY_UNAVAILABLE",
                AgentKind::OpenCode => "OPENCODE_HISTORY_UNAVAILABLE",
                AgentKind::Pi => "PI_HISTORY_UNAVAILABLE",
                AgentKind::TraeCli => "TRAE_HISTORY_UNAVAILABLE",
            },
        ),
    }
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}
