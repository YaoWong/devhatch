use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{clock::now, filesystem::path_string, state::AppState};

const OUTPUT_LIMIT: usize = 512 * 1024;

pub(crate) struct Session {
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
    agent_id: Option<&'static str>,
    agent_name: Option<&'static str>,
}

pub(crate) struct SessionSpawn {
    pub command: CommandBuilder,
    pub shell: String,
    pub kind: SessionKind,
    pub upstream_session_id: Option<String>,
    pub cwd: PathBuf,
    pub name: String,
    pub cols: u16,
    pub rows: u16,
    pub agent_id: Option<&'static str>,
    pub agent_name: Option<&'static str>,
    pub cleanup_path: Option<PathBuf>,
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
pub(crate) enum SessionKind {
    Terminal,
    Agent,
}

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SessionStatus {
    Running,
    Exited,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionView {
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

pub(crate) struct SessionSnapshot {
    pub view: SessionView,
    pub output: String,
    pub status: SessionStatus,
    pub exit_code: Option<u32>,
}

#[derive(Clone)]
pub(crate) enum SessionEvent {
    Output(String),
    Exit(Option<u32>),
    Removed(Option<u32>),
    Terminate,
}

impl Session {
    pub(crate) fn spawn<F>(
        app_state: Arc<AppState>,
        spawn: SessionSpawn,
        started: F,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error>>
    where
        F: FnOnce(&Arc<Self>),
    {
        let cleanup_path = spawn.cleanup_path.clone();
        let pair = NativePtySystem::default().openpty(PtySize {
            rows: spawn.rows,
            cols: spawn.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let child = pair.slave.spawn_command(spawn.command)?;
        let process_id = child.process_id().unwrap_or_default();
        let killer = child.clone_killer();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let timestamp = now();
        let (events, _) = broadcast::channel(1024);
        let session = Arc::new(Self {
            id: Uuid::new_v4().to_string(),
            shell: spawn.shell,
            kind: spawn.kind,
            upstream_session_id: RwLock::new(spawn.upstream_session_id),
            process_id,
            state: Mutex::new(SessionState {
                name: spawn.name,
                cwd: path_string(spawn.cwd),
                status: SessionStatus::Running,
                cols: spawn.cols,
                rows: spawn.rows,
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
            agent_id: spawn.agent_id,
            agent_name: spawn.agent_name,
        });
        app_state.insert_session(session.clone());
        Self::start_reader(&session, reader);
        started(&session);
        Self::start_waiter(&session, child, app_state, cleanup_path);
        Ok(session)
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn kind(&self) -> SessionKind {
        self.kind
    }

    pub(crate) fn process_id(&self) -> u32 {
        self.process_id
    }

    pub(crate) fn upstream_session_id(&self) -> Option<String> {
        self.upstream_session_id
            .read()
            .expect("upstream session lock poisoned")
            .clone()
    }

    pub(crate) fn correlation_details(&self) -> (String, i64) {
        let state = self.state.lock().expect("session lock poisoned");
        (state.cwd.clone(), state.created_at as i64)
    }

    pub(crate) fn assign_upstream_session_id(&self, id: String) {
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

    pub(crate) fn rename(&self, name: String) {
        let mut state = self.state.lock().expect("session lock poisoned");
        state.name = name;
        state.updated_at = now();
    }

    pub(crate) fn view(&self) -> SessionView {
        let state = self.state.lock().expect("session lock poisoned");
        self.view_from_state(&state)
    }

    pub(crate) fn snapshot_and_subscribe(
        &self,
    ) -> (SessionSnapshot, broadcast::Receiver<SessionEvent>) {
        let state = self.state.lock().expect("session lock poisoned");
        let events = self.events.subscribe();
        let snapshot = SessionSnapshot {
            view: self.view_from_state(&state),
            output: state.output.clone(),
            status: state.status,
            exit_code: state.exit_code,
        };
        (snapshot, events)
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.events.subscribe()
    }

    pub(crate) fn is_deleting(&self) -> bool {
        self.deleting.load(Ordering::Acquire)
    }

    pub(crate) fn mark_deleting(&self) {
        self.deleting.store(true, Ordering::Release);
    }

    pub(crate) fn write_input(&self, data: &str) {
        if !self.is_deleting()
            && self.state.lock().expect("session lock poisoned").status == SessionStatus::Running
        {
            let _ = self
                .writer
                .lock()
                .expect("writer lock poisoned")
                .write_all(data.as_bytes());
        }
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) {
        let running = {
            let mut state = self.state.lock().expect("session lock poisoned");
            state.cols = cols;
            state.rows = rows;
            state.updated_at = now();
            !self.is_deleting() && state.status == SessionStatus::Running
        };
        if running {
            let _ = self
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

    pub(crate) fn dimensions(&self) -> (u16, u16) {
        let state = self.state.lock().expect("session lock poisoned");
        (state.cols, state.rows)
    }

    pub(crate) fn terminate(&self) {
        if self.state.lock().expect("session lock poisoned").status == SessionStatus::Running {
            let _ = self.killer.lock().expect("killer lock poisoned").kill();
        }
        let _ = self.events.send(SessionEvent::Terminate);
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
            agent_id: self.agent_id,
            agent_name: self.agent_name,
            upstream_session_id: self.upstream_session_id(),
            kind: if self.kind == SessionKind::Agent {
                "agent"
            } else {
                "terminal"
            },
        }
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
        cleanup_path: Option<PathBuf>,
    ) {
        let weak = Arc::downgrade(session);
        let id = session.id.clone();
        let kind = session.kind;
        std::thread::spawn(move || {
            let status = child.wait();
            if let Some(path) = cleanup_path {
                let _ = std::fs::remove_dir_all(path);
            }
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
                app_state.remove_session_if_same(&id, &session);
                session.mark_deleting();
                let _ = session.events.send(SessionEvent::Removed(code));
            }
        });
    }
}

pub(crate) fn dimension(value: Option<&serde_json::Value>, fallback: u16) -> u16 {
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

#[cfg(test)]
mod tests {
    use super::{OUTPUT_LIMIT, dimension, trim_output};

    #[test]
    fn normalizes_dimensions() {
        assert_eq!(dimension(Some(&serde_json::json!(0)), 120), 1);
        assert_eq!(dimension(Some(&serde_json::json!(501)), 120), 500);
        assert_eq!(dimension(Some(&serde_json::json!(" 20.9 ")), 120), 20);
        assert_eq!(dimension(Some(&serde_json::json!([])), 120), 120);
    }

    #[test]
    fn trims_output_on_character_boundaries() {
        let mut output = format!("é{}", "x".repeat(OUTPUT_LIMIT));
        trim_output(&mut output);
        assert_eq!(output.len(), OUTPUT_LIMIT);
        assert!(output.is_char_boundary(0));
    }
}
