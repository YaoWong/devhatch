mod events;
mod launch;
mod launch_workspace;
mod reconcile;

use std::{collections::HashSet, sync::Arc};

use axum::{
    Json,
    extract::{Path, State, WebSocketUpgrade, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::{
    launch_config::{self},
    session::SessionKind,
    session_socket,
    state::AppState,
    terminal::{CreateRequest, RenameRequest, error, invalid_cwd, remove_session},
};

use launch::{available, installed_version, spawn};
use reconcile::{start_fork_reconciler, start_history_reconciler};

pub(crate) const ID: &str = "opencode";
pub(crate) const NAME: &str = "OpenCode";

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentCreateRequest {
    cwd: Option<serde_json::Value>,
    cols: Option<serde_json::Value>,
    rows: Option<serde_json::Value>,
    upstream_session_id: Option<String>,
    launch_config_id: Option<String>,
    skill_profile_id: Option<String>,
}

impl AgentCreateRequest {
    fn terminal_request(&self) -> CreateRequest {
        CreateRequest {
            cwd: self.cwd.clone(),
            cols: self.cols.clone(),
            rows: self.rows.clone(),
        }
    }
}

pub async fn agents(State(state): State<Arc<AppState>>) -> Response {
    let version = installed_version().await;
    let available = version.is_some();
    let (launch_config_count, default_launch_config_id) =
        launch_config::summary(&state).await.unwrap_or((0, None));
    Json(serde_json::json!({
        "agents": [{
            "id": ID,
            "name": NAME,
            "kind": "opencode",
            "available": available,
            "version": version,
            "launchConfigCount": launch_config_count,
            "defaultLaunchConfigId": default_launch_config_id,
            "enabled": true,
            "availability": if available { "available" } else { "unavailable" },
            "diagnostic": if available { serde_json::Value::Null } else { serde_json::Value::String("OPENCODE_NOT_FOUND".into()) }
        }, {
            "id": "codex",
            "name": "Codex",
            "kind": "codex",
            "available": false,
            "enabled": false,
            "availability": "coming-soon",
            "launchConfigCount": 0,
            "defaultLaunchConfigId": serde_json::Value::Null
        }]
    }))
    .into_response()
}

pub async fn list(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let sessions = state.session_views(SessionKind::Agent);
    Json(serde_json::json!({ "agentSessions": sessions }))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    request: Result<Json<AgentCreateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return error(StatusCode::BAD_REQUEST, "INVALID_REQUEST"),
    };
    if !available() {
        return error(StatusCode::SERVICE_UNAVAILABLE, "AGENT_UNAVAILABLE");
    }
    let launch_config =
        match launch_config::resolve(&state, request.launch_config_id.as_deref()).await {
            Ok(Some(config)) => config,
            Ok(None) => return error(StatusCode::NOT_FOUND, "AGENT_LAUNCH_CONFIG_NOT_FOUND"),
            Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
        };
    let is_new_session = request.upstream_session_id.is_none();
    let baseline_session_ids = if is_new_session {
        crate::history::root_session_ids(state.history_pool())
            .await
            .unwrap_or_default()
    } else {
        HashSet::new()
    };
    let mut terminal_request = request.terminal_request();
    let upstream_session_id = if let Some(id) = request.upstream_session_id.as_deref() {
        if !events::valid_upstream_session_id(id) {
            return error(StatusCode::BAD_REQUEST, "INVALID_UPSTREAM_SESSION_ID");
        }
        match crate::history::resumable_session(state.history_pool(), id).await {
            Ok(Some(directory)) => {
                terminal_request.cwd = Some(serde_json::Value::String(directory));
                Some(id.to_string())
            }
            Ok(None) => return error(StatusCode::NOT_FOUND, "UPSTREAM_SESSION_NOT_FOUND"),
            Err(_) => {
                return error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "OPENCODE_HISTORY_UNAVAILABLE",
                );
            }
        }
    } else {
        None
    };
    if invalid_cwd(terminal_request.cwd.as_ref()) {
        return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
    }
    let skill_generation = if let Some(profile_id) = request.skill_profile_id.as_deref() {
        match state.skillink().apply_profile(profile_id).await {
            Ok(generation) => Some(generation),
            Err(error) => return crate::skillink::skillink_error(error),
        }
    } else {
        None
    };
    let session = match spawn(
        state.clone(),
        terminal_request,
        upstream_session_id,
        launch_config,
        skill_generation.as_deref(),
    ) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "AGENT_SPAWN_FAILED",
                    "message": error.to_string()
                })),
            )
                .into_response();
        }
    };
    if is_new_session {
        start_history_reconciler(&session, state.clone(), baseline_session_ids);
    }
    start_fork_reconciler(&session, state);
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "agentSession": session.view() })),
    )
        .into_response()
}

pub async fn rename(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<RenameRequest>,
) -> Response {
    let Some(session) = state.session(&id, SessionKind::Agent) else {
        return error(StatusCode::NOT_FOUND, "AGENT_SESSION_NOT_FOUND");
    };
    let name = request
        .name
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if name.is_empty() || name.encode_utf16().count() > 120 {
        return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_SESSION_NAME");
    }
    session.rename(name.to_string());
    Json(serde_json::json!({ "agentSession": session.view() })).into_response()
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    remove_session(&state, &id, SessionKind::Agent, "AGENT_SESSION_NOT_FOUND")
}

pub async fn socket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    session_socket::upgrade(state, id, headers, upgrade, SessionKind::Agent)
}
