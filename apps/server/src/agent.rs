use std::{
    collections::HashSet,
    env,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    os::unix::fs::PermissionsExt,
    path::{Path as FilePath, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json,
    extract::{Path, State, WebSocketUpgrade, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use portable_pty::CommandBuilder;
use serde::Deserialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    filesystem::{default_cwd, resolve_path},
    launch_config::{self, AgentLaunchConfig},
    session::{Session, SessionEvent, SessionKind, SessionSpawn, dimension},
    session_socket,
    state::AppState,
    terminal::{
        CreateRequest, RenameRequest, configure_environment, error, invalid_cwd, remove_session,
    },
};

pub(crate) const ID: &str = "opencode";
pub(crate) const NAME: &str = "OpenCode";
const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

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
        if !valid_upstream_session_id(id) {
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

pub(crate) fn available() -> bool {
    executable_path().is_some()
}

async fn installed_version() -> Option<String> {
    let executable = executable_path()?;
    let output = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new(executable)
            .arg("--version")
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

fn executable_path() -> Option<std::path::PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|path| path.join("opencode"))
            .find_map(|path| {
                path.is_file()
                    .then(|| std::fs::canonicalize(path).ok())
                    .flatten()
            })
    })
}

pub(crate) fn spawn(
    state: Arc<AppState>,
    request: CreateRequest,
    upstream_session_id: Option<String>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&FilePath>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_path(requested_cwd)?;
    if !cwd.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cwd").into());
    }
    let executable = executable_path().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "opencode executable not found",
        )
    })?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    if let Some(generation) = skill_generation
        && let Err(error) = copy_skills(&run_dir, generation)
    {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config, skill_generation.is_some()) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    let event_endpoint = match configure_command(&mut command, upstream_session_id.as_ref()) {
        Ok(endpoint) => endpoint,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(error.into());
        }
    };
    configure_environment(&mut command, &cwd);
    command.env("DEVHATCH_AGENT_ID", ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    command.env_remove("OPENCODE_CONFIG");
    command.env_remove("OPENCODE_CONFIG_CONTENT");
    command.env_remove("OPENCODE_CONFIG_DIR");
    command.env_remove("BYTE_API_PROVIDER_ID");
    command.env_remove("BYTE_API_SERVER_URL");
    if skill_generation.is_some() {
        command.env("OPENCODE_CONFIG_DIR", &run_dir);
    }
    let endpoint = event_endpoint.clone();
    let app_state = state.clone();
    let cleanup_path = run_dir.clone();
    let result = Session::spawn(
        state,
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id,
            cwd,
            name: NAME.to_string(),
            cols,
            rows,
            agent_id: Some(ID),
            agent_name: Some(NAME),
            cleanup_path: Some(cleanup_path),
        },
        move |session| {
            if let Some((port, password)) = endpoint {
                start_event_watcher(session, app_state.clone(), port, password);
            }
        },
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(run_dir);
    }
    result
}

fn create_run_dir(data_dir: &FilePath) -> std::io::Result<PathBuf> {
    let root = data_dir.join("agent-runs");
    std::fs::create_dir_all(&root)?;
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    let run_dir = root.join(Uuid::new_v4().to_string());
    std::fs::create_dir(&run_dir)?;
    std::fs::set_permissions(&run_dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(run_dir)
}

fn copy_skills(run_dir: &FilePath, generation: &FilePath) -> std::io::Result<()> {
    let skills = run_dir.join("skills");
    std::fs::create_dir(&skills)?;
    for entry in std::fs::read_dir(generation)? {
        let entry = entry?;
        let source = std::fs::canonicalize(entry.path())?;
        copy_skill_directory(&source, &skills.join(entry.file_name()))?;
    }
    Ok(())
}

fn copy_skill_directory(source: &FilePath, destination: &FilePath) -> std::io::Result<()> {
    std::fs::create_dir(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_skill_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), target)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "skill contains an unsupported filesystem entry",
            ));
        }
    }
    Ok(())
}

fn write_wrapper(
    path: &FilePath,
    config: &AgentLaunchConfig,
    use_managed_skills: bool,
) -> std::io::Result<()> {
    std::fs::write(path, wrapper_source(config, use_managed_skills))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

fn wrapper_source(config: &AgentLaunchConfig, use_managed_skills: bool) -> String {
    let mut source = String::from("#!/bin/sh\nset -e\n");
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
    if use_managed_skills {
        source.push_str(
            "devhatch_base_config_dir=${OPENCODE_CONFIG_DIR:-}\n\
             if [ -n \"$devhatch_base_config_dir\" ] && [ \"$devhatch_base_config_dir\" != \"$DEVHATCH_CONFIG_DIR\" ] && [ -d \"$devhatch_base_config_dir\" ]; then\n\
             for devhatch_entry in agents agent commands command plugins tools themes tui.json tui.jsonc package.json package-lock.json bun.lock bun.lockb node_modules; do\n\
             if [ -e \"$devhatch_base_config_dir/$devhatch_entry\" ] && [ ! -e \"$DEVHATCH_CONFIG_DIR/$devhatch_entry\" ]; then\n\
             ln -s \"$devhatch_base_config_dir/$devhatch_entry\" \"$DEVHATCH_CONFIG_DIR/$devhatch_entry\"\n\
             fi\n\
             done\n\
             fi\n\
             export OPENCODE_CONFIG_DIR=\"$DEVHATCH_CONFIG_DIR\"\n",
        );
    }
    source.push_str("exec \"$@\"\n");
    source
}

fn configure_command(
    command: &mut CommandBuilder,
    upstream_session_id: Option<&String>,
) -> std::io::Result<Option<(u16, String)>> {
    if let Some(id) = upstream_session_id {
        command.arg("-s");
        command.arg(id);
    }
    let port = available_loopback_port()?;
    let password = Uuid::new_v4().to_string();
    command.arg("--hostname");
    command.arg("127.0.0.1");
    command.arg("--port");
    command.arg(port.to_string());
    command.env("OPENCODE_SERVER_USERNAME", "opencode");
    command.env("OPENCODE_SERVER_PASSWORD", &password);
    Ok(Some((port, password)))
}

pub(crate) fn start_history_reconciler(
    session: &Arc<Session>,
    app_state: Arc<AppState>,
    baseline: HashSet<String>,
) {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        loop {
            let Some(session) = weak.upgrade() else {
                return;
            };
            if session.is_deleting() || session.upstream_session_id().is_some() {
                return;
            }
            let (directory, launched_at) = session.correlation_details();
            let _reconciliation = app_state.history_reconciliation().lock().await;
            let claimed = app_state.active_upstream_session_ids();
            drop(session);
            if let Ok(Some(id)) = crate::history::unique_new_session(
                app_state.history_pool(),
                &directory,
                launched_at,
                &baseline,
                &claimed,
            )
            .await
            {
                let Some(session) = weak.upgrade() else {
                    return;
                };
                session.update_upstream_session_id(id);
                return;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
}

pub(crate) fn start_fork_reconciler(session: &Arc<Session>, app_state: Arc<AppState>) {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let Some(session) = weak.upgrade() else {
                return;
            };
            if session.is_deleting() {
                return;
            }
            let Some(current_id) = session.upstream_session_id() else {
                continue;
            };
            let (directory, launched_at) = session.correlation_details();
            drop(session);
            let successor = crate::history::fork_successor_id(
                app_state.history_pool(),
                &current_id,
                &directory,
                launched_at,
            )
            .await;
            if let Ok(Some(id)) = successor
                && let Some(session) = weak.upgrade()
                && !session.is_deleting()
            {
                session.update_upstream_session_id(id);
            }
        }
    });
}

pub(crate) fn start_event_watcher(
    session: &Arc<Session>,
    app_state: Arc<AppState>,
    port: u16,
    password: String,
) {
    let weak = Arc::downgrade(session);
    let mut events = session.subscribe();
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(1))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        let url = format!("http://127.0.0.1:{port}/global/event");
        loop {
            let deleting = weak.upgrade().is_none_or(|session| session.is_deleting());
            if deleting {
                return;
            }
            let request = client
                .get(&url)
                .basic_auth("opencode", Some(&password))
                .send();
            let response = tokio::select! {
                response = request => response,
                _ = session_stopped(&mut events) => return,
            };
            let Ok(response) = response else {
                if retry_or_stop(&mut events).await {
                    return;
                }
                continue;
            };
            if !response.status().is_success() {
                if retry_or_stop(&mut events).await {
                    return;
                }
                continue;
            }
            let mut stream = response.bytes_stream();
            let mut pending = Vec::new();
            loop {
                let chunk = tokio::select! {
                    chunk = stream.next() => chunk,
                    _ = session_stopped(&mut events) => return,
                };
                let Some(Ok(chunk)) = chunk else { break };
                pending.extend_from_slice(&chunk);
                if pending.len() > 1024 * 1024 {
                    break;
                }
                while let Some((end, delimiter_len)) = sse_event_end(&pending) {
                    let event = pending.drain(..end + delimiter_len).collect::<Vec<_>>();
                    let Some((directory, id)) = parse_created_session_event(&event) else {
                        continue;
                    };
                    let Some(session) = weak.upgrade() else {
                        return;
                    };
                    if session.is_deleting() {
                        return;
                    }
                    let current = session.upstream_session_id();
                    let belongs_to_session = match current.as_deref() {
                        None => session.correlation_details().0 == directory,
                        Some(current) => crate::history::fork_successor(
                            app_state.history_pool(),
                            current,
                            &id,
                            &directory,
                        )
                        .await
                        .unwrap_or(false),
                    };
                    if belongs_to_session {
                        session.update_upstream_session_id(id);
                    }
                }
            }
            if retry_or_stop(&mut events).await {
                return;
            }
        }
    });
}

fn available_loopback_port() -> std::io::Result<u16> {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?
        .local_addr()
        .map(|address| address.port())
}

fn sse_event_end(pending: &[u8]) -> Option<(usize, usize)> {
    pending
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|end| (end, 4))
        .or_else(|| {
            pending
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|end| (end, 2))
        })
}

fn parse_created_session_event(event: &[u8]) -> Option<(String, String)> {
    let event = std::str::from_utf8(event).ok()?.replace("\r\n", "\n");
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    let value = serde_json::from_str::<serde_json::Value>(&data).ok()?;
    let payload = value.get("payload").unwrap_or(&value);
    if payload.get("type").and_then(serde_json::Value::as_str) != Some("session.created") {
        return None;
    }
    let info = payload
        .get("properties")
        .and_then(|properties| properties.get("info"))?;
    if info
        .get("parentID")
        .is_some_and(|parent_id| !parent_id.is_null())
    {
        return None;
    }
    let id = payload
        .get("properties")
        .and_then(|properties| properties.get("sessionID"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| info.get("id").and_then(serde_json::Value::as_str));
    let directory = value
        .get("directory")
        .and_then(serde_json::Value::as_str)
        .or_else(|| info.get("directory").and_then(serde_json::Value::as_str))?;
    id.filter(|id| valid_upstream_session_id(id))
        .map(|id| (directory.to_string(), id.to_string()))
}

async fn session_stopped(events: &mut broadcast::Receiver<SessionEvent>) {
    loop {
        match events.recv().await {
            Ok(SessionEvent::Exit(_) | SessionEvent::Removed(_) | SessionEvent::Terminate) => {
                return;
            }
            Ok(SessionEvent::Output(_) | SessionEvent::UpstreamSessionChanged(_))
            | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

async fn retry_or_stop(events: &mut broadcast::Receiver<SessionEvent>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(100)) => false,
        _ = session_stopped(events) => true,
    }
}

pub(crate) fn valid_upstream_session_id(value: &str) -> bool {
    let suffix = value.strip_prefix("ses_");
    matches!(suffix, Some(value) if !value.is_empty() && value.len() <= 124 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

#[cfg(test)]
mod tests {
    use super::{
        parse_created_session_event, sse_event_end, valid_upstream_session_id, wrapper_source,
    };
    use crate::launch_config::AgentLaunchConfig;

    #[test]
    fn parses_root_session_created_events() {
        let event = b"data: {\"type\":\"session.created\",\"properties\":{\"info\":{\"id\":\"ses_abc-123_X\",\"directory\":\"/tmp\",\"parentID\":null}}}\r\n\r\n";
        assert_eq!(
            parse_created_session_event(event),
            Some(("/tmp".to_string(), "ses_abc-123_X".to_string()))
        );
        assert_eq!(sse_event_end(event), Some((event.len() - 4, 4)));

        let child = b"data: {\"type\":\"session.created\",\"properties\":{\"info\":{\"id\":\"ses_child\",\"parentID\":\"ses_parent\"}}}\n\n";
        assert_eq!(parse_created_session_event(child), None);

        let current = b"data: {\"directory\":\"/tmp\",\"payload\":{\"type\":\"session.created\",\"properties\":{\"sessionID\":\"ses_current\",\"info\":{\"directory\":\"/tmp\",\"parentID\":null}}}}\n\n";
        assert_eq!(
            parse_created_session_event(current),
            Some(("/tmp".to_string(), "ses_current".to_string()))
        );
    }

    #[test]
    fn generates_wrapper_without_interpolating_command() {
        let config = AgentLaunchConfig {
            id: "id".into(),
            agent_id: "opencode".into(),
            name: "Name".into(),
            is_default: true,
            pre_launch_script: "export A='one'".into(),
            provider_script: "printf '%s\\n' \"$A\"".into(),
            tui_script: "case x in x) :;; esac".into(),
            created_at: 0,
            updated_at: 0,
        };
        assert_eq!(
            wrapper_source(&config, false),
            "#!/bin/sh\nset -e\nexport A='one'\nprintf '%s\\n' \"$A\"\ncase x in x) :;; esac\nexec \"$@\"\n"
        );
    }

    #[test]
    fn restores_managed_config_directory_after_launch_scripts() {
        let config = AgentLaunchConfig {
            id: "id".into(),
            agent_id: "opencode".into(),
            name: "Name".into(),
            is_default: true,
            pre_launch_script: String::new(),
            provider_script: "export OPENCODE_CONFIG_DIR=/base/config".into(),
            tui_script: String::new(),
            created_at: 0,
            updated_at: 0,
        };
        let source = wrapper_source(&config, true);
        assert!(source.contains("devhatch_base_config_dir=${OPENCODE_CONFIG_DIR:-}"));
        assert!(source.contains("ln -s \"$devhatch_base_config_dir/$devhatch_entry\""));
        assert!(
            source.contains("export OPENCODE_CONFIG_DIR=\"$DEVHATCH_CONFIG_DIR\"\nexec \"$@\"")
        );
        assert!(
            source
                .find("export OPENCODE_CONFIG_DIR=/base/config")
                .unwrap()
                < source
                    .find("export OPENCODE_CONFIG_DIR=\"$DEVHATCH_CONFIG_DIR\"")
                    .unwrap()
        );
    }

    #[test]
    fn validates_upstream_session_ids_strictly() {
        assert!(valid_upstream_session_id("ses_abc-123_X"));
        assert!(!valid_upstream_session_id("ses_"));
        assert!(!valid_upstream_session_id("ses_abc def"));
        assert!(!valid_upstream_session_id("other_abc"));
        assert!(!valid_upstream_session_id(&format!(
            "ses_{}",
            "x".repeat(125)
        )));
    }
}
