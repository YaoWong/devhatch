use std::{
    io::Write,
    path::PathBuf,
    sync::{Mutex, RwLock, atomic::AtomicBool},
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty};
use serde::Serialize;
use tokio::sync::broadcast;

pub(crate) struct Session {
    pub(super) id: String,
    pub(super) shell: String,
    pub(super) kind: SessionKind,
    pub(super) upstream_session_id: RwLock<Option<String>>,
    pub(super) process_id: u32,
    pub(super) state: Mutex<SessionState>,
    pub(super) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(super) writer: Mutex<Box<dyn Write + Send>>,
    pub(super) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(super) deleting: AtomicBool,
    pub(super) events: broadcast::Sender<SessionEvent>,
    pub(super) agent_id: Option<&'static str>,
    pub(super) agent_name: Option<&'static str>,
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

pub(super) struct SessionState {
    pub name: String,
    pub cwd: String,
    pub status: SessionStatus,
    pub cols: u16,
    pub rows: u16,
    pub created_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<u32>,
    pub output: String,
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
    UpstreamSessionChanged(String),
    Exit(Option<u32>),
    Removed(Option<u32>),
    Terminate,
}

impl Session {
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

    pub(crate) fn update_upstream_session_id(&self, id: String) {
        let mut upstream = self
            .upstream_session_id
            .write()
            .expect("upstream session lock poisoned");
        if upstream.as_deref() == Some(&id) {
            return;
        }
        *upstream = Some(id.clone());
        drop(upstream);
        self.state.lock().expect("session lock poisoned").updated_at = crate::clock::now();
        let _ = self.events.send(SessionEvent::UpstreamSessionChanged(id));
    }

    pub(crate) fn rename(&self, name: String) {
        let mut state = self.state.lock().expect("session lock poisoned");
        state.name = name;
        state.updated_at = crate::clock::now();
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
}
