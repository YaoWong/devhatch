use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, Path, State, WebSocketUpgrade, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::{
    history::PreparedLaunch,
    launch_config::{self},
    session::{SessionKind, socket},
    state::AppState,
    terminal::{CreateRequest, RenameRequest, error, invalid_cwd, remove_session},
};

use super::{
    kind::{AgentDefinition, AgentKind, OPENCODE_ID, definition},
    launch::{available, installed_version, spawn_codex, spawn_opencode, spawn_pi, spawn_traecli},
    runtime::reconcile::{start_codex_reconciler, start_fork_reconciler, start_history_reconciler},
};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentCreateRequest {
    #[serde(default = "default_agent_id")]
    agent_id: String,
    cwd: Option<serde_json::Value>,
    cols: Option<serde_json::Value>,
    rows: Option<serde_json::Value>,
    upstream_session_id: Option<String>,
    launch_config_id: Option<String>,
    skill_profile_id: Option<String>,
}

fn default_agent_id() -> String {
    OPENCODE_ID.to_string()
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
    let agents = futures_util::future::join_all(AgentKind::ALL.into_iter().map(|kind| {
        let state = state.clone();
        async move {
            let agent = definition(kind);
            let (version, summary) = tokio::join!(
                installed_version(agent.kind),
                launch_config::summary(&state, agent.kind.as_str())
            );
            let (count, default) = summary.unwrap_or((0, None));
            agent_view(agent, version, count, default)
        }
    }))
    .await;
    Json(serde_json::json!({ "agents": agents })).into_response()
}

fn agent_view(
    agent: AgentDefinition,
    version: Option<String>,
    launch_config_count: i64,
    default_launch_config_id: Option<String>,
) -> serde_json::Value {
    let kind = agent.kind;
    let id = kind.as_str();
    let available = version.is_some();
    serde_json::json!({
        "id": id,
        "name": kind.name(),
        "kind": id,
        "available": available,
        "version": version,
        "launchConfigCount": launch_config_count,
        "defaultLaunchConfigId": default_launch_config_id,
        "enabled": true,
        "availability": if available { "available" } else { "unavailable" },
        "diagnostic": if available { serde_json::Value::Null } else { serde_json::Value::String(kind.diagnostic().into()) },
        "supportsHistory": true,
        "supportsResume": agent.supports_resume,
        "supportsSkills": agent.supports_skills
    })
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
    let kind = match AgentKind::try_from(request.agent_id.as_str()) {
        Ok(kind) => kind,
        Err(()) => return error(StatusCode::BAD_REQUEST, "INVALID_AGENT_ID"),
    };
    let agent = definition(kind);
    if request.skill_profile_id.is_some() && !agent.supports_skills {
        return error(StatusCode::BAD_REQUEST, "AGENT_SKILLS_UNSUPPORTED");
    }
    if !available(kind) {
        return error(StatusCode::SERVICE_UNAVAILABLE, "AGENT_UNAVAILABLE");
    }
    let launch_config =
        match launch_config::resolve(&state, kind.as_str(), request.launch_config_id.as_deref())
            .await
        {
            Ok(Some(config)) => config,
            Ok(None) => return error(StatusCode::NOT_FOUND, "AGENT_LAUNCH_CONFIG_NOT_FOUND"),
            Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
        };
    let skill_generation = if let Some(profile_id) = request.skill_profile_id.as_deref() {
        match state.skillink().apply_profile(profile_id).await {
            Ok(generation) => Some(generation),
            Err(error) => return crate::skillink::skillink_error(error),
        }
    } else {
        None
    };
    let backend = kind.history_backend();
    let history_guard_state = state.clone();
    let _history_guard = history_guard_state.history_reconciliation().lock().await;
    let mut terminal_request = request.terminal_request();
    let prepared = match backend
        .prepare(&state, request.upstream_session_id.as_deref())
        .await
    {
        Ok(prepared) => prepared,
        Err(history_error) => {
            return crate::history::prepare_error_response(kind, history_error);
        }
    };
    match prepared {
        PreparedLaunch::CodexNew { home, baseline } => {
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            let session = match spawn_codex(
                state.clone(),
                terminal_request,
                home.clone(),
                None,
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            start_codex_reconciler(&session, state, home, baseline);
            created_session(Ok(session))
        }
        PreparedLaunch::CodexResume {
            home,
            id,
            path,
            cwd,
        } => {
            terminal_request.cwd = Some(serde_json::Value::String(
                cwd.to_string_lossy().into_owned(),
            ));
            let session = match spawn_codex(
                state,
                terminal_request,
                home,
                Some((id, path)),
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            created_session(Ok(session))
        }
        PreparedLaunch::TraeNew { id } => {
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            created_session(spawn_traecli(
                state,
                terminal_request,
                id,
                None,
                launch_config,
                skill_generation.as_deref(),
            ))
        }
        PreparedLaunch::TraeResume { id, path, cwd } => {
            terminal_request.cwd = Some(serde_json::Value::String(
                cwd.to_string_lossy().into_owned(),
            ));
            created_session(spawn_traecli(
                state,
                terminal_request,
                id,
                Some(&path),
                launch_config,
                skill_generation.as_deref(),
            ))
        }
        PreparedLaunch::PiNew { id } => {
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            created_session(spawn_pi(
                state,
                terminal_request,
                id,
                None,
                launch_config,
                skill_generation.as_deref(),
            ))
        }
        PreparedLaunch::PiResume { id, path, cwd } => {
            terminal_request.cwd = Some(serde_json::Value::String(
                cwd.to_string_lossy().into_owned(),
            ));
            created_session(spawn_pi(
                state,
                terminal_request,
                id,
                Some(&path),
                launch_config,
                skill_generation.as_deref(),
            ))
        }
        PreparedLaunch::OpenCodeNew { baseline } => {
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            let session = match spawn_opencode(
                state.clone(),
                terminal_request,
                None,
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            start_history_reconciler(&session, state.clone(), baseline);
            start_fork_reconciler(&session, state);
            created_session(Ok(session))
        }
        PreparedLaunch::OpenCodeResume { id, cwd } => {
            terminal_request.cwd = Some(serde_json::Value::String(cwd));
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            let session = match spawn_opencode(
                state.clone(),
                terminal_request,
                Some(id),
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            start_fork_reconciler(&session, state);
            created_session(Ok(session))
        }
    }
}

fn spawn_error(error: Box<dyn std::error::Error>) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
            "error": "AGENT_SPAWN_FAILED",
            "message": error.to_string()
        })),
    )
        .into_response()
}

fn created_session(
    result: Result<Arc<crate::session::Session>, Box<dyn std::error::Error>>,
) -> Response {
    match result {
        Ok(session) => (
            StatusCode::CREATED,
            Json(serde_json::json!({ "agentSession": session.view() })),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "AGENT_SPAWN_FAILED",
                "message": error.to_string()
            })),
        )
            .into_response(),
    }
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
    Extension(identity): Extension<crate::auth::AuthIdentity>,
    upgrade: WebSocketUpgrade,
) -> Response {
    socket::upgrade(state, id, identity, upgrade, SessionKind::Agent)
}
