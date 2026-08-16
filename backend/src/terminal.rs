use std::{
    env,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::PathBuf,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    Json,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use indexmap::IndexMap;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashSet;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    filesystem::{home_dir, path_string, resolve_path},
    launch_path,
};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;
const OUTPUT_LIMIT: usize = 512 * 1024;
const OPENCODE_AGENT_ID: &str = "opencode";
const OPENCODE_AGENT_NAME: &str = "OpenCode";
const OPENCODE_CONFIG_ID: &str = "opencode-default";

pub struct AppState {
    sessions: RwLock<IndexMap<String, Arc<TerminalSession>>>,
    history_reconciliation: tokio::sync::Mutex<()>,
    data_dir: PathBuf,
    pub pool: SqlitePool,
    pub history_pool: Option<SqlitePool>,
}

impl AppState {
    pub fn new(data_dir: PathBuf, pool: SqlitePool, history_pool: Option<SqlitePool>) -> Self {
        Self {
            sessions: RwLock::new(IndexMap::new()),
            history_reconciliation: tokio::sync::Mutex::new(()),
            data_dir,
            pool,
            history_pool,
        }
    }

    pub fn terminate_all(&self) {
        for session in self
            .sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
        {
            session.terminate();
        }
    }

    pub fn active_upstream_session_ids(&self) -> HashSet<String> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind == SessionKind::Agent)
            .filter_map(|session| {
                session
                    .upstream_session_id
                    .read()
                    .expect("upstream session lock poisoned")
                    .clone()
            })
            .collect()
    }

    pub fn owned_process_ids(&self) -> HashSet<u32> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .map(|session| session.process_id)
            .collect()
    }

    fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }
}

struct TerminalSession {
    id: String,
    shell: String,
    kind: SessionKind,
    upstream_session_id: RwLock<Option<String>>,
    process_id: u32,
    state: Mutex<SessionState>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    deleting: AtomicBool,
    events: broadcast::Sender<SessionEvent>,
}

struct SessionState {
    name: String,
    cwd: String,
    status: SessionStatus,
    cols: u16,
    rows: u16,
    created_at: u64,
    updated_at: u64,
    exit_code: Option<u32>,
    output: String,
}

#[derive(Clone, Copy, PartialEq)]
enum SessionKind {
    Terminal,
    Agent,
}

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum SessionStatus {
    Running,
    Exited,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionView {
    id: String,
    name: String,
    cwd: String,
    shell: String,
    status: SessionStatus,
    cols: u16,
    rows: u16,
    created_at: u64,
    updated_at: u64,
    exit_code: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_id: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_name: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upstream_session_id: Option<String>,
    kind: &'static str,
}

#[derive(Clone)]
enum SessionEvent {
    Output(String),
    Exit(Option<u32>),
    Removed(Option<u32>),
    Terminate,
}

#[derive(Default, Deserialize)]
pub(crate) struct CreateRequest {
    cwd: Option<serde_json::Value>,
    cols: Option<serde_json::Value>,
    rows: Option<serde_json::Value>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AgentCreateRequest {
    cwd: Option<serde_json::Value>,
    cols: Option<serde_json::Value>,
    rows: Option<serde_json::Value>,
    upstream_session_id: Option<String>,
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

#[derive(Deserialize)]
pub(crate) struct RenameRequest {
    name: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMessage {
    Input {
        data: serde_json::Value,
    },
    Resize {
        cols: serde_json::Value,
        rows: serde_json::Value,
    },
    Ping,
}

pub async fn health(State(state): State<Arc<AppState>>) -> Response {
    let _ = state.data_dir();
    let sessions = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .values()
        .filter(|session| session.kind == SessionKind::Terminal)
        .count();
    let database_ready = sqlx::query_scalar::<_, i64>("SELECT 1")
        .fetch_one(&state.pool)
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

pub async fn agents(State(_state): State<Arc<AppState>>) -> Response {
    let available = opencode_available();
    Json(serde_json::json!({
        "agents": [{
            "id": OPENCODE_AGENT_ID,
            "name": OPENCODE_AGENT_NAME,
            "kind": "opencode",
            "available": available,
            "launchConfigCount": 1,
            "defaultLaunchConfigId": OPENCODE_CONFIG_ID,
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

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    let sessions = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .values()
        .filter(|session| session.kind == SessionKind::Terminal)
        .map(|session| session.view())
        .collect::<Vec<_>>();
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
    if let Some(value) = request.cwd.as_ref() {
        let Some(value) = value.as_str() else {
            return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
        };
        if launch_path::validated_directory(value).is_err() {
            return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
        }
    }
    match TerminalSession::spawn(state.clone(), request, SessionKind::Terminal, None) {
        Ok(session) => {
            let view = session.view();
            (
                StatusCode::CREATED,
                Json(serde_json::json!({ "terminal": view })),
            )
                .into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "error": "TERMINAL_SPAWN_FAILED",
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
    let session = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .get(&id)
        .cloned();
    let Some(session) = session.filter(|session| session.kind == SessionKind::Terminal) else {
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
    {
        let mut session_state = session.state.lock().expect("session lock poisoned");
        session_state.name = name.to_string();
        session_state.updated_at = now();
    }
    Json(serde_json::json!({ "terminal": session.view() })).into_response()
}

pub async fn remove(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    remove_session(&state, &id, SessionKind::Terminal, "TERMINAL_NOT_FOUND")
}

pub async fn socket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    socket_for_kind(state, id, headers, upgrade, SessionKind::Terminal)
}

fn socket_for_kind(
    state: Arc<AppState>,
    id: String,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
    kind: SessionKind,
) -> Response {
    if !valid_origin(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let session = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .get(&id)
        .filter(|session| session.kind == kind)
        .cloned();
    let Some(session) = session else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let socket_state = state.clone();
    upgrade.on_upgrade(move |socket| handle_socket(socket, session, socket_state))
}

pub async fn list_agents(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let sessions = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .values()
        .filter(|session| session.kind == SessionKind::Agent)
        .map(|session| session.view())
        .collect::<Vec<_>>();
    Json(serde_json::json!({ "agentSessions": sessions }))
}

pub async fn create_agent(
    State(state): State<Arc<AppState>>,
    Json(request): Json<AgentCreateRequest>,
) -> Response {
    if !opencode_available() {
        return error(StatusCode::SERVICE_UNAVAILABLE, "AGENT_UNAVAILABLE");
    }
    let is_new_session = request.upstream_session_id.is_none();
    let baseline_session_ids = if is_new_session {
        crate::history::root_session_ids(state.history_pool.as_ref())
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
        match crate::history::resumable_session(state.history_pool.as_ref(), id).await {
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
    if let Some(value) = terminal_request.cwd.as_ref() {
        let Some(value) = value.as_str() else {
            return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
        };
        if launch_path::validated_directory(value).is_err() {
            return error(StatusCode::BAD_REQUEST, "INVALID_CWD");
        }
    }
    let session = match TerminalSession::spawn(
        state.clone(),
        terminal_request,
        SessionKind::Agent,
        upstream_session_id,
    ) {
        Ok(session) => session,
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
        TerminalSession::start_history_reconciler(&session, state.clone(), baseline_session_ids);
    }
    (
        StatusCode::CREATED,
        Json(serde_json::json!({ "agentSession": session.view() })),
    )
        .into_response()
}

pub async fn rename_agent(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(request): Json<RenameRequest>,
) -> Response {
    let session = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .get(&id)
        .filter(|session| session.kind == SessionKind::Agent)
        .cloned();
    let Some(session) = session else {
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
    {
        let mut session_state = session.state.lock().expect("session lock poisoned");
        session_state.name = name.to_string();
        session_state.updated_at = now();
    }
    Json(serde_json::json!({ "agentSession": session.view() })).into_response()
}

pub async fn remove_agent(State(state): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    remove_session(&state, &id, SessionKind::Agent, "AGENT_SESSION_NOT_FOUND")
}

pub async fn agent_socket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    socket_for_kind(state, id, headers, upgrade, SessionKind::Agent)
}

fn remove_session(state: &AppState, id: &str, kind: SessionKind, not_found: &str) -> Response {
    let mut sessions = state.sessions.write().expect("sessions lock poisoned");
    if !sessions.get(id).is_some_and(|session| session.kind == kind) {
        return error(StatusCode::NOT_FOUND, not_found);
    }
    let session = sessions.shift_remove(id).expect("session must exist");
    drop(sessions);
    session.deleting.store(true, Ordering::Release);
    session.terminate();
    StatusCode::NO_CONTENT.into_response()
}

impl TerminalSession {
    fn spawn(
        app_state: Arc<AppState>,
        request: CreateRequest,
        kind: SessionKind,
        upstream_session_id: Option<String>,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        let fallback_cwd = default_cwd();
        let requested_cwd = request
            .cwd
            .as_ref()
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&fallback_cwd);
        let requested_cwd = resolve_path(requested_cwd)?;
        let cwd = requested_cwd;
        if !cwd.is_dir() {
            return Err(
                std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cwd").into(),
            );
        }
        let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
        let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
        let shell = if kind == SessionKind::Agent {
            "opencode".to_string()
        } else {
            resolve_shell()
        };
        let pair = NativePtySystem::default().openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut command = CommandBuilder::new(&shell);
        let event_endpoint = if kind == SessionKind::Agent && upstream_session_id.is_none() {
            let port = available_loopback_port()?;
            let password = Uuid::new_v4().to_string();
            Some((port, password))
        } else {
            None
        };
        if kind == SessionKind::Agent {
            if let Some(id) = upstream_session_id.as_ref() {
                command.arg("-s");
                command.arg(id);
            }
            if let Some((port, password)) = event_endpoint.as_ref() {
                command.arg("--hostname");
                command.arg("127.0.0.1");
                command.arg("--port");
                command.arg(port.to_string());
                command.env("OPENCODE_SERVER_USERNAME", "opencode");
                command.env("OPENCODE_SERVER_PASSWORD", password);
            }
        } else {
            command.arg("-l");
        }
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if npm_default_editor() {
            command.env_remove("EDITOR");
        }
        let child = pair.slave.spawn_command(command)?;
        let process_id = child.process_id().unwrap_or_default();
        let killer = child.clone_killer();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let timestamp = now();
        let cwd_string = path_string(&cwd);
        let name = if kind == SessionKind::Agent {
            OPENCODE_AGENT_NAME.to_string()
        } else {
            cwd.file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .unwrap_or("Terminal")
                .to_string()
        };
        let (events, _) = broadcast::channel(1024);
        let session = Arc::new(Self {
            id: Uuid::new_v4().to_string(),
            shell,
            kind,
            upstream_session_id: RwLock::new(upstream_session_id),
            process_id,
            state: Mutex::new(SessionState {
                name,
                cwd: cwd_string,
                status: SessionStatus::Running,
                cols,
                rows,
                created_at: timestamp,
                updated_at: timestamp,
                exit_code: None,
                output: String::new(),
            }),
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            deleting: AtomicBool::new(false),
            events,
        });
        app_state
            .sessions
            .write()
            .expect("sessions lock poisoned")
            .insert(session.id.clone(), session.clone());
        Self::start_reader(&session, reader);
        if let Some((port, password)) = event_endpoint {
            Self::start_event_watcher(&session, port, password);
        }
        Self::start_waiter(&session, child, app_state);
        Ok(session)
    }

    fn start_history_reconciler(
        session: &Arc<Self>,
        app_state: Arc<AppState>,
        baseline: HashSet<String>,
    ) {
        let weak = Arc::downgrade(session);
        tokio::spawn(async move {
            loop {
                let Some(session) = weak.upgrade() else {
                    return;
                };
                if session.deleting.load(Ordering::Acquire)
                    || session
                        .upstream_session_id
                        .read()
                        .expect("upstream session lock poisoned")
                        .is_some()
                {
                    return;
                }
                let (directory, launched_at) = {
                    let state = session.state.lock().expect("session lock poisoned");
                    (state.cwd.clone(), state.created_at as i64)
                };
                let _reconciliation = app_state.history_reconciliation.lock().await;
                let claimed = app_state.active_upstream_session_ids();
                drop(session);
                if let Ok(Some(id)) = crate::history::unique_new_session(
                    app_state.history_pool.as_ref(),
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
                    session.assign_upstream_session_id(id);
                    return;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        });
    }

    fn assign_upstream_session_id(&self, id: String) {
        let mut upstream = self
            .upstream_session_id
            .write()
            .expect("upstream session lock poisoned");
        if upstream.is_some() {
            return;
        }
        *upstream = Some(id);
        drop(upstream);
        self.state.lock().expect("session lock poisoned").updated_at = now();
    }

    fn start_event_watcher(session: &Arc<Self>, port: u16, password: String) {
        let weak = Arc::downgrade(session);
        let mut events = session.events.subscribe();
        tokio::spawn(async move {
            let client = match reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(1))
                .build()
            {
                Ok(client) => client,
                Err(_) => return,
            };
            let url = format!("http://127.0.0.1:{port}/event");
            loop {
                let deleting = weak
                    .upgrade()
                    .is_none_or(|session| session.deleting.load(Ordering::Acquire));
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
                        let Some(id) = parse_created_session_event(&event) else {
                            continue;
                        };
                        let Some(session) = weak.upgrade() else {
                            return;
                        };
                        if session.deleting.load(Ordering::Acquire) {
                            return;
                        }
                        session.assign_upstream_session_id(id);
                        return;
                    }
                }
                if retry_or_stop(&mut events).await {
                    return;
                }
            }
        });
    }

    fn start_reader(session: &Arc<Self>, mut reader: Box<dyn Read + Send>) {
        let weak = Arc::downgrade(session);
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut pending = Vec::new();
            while let Ok(length) = reader.read(&mut buffer) {
                if length == 0 {
                    if !pending.is_empty()
                        && let Some(session) = weak.upgrade()
                    {
                        session.publish_output(String::from_utf8_lossy(&pending).into_owned());
                    }
                    break;
                }
                pending.extend_from_slice(&buffer[..length]);
                let valid_length = match std::str::from_utf8(&pending) {
                    Ok(_) => pending.len(),
                    Err(error) if error.error_len().is_none() => error.valid_up_to(),
                    Err(error) => error
                        .valid_up_to()
                        .saturating_add(error.error_len().unwrap_or(0)),
                };
                if valid_length == 0 {
                    continue;
                }
                let Some(session) = weak.upgrade() else {
                    break;
                };
                let data = String::from_utf8_lossy(&pending[..valid_length]).into_owned();
                pending.drain(..valid_length);
                session.publish_output(data);
            }
        });
    }

    fn publish_output(&self, data: String) {
        let mut state = self.state.lock().expect("session lock poisoned");
        state.updated_at = now();
        state.output.push_str(&data);
        trim_output(&mut state.output);
        let _ = self.events.send(SessionEvent::Output(data));
    }

    fn start_waiter(
        session: &Arc<Self>,
        mut child: Box<dyn portable_pty::Child + Send>,
        app_state: Arc<AppState>,
    ) {
        let weak = Arc::downgrade(session);
        let id = session.id.clone();
        let kind = session.kind;
        std::thread::spawn(move || {
            let status = child.wait();
            let Some(session) = weak.upgrade() else {
                return;
            };
            let code = status.ok().map(|status| status.exit_code());
            {
                let mut state = session.state.lock().expect("session lock poisoned");
                state.status = SessionStatus::Exited;
                state.exit_code = code;
                state.updated_at = now();
            }
            let _ = session.events.send(SessionEvent::Exit(code));
            if kind == SessionKind::Agent {
                let mut sessions = app_state.sessions.write().expect("sessions lock poisoned");
                if sessions
                    .get(&id)
                    .is_some_and(|current| Arc::ptr_eq(current, &session))
                {
                    sessions.shift_remove(&id);
                }
                drop(sessions);
                session.deleting.store(true, Ordering::Release);
                let _ = session.events.send(SessionEvent::Removed(code));
            }
        });
    }

    fn view(&self) -> SessionView {
        let state = self.state.lock().expect("session lock poisoned");
        self.view_from_state(&state)
    }

    fn view_from_state(&self, state: &SessionState) -> SessionView {
        SessionView {
            id: self.id.clone(),
            name: state.name.clone(),
            cwd: state.cwd.clone(),
            shell: self.shell.clone(),
            status: state.status,
            cols: state.cols,
            rows: state.rows,
            created_at: state.created_at,
            updated_at: state.updated_at,
            exit_code: state.exit_code,
            agent_id: (self.kind == SessionKind::Agent).then_some(OPENCODE_AGENT_ID),
            agent_name: (self.kind == SessionKind::Agent).then_some(OPENCODE_AGENT_NAME),
            upstream_session_id: self
                .upstream_session_id
                .read()
                .expect("upstream session lock poisoned")
                .clone(),
            kind: if self.kind == SessionKind::Agent {
                "agent"
            } else {
                "terminal"
            },
        }
    }

    fn terminate(&self) {
        if self.state.lock().expect("session lock poisoned").status == SessionStatus::Running {
            let _ = self.killer.lock().expect("killer lock poisoned").kill();
        }
        let _ = self.events.send(SessionEvent::Terminate);
    }
}

async fn handle_socket(
    mut socket: WebSocket,
    session: Arc<TerminalSession>,
    app_state: Arc<AppState>,
) {
    let mut events = session.events.subscribe();
    let registered = app_state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .get(&session.id)
        .is_some_and(|current| Arc::ptr_eq(current, &session));
    if !registered || session.deleting.load(Ordering::Acquire) {
        let _ = socket
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: 1000,
                reason: "session terminated".into(),
            })))
            .await;
        return;
    }
    let (mut sender, mut receiver) = socket.split();
    let (view, snapshot, status, code) = {
        let state = session.state.lock().expect("session lock poisoned");
        (
            session.view_from_state(&state),
            state.output.clone(),
            state.status,
            state.exit_code,
        )
    };
    if send_json(
        &mut sender,
        serde_json::json!({ "type": "ready", "terminal": view }),
    )
    .await
    .is_err()
    {
        return;
    }
    if send_json(
        &mut sender,
        serde_json::json!({ "type": "snapshot", "data": snapshot }),
    )
    .await
    .is_err()
    {
        return;
    }
    if status == SessionStatus::Exited
        && send_json(
            &mut sender,
            serde_json::json!({ "type": "exit", "code": code }),
        )
        .await
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            message = receiver.next() => {
                let Some(Ok(message)) = message else { break };
                if !handle_client_message(&session, &mut sender, message).await { break; }
            }
            event = events.recv() => {
                match event {
                    Ok(SessionEvent::Output(data)) => {
                        if send_json(&mut sender, serde_json::json!({ "type": "output", "data": data })).await.is_err() { break; }
                    }
                    Ok(SessionEvent::Exit(code)) => {
                        if send_json(&mut sender, serde_json::json!({ "type": "exit", "code": code })).await.is_err() { break; }
                    }
                    Ok(SessionEvent::Removed(code)) => {
                        let _ = send_json(&mut sender, serde_json::json!({ "type": "removed", "reason": "processExited", "code": code })).await;
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame { code: 1000, reason: "process exited".into() }))).await;
                        break;
                    }
                    Ok(SessionEvent::Terminate) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1000,
                            reason: "session terminated".into(),
                        }))).await;
                        break;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1011,
                            reason: "terminal output resync required".into(),
                        }))).await;
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn handle_client_message(
    session: &TerminalSession,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: Message,
) -> bool {
    let Message::Text(text) = message else {
        return !matches!(message, Message::Close(_));
    };
    let Ok(message) = serde_json::from_str::<ClientMessage>(&text) else {
        return true;
    };
    match message {
        ClientMessage::Input { data } => {
            if let Some(data) = data.as_str().filter(|data| data.len() <= 64 * 1024) {
                let running = !session.deleting.load(Ordering::Acquire)
                    && session.state.lock().expect("session lock poisoned").status
                        == SessionStatus::Running;
                if running {
                    let _ = session
                        .writer
                        .lock()
                        .expect("writer lock poisoned")
                        .write_all(data.as_bytes());
                }
            }
        }
        ClientMessage::Resize { cols, rows } => {
            let (cols, rows, running) = {
                let mut state = session.state.lock().expect("session lock poisoned");
                let cols = dimension(Some(&cols), state.cols);
                let rows = dimension(Some(&rows), state.rows);
                state.cols = cols;
                state.rows = rows;
                state.updated_at = now();
                (
                    cols,
                    rows,
                    !session.deleting.load(Ordering::Acquire)
                        && state.status == SessionStatus::Running,
                )
            };
            if running {
                let _ = session
                    .master
                    .lock()
                    .expect("master lock poisoned")
                    .resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
            }
        }
        ClientMessage::Ping => {
            return send_json(sender, serde_json::json!({ "type": "pong" }))
                .await
                .is_ok();
        }
    }
    true
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    value: serde_json::Value,
) -> Result<(), axum::Error> {
    sender.send(Message::Text(value.to_string().into())).await
}

fn valid_origin(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get("host").and_then(|value| value.to_str().ok()) else {
        return false;
    };
    if !matches!(host, "127.0.0.1:4173" | "localhost:4173") {
        return false;
    }
    let Some(origin) = headers.get("origin") else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .and_then(|value| value.split('/').next())
        == Some(host)
}

fn dimension(value: Option<&serde_json::Value>, fallback: u16) -> u16 {
    let number = value
        .and_then(value_to_number)
        .unwrap_or(f64::from(fallback));
    if !number.is_finite() {
        return fallback;
    }
    number.trunc().clamp(1.0, 500.0) as u16
}

fn value_to_number(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(value) => value.trim().parse().ok().or_else(|| {
            if value.trim().is_empty() {
                Some(0.0)
            } else {
                None
            }
        }),
        serde_json::Value::Bool(value) => Some(u8::from(*value).into()),
        serde_json::Value::Null => Some(0.0),
        _ => None,
    }
}

fn trim_output(output: &mut String) {
    if output.len() <= OUTPUT_LIMIT {
        return;
    }
    let mut start = output.len() - OUTPUT_LIMIT;
    while !output.is_char_boundary(start) {
        start += 1;
    }
    output.drain(..start);
}

pub(crate) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn npm_default_editor() -> bool {
    env::var_os("npm_lifecycle_event").is_some()
        && env::var("EDITOR").as_deref() == Ok("vi")
        && env::var_os("VISUAL").is_none()
}

fn resolve_shell() -> String {
    env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
}

pub fn default_cwd() -> String {
    env::var("DEVHATCH_CWD").unwrap_or_else(|_| path_string(home_dir()))
}

fn opencode_available() -> bool {
    env::var_os("PATH").is_some_and(|paths| {
        env::split_paths(&paths).any(|path| {
            let executable = path.join("opencode");
            executable.is_file()
        })
    })
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

fn parse_created_session_event(event: &[u8]) -> Option<String> {
    let event = std::str::from_utf8(event).ok()?.replace("\r\n", "\n");
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    let value = serde_json::from_str::<serde_json::Value>(&data).ok()?;
    if value.get("type").and_then(serde_json::Value::as_str) != Some("session.created") {
        return None;
    }
    let info = value
        .get("properties")
        .and_then(|properties| properties.get("info"))?;
    if info
        .get("parentID")
        .is_some_and(|parent_id| !parent_id.is_null())
    {
        return None;
    }
    let id = value
        .get("properties")
        .and_then(|properties| properties.get("sessionID"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| info.get("id").and_then(serde_json::Value::as_str));
    id.filter(|id| valid_upstream_session_id(id))
        .map(str::to_string)
}

async fn session_stopped(events: &mut broadcast::Receiver<SessionEvent>) {
    loop {
        match events.recv().await {
            Ok(SessionEvent::Exit(_) | SessionEvent::Removed(_) | SessionEvent::Terminate) => {
                return;
            }
            Ok(SessionEvent::Output(_)) | Err(broadcast::error::RecvError::Lagged(_)) => {}
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

fn valid_upstream_session_id(value: &str) -> bool {
    let suffix = value.strip_prefix("ses_");
    matches!(suffix, Some(value) if !value.is_empty() && value.len() <= 124 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{parse_created_session_event, sse_event_end, valid_upstream_session_id};

    #[test]
    fn parses_root_session_created_events() {
        let event = b"data: {\"type\":\"session.created\",\"properties\":{\"info\":{\"id\":\"ses_abc-123_X\",\"parentID\":null}}}\r\n\r\n";
        assert_eq!(
            parse_created_session_event(event),
            Some("ses_abc-123_X".to_string())
        );
        assert_eq!(sse_event_end(event), Some((event.len() - 4, 4)));

        let child = b"data: {\"type\":\"session.created\",\"properties\":{\"info\":{\"id\":\"ses_child\",\"parentID\":\"ses_parent\"}}}\n\n";
        assert_eq!(parse_created_session_event(child), None);

        let current = b"data: {\"type\":\"session.created\",\"properties\":{\"sessionID\":\"ses_current\",\"info\":{\"parentID\":null}}}\n\n";
        assert_eq!(
            parse_created_session_event(current),
            Some("ses_current".to_string())
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
