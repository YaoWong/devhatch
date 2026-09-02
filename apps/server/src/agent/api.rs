use std::sync::Arc;

use axum::{
    Json,
    body::Bytes,
    extract::{Extension, Path, State, WebSocketUpgrade, rejection::JsonRejection},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

use crate::{
    agent_workspace,
    history::PreparedLaunch,
    launch_config::{self},
    session::{SessionKind, socket},
    state::AppState,
    terminal::{CreateRequest, RenameRequest, error, invalid_cwd},
};

use super::{
    kind::{AgentDefinition, AgentKind, OPENCODE_ID, definition},
    launch::{available, installed_version, spawn_codex, spawn_opencode, spawn_pi, spawn_traecli},
    runtime::reconcile::{start_codex_reconciler, start_fork_reconciler, start_history_reconciler},
    runtime_input::{PasteImageError, paste_image as paste_runtime_image},
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
    workspace_id: Option<String>,
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
            workspace_id: None,
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
    let workspace_id = request.workspace_id.clone();
    let _workspace_lifecycle = state.agent_workspace_lifecycle().lock().await;
    if let Some(workspace_id) = workspace_id.as_deref() {
        match agent_workspace::exists(state.pool(), workspace_id).await {
            Ok(true) => {}
            Ok(false) => return error(StatusCode::NOT_FOUND, "AGENT_WORKSPACE_NOT_FOUND"),
            Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
        }
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
            start_codex_reconciler(&session, state.clone(), home, baseline);
            created_session(&state, workspace_id.as_deref(), session).await
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
                state.clone(),
                terminal_request,
                home,
                Some((id, path)),
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            created_session(&state, workspace_id.as_deref(), session).await
        }
        PreparedLaunch::TraeNew { id } => {
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            let session = match spawn_traecli(
                state.clone(),
                terminal_request,
                id,
                None,
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            created_session(&state, workspace_id.as_deref(), session).await
        }
        PreparedLaunch::TraeResume { id, path, cwd } => {
            terminal_request.cwd = Some(serde_json::Value::String(
                cwd.to_string_lossy().into_owned(),
            ));
            let session = match spawn_traecli(
                state.clone(),
                terminal_request,
                id,
                Some(&path),
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            created_session(&state, workspace_id.as_deref(), session).await
        }
        PreparedLaunch::PiNew { id } => {
            if invalid_cwd(terminal_request.cwd.as_ref()) {
                return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
            }
            let session = match spawn_pi(
                state.clone(),
                terminal_request,
                id,
                None,
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            created_session(&state, workspace_id.as_deref(), session).await
        }
        PreparedLaunch::PiResume { id, path, cwd } => {
            terminal_request.cwd = Some(serde_json::Value::String(
                cwd.to_string_lossy().into_owned(),
            ));
            let session = match spawn_pi(
                state.clone(),
                terminal_request,
                id,
                Some(&path),
                launch_config,
                skill_generation.as_deref(),
            ) {
                Ok(session) => session,
                Err(error) => return spawn_error(error),
            };
            created_session(&state, workspace_id.as_deref(), session).await
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
            start_fork_reconciler(&session, state.clone());
            created_session(&state, workspace_id.as_deref(), session).await
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
            start_fork_reconciler(&session, state.clone());
            created_session(&state, workspace_id.as_deref(), session).await
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

async fn created_session(
    state: &Arc<AppState>,
    workspace_id: Option<&str>,
    session: Arc<crate::session::Session>,
) -> Response {
    let Some(live) = state.live_agent_ids_if_contains(&session) else {
        cleanup_failed_spawn(state, &session).await;
        return error(StatusCode::SERVICE_UNAVAILABLE, "AGENT_SESSION_NOT_LIVE");
    };
    match agent_workspace::reconcile_and_attach_agent_session(
        state.pool(),
        &live,
        workspace_id,
        session.id(),
    )
    .await
    {
        Ok(Some(workspace)) => (
            StatusCode::CREATED,
            Json(serde_json::json!({
                "agentSession": session.view(),
                "agentWorkspace": workspace
            })),
        )
            .into_response(),
        Ok(None) => {
            cleanup_failed_spawn(state, &session).await;
            if workspace_id.is_some() {
                error(StatusCode::NOT_FOUND, "AGENT_WORKSPACE_NOT_FOUND")
            } else {
                error(StatusCode::INTERNAL_SERVER_ERROR, "AGENT_SPAWN_FAILED")
            }
        }
        Err(_) => {
            cleanup_failed_spawn(state, &session).await;
            error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
        }
    }
}

async fn cleanup_failed_spawn(state: &AppState, session: &Arc<crate::session::Session>) {
    state.remove_session(session.id(), SessionKind::Agent);
    session.mark_deleting();
    let _ = agent_workspace::remove_agent_session(state.pool(), session.id()).await;
    session.terminate();
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
    let _lifecycle = state.agent_workspace_lifecycle().lock().await;
    let Some(session) = state.session(&id, SessionKind::Agent) else {
        return error(StatusCode::NOT_FOUND, "AGENT_SESSION_NOT_FOUND");
    };
    match agent_workspace::remove_agent_session(state.pool(), &id).await {
        Ok(_) => {}
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    };
    let Some(removed) = state.remove_session(&id, SessionKind::Agent) else {
        return error(StatusCode::NOT_FOUND, "AGENT_SESSION_NOT_FOUND");
    };
    if !Arc::ptr_eq(&session, &removed) {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "SESSION_REGISTRY_ERROR");
    }
    removed.mark_deleting();
    removed.terminate();
    StatusCode::NO_CONTENT.into_response()
}

pub async fn paste_image(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(session) = state.session(&id, SessionKind::Agent) else {
        return error(StatusCode::NOT_FOUND, "AGENT_SESSION_NOT_FOUND");
    };
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(1))
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        Ok(client) => client,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "HTTP_CLIENT_ERROR"),
    };
    match paste_runtime_image(&client, &session, content_type, &body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(PasteImageError::Unsupported) => {
            error(StatusCode::CONFLICT, "AGENT_IMAGE_PASTE_UNSUPPORTED")
        }
        Err(PasteImageError::UnsupportedMediaType) => {
            error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_IMAGE_TYPE")
        }
        Err(PasteImageError::InvalidImage) => {
            error(StatusCode::UNPROCESSABLE_ENTITY, "INVALID_IMAGE")
        }
        Err(PasteImageError::Busy) => error(StatusCode::TOO_MANY_REQUESTS, "IMAGE_PASTE_BUSY"),
        Err(PasteImageError::Unavailable) => error(StatusCode::CONFLICT, "AGENT_SESSION_NOT_LIVE"),
    }
}

pub async fn socket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(identity): Extension<crate::auth::AuthIdentity>,
    upgrade: WebSocketUpgrade,
) -> Response {
    socket::upgrade(state, id, identity, upgrade, SessionKind::Agent)
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use portable_pty::CommandBuilder;
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{created_session, remove};
    use crate::{
        session::{Session, SessionEvent, SessionKind, SessionSpawn},
        state::{AppState, OpenCodeHistoryPool},
    };

    async fn state() -> (tempfile::TempDir, Arc<AppState>) {
        let temp = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(temp.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            temp.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(temp.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        (temp, state)
    }

    fn spawn_session(state: &Arc<AppState>, cwd: &std::path::Path) -> Arc<Session> {
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        Session::spawn(
            state.session_registry(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Agent,
                upstream_session_id: None,
                cwd: cwd.to_owned(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: Some("test"),
                agent_name: Some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: Some(state.agent_exit_cleanup()),
            },
            |_| {},
        )
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn successful_delete_returns_no_content() {
        let (temp, state) = state().await;
        let session = spawn_session(&state, temp.path());
        let response = remove(
            axum::extract::State(state.clone()),
            axum::extract::Path(session.id().to_string()),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::NO_CONTENT);
        tokio::time::timeout(Duration::from_secs(5), session.wait_for_completion())
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn fast_exit_is_rejected_and_cannot_be_attached() {
        let temp = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(temp.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            temp.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(temp.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        let lifecycle = state.agent_workspace_lifecycle().lock().await;
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "read _; exit 0"]);
        let session = Session::spawn(
            state.session_registry(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Agent,
                upstream_session_id: None,
                cwd: temp.path().to_owned(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: Some("test"),
                agent_name: Some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: Some(state.agent_exit_cleanup()),
            },
            |_| {},
        )
        .unwrap();
        let mut events = session.subscribe();
        sqlx::query("INSERT INTO agent_workspaces (id, name, active_agent_session_id, created_at, updated_at) VALUES ('workspace', NULL, NULL, 0, 0)")
            .execute(state.pool())
            .await
            .unwrap();
        assert!(session.write_input("\n"));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if matches!(events.recv().await.unwrap(), SessionEvent::Exit(Some(0))) {
                    break;
                }
            }
        })
        .await
        .unwrap();
        let response = created_session(&state, Some("workspace"), session.clone()).await;
        assert_eq!(
            response.status(),
            axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
        assert!(state.session(session.id(), SessionKind::Agent).is_none());
        let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_workspace_members")
            .fetch_one(state.pool())
            .await
            .unwrap();
        assert_eq!(members, 0);
        drop(lifecycle);
        tokio::time::timeout(Duration::from_secs(5), session.wait_for_completion())
            .await
            .unwrap();
    }
}
