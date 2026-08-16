use std::{
    env,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
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
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::filesystem::{home_dir, path_string, resolve_path};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;
const OUTPUT_LIMIT: usize = 512 * 1024;

pub struct AppState {
    sessions: RwLock<IndexMap<String, Arc<TerminalSession>>>,
    data_dir: PathBuf,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            sessions: RwLock::new(IndexMap::new()),
            data_dir,
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

    fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }
}

struct TerminalSession {
    id: String,
    shell: String,
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
}

#[derive(Clone)]
enum SessionEvent {
    Output(String),
    Exit(Option<u32>),
    Terminate,
}

#[derive(Default, Deserialize)]
pub(crate) struct CreateRequest {
    cwd: Option<serde_json::Value>,
    cols: Option<serde_json::Value>,
    rows: Option<serde_json::Value>,
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

pub async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let _ = state.data_dir();
    Json(serde_json::json!({
        "ok": true,
        "sessions": state.sessions.read().expect("sessions lock poisoned").len()
    }))
}

pub async fn list(State(state): State<Arc<AppState>>) -> Response {
    let sessions = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .values()
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
    match TerminalSession::spawn(request) {
        Ok(session) => {
            let view = session.view();
            state
                .sessions
                .write()
                .expect("sessions lock poisoned")
                .insert(session.id.clone(), session);
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
    let Some(session) = session else {
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
    let session = state
        .sessions
        .write()
        .expect("sessions lock poisoned")
        .shift_remove(&id);
    let Some(session) = session else {
        return error(StatusCode::NOT_FOUND, "TERMINAL_NOT_FOUND");
    };
    session.deleting.store(true, Ordering::Release);
    session.terminate();
    StatusCode::NO_CONTENT.into_response()
}

pub async fn socket(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !valid_origin(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let session = state
        .sessions
        .read()
        .expect("sessions lock poisoned")
        .get(&id)
        .cloned();
    let Some(session) = session else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let socket_state = state.clone();
    upgrade.on_upgrade(move |socket| handle_socket(socket, session, socket_state))
}

impl TerminalSession {
    fn spawn(request: CreateRequest) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        let fallback_cwd = default_cwd();
        let requested_cwd = request
            .cwd
            .as_ref()
            .and_then(serde_json::Value::as_str)
            .unwrap_or(&fallback_cwd);
        let requested_cwd = resolve_path(requested_cwd)?;
        let cwd = if requested_cwd.exists() {
            requested_cwd
        } else {
            PathBuf::from(&fallback_cwd)
        };
        let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
        let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
        let shell = resolve_shell();
        let pair = NativePtySystem::default().openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let mut command = CommandBuilder::new(&shell);
        command.arg("-l");
        command.cwd(&cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if npm_default_editor() {
            command.env_remove("EDITOR");
        }
        let child = pair.slave.spawn_command(command)?;
        let killer = child.clone_killer();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let timestamp = now();
        let cwd_string = path_string(&cwd);
        let name = cwd
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("Terminal")
            .to_string();
        let (events, _) = broadcast::channel(1024);
        let session = Arc::new(Self {
            id: Uuid::new_v4().to_string(),
            shell,
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
        Self::start_reader(&session, reader);
        Self::start_waiter(&session, child);
        Ok(session)
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

    fn start_waiter(session: &Arc<Self>, mut child: Box<dyn portable_pty::Child + Send>) {
        let weak = Arc::downgrade(session);
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
                let _ = session.events.send(SessionEvent::Exit(code));
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
    let (view, snapshot, status, code, mut events) = {
        let state = session.state.lock().expect("session lock poisoned");
        (
            session.view_from_state(&state),
            state.output.clone(),
            state.status,
            state.exit_code,
            session.events.subscribe(),
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
    let Some(origin) = headers.get("origin") else {
        return true;
    };
    let Some(host) = headers.get("host") else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(host) = host.to_str() else {
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

fn now() -> u64 {
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

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}
