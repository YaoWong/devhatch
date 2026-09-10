use std::{
    env,
    os::unix::fs::PermissionsExt,
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};

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
    launch_config::{self, AgentLaunchConfig, TERMINAL_ID},
    session::{Session, SessionKind, SessionSpawn, dimension, socket},
    state::AppState,
    workspace::{self, MemberIdentity},
};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateRequest {
    pub(crate) cwd: Option<serde_json::Value>,
    pub(crate) cols: Option<serde_json::Value>,
    pub(crate) rows: Option<serde_json::Value>,
    pub(crate) launch_config_id: Option<String>,
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
    let launch_config = match launch_config::resolve(
        &state,
        TERMINAL_ID,
        request.launch_config_id.as_deref(),
    )
    .await
    {
        Ok(Some(config)) => config,
        Ok(None) => return error(StatusCode::NOT_FOUND, "AGENT_LAUNCH_CONFIG_NOT_FOUND"),
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
    };
    let workspace_id = request.workspace_id.clone();
    let _lifecycle = state.workspace_lifecycle().lock().await;
    if let Some(workspace_id) = workspace_id.as_deref() {
        match sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?)")
            .bind(workspace_id)
            .fetch_one(state.pool())
            .await
        {
            Ok(1) => {}
            Ok(_) => return error(StatusCode::NOT_FOUND, "WORKSPACE_NOT_FOUND"),
            Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR"),
        }
    }
    let session = match spawn_with_cwd(state.clone(), request, cwd.clone().into(), launch_config) {
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
    let member = MemberIdentity::new(session.id(), SessionKind::Terminal);
    let (eligible, _) = state.workspace_snapshot();
    let workspace = workspace::attach_session(
        state.pool(),
        &eligible,
        workspace_id.as_deref(),
        &member,
        Some(&cwd),
    )
    .await;
    let workspace = match workspace {
        Ok(Some(workspace)) => workspace,
        Ok(None) => {
            cleanup_failed_spawn(&state, &session).await;
            return error(StatusCode::NOT_FOUND, "WORKSPACE_NOT_FOUND");
        }
        Err(_) => {
            cleanup_failed_spawn(&state, &session).await;
            return error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR");
        }
    };
    (
        StatusCode::CREATED,
        Json(serde_json::json!({
            "terminal": session.view(),
            "workspace": workspace
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
    let _lifecycle = state.workspace_lifecycle().lock().await;
    let Some(session) = state.session(&id, SessionKind::Terminal) else {
        return error(StatusCode::NOT_FOUND, "TERMINAL_NOT_FOUND");
    };
    let workspace = match workspace::remove_member(
        state.pool(),
        &MemberIdentity::new(&id, SessionKind::Terminal),
    )
    .await
    {
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
    drop(_lifecycle);
    removed.terminate();
    Json(serde_json::json!({
        "workspace": workspace
    }))
    .into_response()
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
    cwd: PathBuf,
    launch_config: AgentLaunchConfig,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let shell = resolve_shell();
    let run_dir = create_run_dir(state.data_dir())?;
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&shell);
    configure_environment(&mut command, &cwd);
    command.env("DEVHATCH_AGENT_ID", TERMINAL_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    let name = cwd
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("Terminal")
        .to_string();
    let cleanup_path = run_dir.clone();
    let result = Session::spawn(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Terminal,
            upstream_session_id: None,
            pending_upstream_session_id: None,
            cwd,
            name,
            cols,
            rows,
            agent_id: None,
            agent_name: None,
            cleanup_path: Some(cleanup_path),
            runtime_endpoint: None,
            exit_cleanup: None,
        },
        |_| {},
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(run_dir);
    }
    result
}

fn create_run_dir(data_dir: &FsPath) -> std::io::Result<PathBuf> {
    let root = data_dir.join("terminal-runs");
    std::fs::create_dir_all(&root)?;
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    let run_dir = root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir(&run_dir)?;
    std::fs::set_permissions(&run_dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(run_dir)
}

fn write_wrapper(path: &FsPath, config: &AgentLaunchConfig) -> std::io::Result<()> {
    std::fs::write(path, wrapper_source(config))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

fn wrapper_source(config: &AgentLaunchConfig) -> String {
    let mut source =
        String::from("#!/bin/sh\nset -e\ndevhatch_login_shell=$1\nreadonly devhatch_login_shell\n");
    for script in [
        &config.pre_launch_script,
        &config.provider_script,
        &config.tui_script,
    ] {
        source.push_str(script);
        if !script.ends_with('\n') {
            source.push('\n');
        }
    }
    source.push_str("exec \"$devhatch_login_shell\" -l\n");
    source
}

pub(crate) fn configure_environment(command: &mut CommandBuilder, cwd: &std::path::Path) {
    command.cwd(cwd);
    command.env_remove(crate::process::ADMIN_PASSWORD_ENV);
    command.env_remove(crate::process::ADMIN_PASSWORD_FILE_ENV);
    command.env_remove(crate::process::BYTE_API_KEY_ENV);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    if npm_default_editor() {
        command.env_remove("EDITOR");
    }
}

async fn cleanup_failed_spawn(state: &AppState, session: &Arc<Session>) {
    state.remove_session(session.id(), SessionKind::Terminal);
    session.mark_deleting();
    session.terminate();
    let _ = workspace::remove_member(
        state.pool(),
        &MemberIdentity::new(session.id(), SessionKind::Terminal),
    )
    .await;
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

#[cfg(test)]
mod tests {
    use std::{os::unix::fs::PermissionsExt, process::Command, sync::Arc, time::Duration};

    use axum::{Json, extract::State, http::StatusCode};
    use portable_pty::CommandBuilder;
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        CreateRequest, configure_environment, create, create_run_dir, spawn_with_cwd,
        wrapper_source, write_wrapper,
    };
    use crate::{
        launch_config::AgentLaunchConfig,
        state::{AppState, OpenCodeHistoryPool},
    };

    fn config(scripts: [&str; 3]) -> AgentLaunchConfig {
        AgentLaunchConfig {
            id: "terminal-test".into(),
            agent_id: "terminal".into(),
            name: "Test".into(),
            is_default: false,
            pre_launch_script: scripts[0].into(),
            provider_script: scripts[1].into(),
            tui_script: scripts[2].into(),
            created_at: 0,
            updated_at: 0,
        }
    }

    async fn state() -> (tempfile::TempDir, Arc<AppState>) {
        let root = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            root.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(root.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        (root, state)
    }

    #[test]
    fn environment_removes_secret_but_keeps_key_file() {
        let mut command = CommandBuilder::new("/bin/sh");
        command.env("BYTE_API_API_KEY", "secret");
        command.env("BYTE_API_API_KEY_FILE", "/private/key");
        configure_environment(&mut command, std::path::Path::new("/tmp"));
        assert!(command.get_env("BYTE_API_API_KEY").is_none());
        assert_eq!(
            command.get_env("BYTE_API_API_KEY_FILE"),
            Some(std::ffi::OsStr::new("/private/key"))
        );
    }

    #[test]
    fn wrapper_is_private_runs_all_scripts_and_execs_saved_argv() {
        let root = tempfile::tempdir().unwrap();
        let run_dir = create_run_dir(root.path()).unwrap();
        let output = root.path().join("output");
        let shell = root.path().join("login shell");
        std::fs::write(
            &shell,
            "#!/bin/sh\nprintf 'shell:%s\\n' \"$1\" >> \"$OUTPUT\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        let config = config([
            "printf 'pre\\n' >> \"$OUTPUT\"",
            "printf 'provider\\n' >> \"$OUTPUT\"\n",
            "set -- /attacker\nprintf 'tui\\n' >> \"$OUTPUT\"",
        ]);
        let wrapper = run_dir.join("launch.sh");
        write_wrapper(&wrapper, &config).unwrap();

        assert_eq!(
            std::fs::metadata(root.path().join("terminal-runs"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&run_dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&wrapper).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let source = wrapper_source(&config);
        assert!(!source.contains(shell.to_string_lossy().as_ref()));
        assert!(source.ends_with("exec \"$devhatch_login_shell\" -l\n"));
        let status = Command::new("/bin/sh")
            .arg(&wrapper)
            .arg(&shell)
            .env("OUTPUT", &output)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(
            std::fs::read_to_string(output).unwrap(),
            "pre\nprovider\ntui\nshell:-l\n"
        );
    }

    #[tokio::test]
    async fn terminal_config_defaults_and_wrong_owner_returns_not_found() {
        let (root, state) = state().await;
        let default = crate::launch_config::resolve(&state, "terminal", None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(default.id, "terminal-default");
        let response = create(
            State(state),
            Json(CreateRequest {
                cwd: Some(serde_json::Value::String(
                    root.path().to_string_lossy().into_owned(),
                )),
                cols: None,
                rows: None,
                launch_config_id: Some("opencode-default".into()),
                workspace_id: None,
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn invalid_workspace_does_not_start_terminal_script() {
        let (root, state) = state().await;
        let response = create(
            State(state),
            Json(CreateRequest {
                cwd: Some(serde_json::Value::String(
                    root.path().to_string_lossy().into_owned(),
                )),
                cols: None,
                rows: None,
                launch_config_id: None,
                workspace_id: Some("missing".into()),
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(!root.path().join("terminal-runs").exists());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn terminal_run_directory_is_removed_on_exit() {
        let (root, state) = state().await;
        let session = spawn_with_cwd(
            state,
            CreateRequest::default(),
            root.path().to_owned(),
            config(["exit 0", "", ""]),
        )
        .unwrap();
        let run_dir = session.runtime_dir().unwrap();
        tokio::time::timeout(Duration::from_secs(5), session.wait_for_completion())
            .await
            .unwrap();
        assert!(!run_dir.exists());
    }
}
