use std::{env, sync::Arc};

use axum::{
    Json,
    extract::{Extension, Path, State, WebSocketUpgrade},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use portable_pty::CommandBuilder;
use serde::Deserialize;

use crate::{
    api::ApiError,
    filesystem::{default_cwd, home_dir, path_string, validated_directory},
    session::{Session, SessionKind, SessionSpawn, dimension, socket},
    state::AppState,
    terminal_workspace,
};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRequest {
    pub(crate) cwd: Option<serde_json::Value>,
    pub(crate) cols: Option<serde_json::Value>,
    pub(crate) rows: Option<serde_json::Value>,
    pub(crate) workspace_id: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct RenameRequest {
    pub(crate) name: Option<serde_json::Value>,
}

pub async fn health(State(state): State<Arc<AppState>>) -> Response {
    let _ = state.data_dir();
    let sessions = state.session_count(SessionKind::Terminal);
    let database_ready = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(state.pool())
        .await
        .is_ok();
    let status = if database_ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(serde_json::json!({
            "ok": database_ready,
            "sessions": sessions,
            "databaseReady": database_ready
        })),
    )
        .into_response()
}

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    let sessions = state.session_views(SessionKind::Terminal);
    let home = home_dir();
    match std::fs::canonicalize(&home) {
        Ok(resolved_home) => Json(serde_json::json!({
            "terminals": sessions,
            "home": path_string(home),
            "resolvedHome": path_string(resolved_home)
        }))
        .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": error.to_string() })),
        )
            .into_response(),
    }
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    Json(request): Json<CreateRequest>,
) -> Response {
    if invalid_cwd(request.cwd.as_ref()) {
        return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
    }
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = match validated_directory(requested_cwd) {
        Ok(value) => value,
        Err(_) => return error(StatusCode::BAD_REQUEST, "INVALID_CWD"),
    };
    let workspace_id = request.workspace_id.clone();
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    let session = match spawn_with_cwd(state.clone(), request, cwd.clone().into()) {
        Ok(session) => session,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "error": "TERMINAL_SPAWN_FAILED",
                    "message": error.to_string()
                })),
            )
                .into_response();
        }
    };
    let terminal_workspace = terminal_workspace::attach_terminal(
        state.pool(),
        workspace_id.as_deref(),
        session.id(),
        &cwd,
    )
    .await;
    let terminal_workspace = match terminal_workspace {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            cleanup_failed_spawn(&state, &session);
            return error(StatusCode::NOT_FOUND, "TERMINAL_WORKSPACE_NOT_FOUND");
        }
        Err(_) => {
            cleanup_failed_spawn(&state, &session);
            return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR");
        }
    };
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "terminal": session.view(),
            "terminalWorkspace": terminal_workspace
        })),
    )
        .into_response()
}

pub async fn rename(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<RenameRequest>,
) -> Response {
    let Some(session) = state.session(&id, SessionKind::Terminal) else {
        return error(StatusCode::NOT_FOUND, "TERMINAL_NOT_FOUND");
    };
    let name = request
        .name
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if name.is_empty() || name.encode_utf16().count() > 120 {
        return error(StatusCode::BAD_REQUEST, "INVALID_TERMINAL_NAME");
    }
    session.rename(name.to_string());
    Json(serde_json::json!({ "terminal": session.view() })).into_response()
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let _lifecycle = state.terminal_workspace_lifecycle().lock().await;
    let Some(session) = state.session(&id, SessionKind::Terminal) else {
        return error(StatusCode::NOT_FOUND, "TERMINAL_NOT_FOUND");
    };
    let terminal_workspace = match terminal_workspace::remove_terminal(state.pool(), &id).await {
        Ok(workspace) => workspace,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    };
    let Some(removed) = state.remove_session(&id, SessionKind::Terminal) else {
        return error(StatusCode::NOT_FOUND, "TERMINAL_NOT_FOUND");
    };
    if !Arc::ptr_eq(&session, &removed) {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "SESSION_REGISTRY_ERROR");
    }
    removed.mark_deleting();
    removed.terminate();
    Json(serde_json::json!({ "terminalWorkspace": terminal_workspace })).into_response()
}

pub async fn socket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(identity): Extension<crate::auth::AuthIdentity>,
    upgrade: WebSocketUpgrade,
) -> Response {
    socket::upgrade(state, id, identity, upgrade, SessionKind::Terminal)
}

pub(crate) fn spawn_with_cwd(
    state: Arc<AppState>,
    request: CreateRequest,
    cwd: std::path::PathBuf,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let shell = resolve_shell();
    let mut command = CommandBuilder::new(&shell);
    command.arg("-l");
    configure_environment(&mut command, &cwd);
    let name = cwd
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Terminal")
        .to_string();
    Session::spawn(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Terminal,
            upstream_session_id: None,
            cwd,
            name,
            cols,
            rows,
            agent_id: None,
            agent_name: None,
            cleanup_path: None,
            runtime_endpoint: None,
            exit_cleanup: None,
        },
        |_| {},
    )
}

pub(crate) fn configure_environment(command: &mut CommandBuilder, cwd: &std::path::Path) {
    command.cwd(cwd);
    command.env_remove(crate::process::ADMIN_PASSWORD_ENV);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    if npm_default_editor() {
        command.env_remove("EDITOR");
    }
}

fn cleanup_failed_spawn(state: &AppState, session: &Arc<Session>) {
    state.remove_session(session.id(), SessionKind::Terminal);
    session.mark_deleting();
    session.terminate();
}

pub(crate) fn invalid_cwd(value: Option<&serde_json::Value>) -> bool {
    value.is_some_and(|value| {
        value
            .as_str()
            .is_none_or(|value| validated_directory(value).is_err())
    })
}

fn npm_default_editor() -> bool {
    env::var_os("npm_lifecycle_event").is_some()
        && env::var("EDITOR").as_deref() == Ok("vi")
        && env::var_os("VISUAL").is_none()
}

fn resolve_shell() -> String {
    env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

pub(crate) fn error(status: StatusCode, code: &str) -> Response {
    ApiError::new(status, code.to_string()).into_response()
}
