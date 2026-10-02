use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::SyncSender,
    },
    time::Duration,
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex as AsyncMutex, broadcast, watch};

#[derive(Clone)]
pub(super) struct SessionCompletion {
    completed: watch::Sender<bool>,
}

impl Default for SessionCompletion {
    fn default() -> Self {
        let (completed, _) = watch::channel(false);
        Self { completed }
    }
}

impl SessionCompletion {
    pub(super) fn complete(&self) {
        self.completed.send_replace(true);
    }

    pub(super) async fn wait(&self) {
        let mut completed = self.completed.subscribe();
        if *completed.borrow() {
            return;
        }
        while completed.changed().await.is_ok() {
            if *completed.borrow() {
                return;
            }
        }
    }
}

pub(crate) struct Session {
    pub(super) id: String,
    pub(super) shell: String,
    pub(super) kind: SessionKind,
    pub(super) identity: Mutex<SessionIdentity>,
    pub(super) process_id: u32,
    pub(super) process_identity: Option<crate::process::ChildIdentity>,
    pub(super) state: Mutex<SessionState>,
    pub(super) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(super) input: Mutex<Option<SyncSender<Vec<u8>>>>,
    pub(super) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(super) deleting: AtomicBool,
    pub(super) terminating: AtomicBool,
    pub(super) completion: SessionCompletion,
    pub(super) events: broadcast::Sender<SessionEvent>,
    pub(super) agent_events: broadcast::Sender<AgentActivityEvent>,
    pub(super) agent_event_sequence: Arc<AtomicU64>,
    pub(super) agent_event_lock: Arc<Mutex<()>>,
    pub(super) agent_id: Option<&'static str>,
    pub(super) agent_name: Option<&'static str>,
    pub(super) runtime_dir: Option<PathBuf>,
    pub(super) runtime_endpoint: Mutex<Option<RuntimeEndpoint>>,
    pub(super) runtime_endpoint_ready: tokio::sync::Notify,
    pub(crate) runtime_input: Arc<AsyncMutex<()>>,
}

pub(crate) type SessionExitCleanup = Box<dyn FnOnce(Arc<Session>, Option<u32>) + Send>;

#[derive(Clone)]
pub(crate) struct RuntimeEndpoint {
    pub(crate) port: u16,
    pub(crate) password: String,
}

pub(crate) struct SessionSpawn {
    pub command: CommandBuilder,
    pub shell: String,
    pub kind: SessionKind,
    pub upstream_session_id: Option<String>,
    pub pending_upstream_session_id: Option<String>,
    pub cwd: PathBuf,
    pub name: String,
    pub cols: u16,
    pub rows: u16,
    pub agent_id: Option<&'static str>,
    pub agent_name: Option<&'static str>,
    pub cleanup_path: Option<PathBuf>,
    pub runtime_endpoint: Option<RuntimeEndpoint>,
    pub exit_cleanup: Option<SessionExitCleanup>,
}

pub(super) struct SessionIdentity {
    pub upstream_session_id: Option<String>,
    pub pending_upstream_session_id: Option<String>,
    pub upstream_session_file: Option<PathBuf>,
    pub cwd: String,
}

#[derive(Default)]
pub(super) struct TerminalModes {
    focus_events: bool,
    unicode_mode: bool,
    color_scheme_notifications: bool,
}

impl vt100::Callbacks for TerminalModes {
    fn unhandled_csi(
        &mut self,
        _: &mut vt100::Screen,
        first_intermediate: Option<u8>,
        _: Option<u8>,
        params: &[&[u16]],
        action: char,
    ) {
        if first_intermediate != Some(b'?') || !matches!(action, 'h' | 'l') {
            return;
        }
        let enabled = action == 'h';
        for mode in params.iter().filter_map(|param| param.first()) {
            match mode {
                1004 => self.focus_events = enabled,
                2027 => self.unicode_mode = enabled,
                2031 => self.color_scheme_notifications = enabled,
                _ => {}
            }
        }
    }
}

#[derive(Clone, Copy, Default)]
enum TerminalSequenceState {
    #[default]
    Ground,
    Escape,
    Csi,
    Osc,
    OscEscape,
    String,
    StringEscape,
}

pub(super) struct TerminalState {
    parser: vt100::Parser<TerminalModes>,
    sequence_state: TerminalSequenceState,
    pending_sequence: Vec<u8>,
}

impl TerminalState {
    pub(super) fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: vt100::Parser::new_with_callbacks(rows, cols, 0, TerminalModes::default()),
            sequence_state: TerminalSequenceState::Ground,
            pending_sequence: Vec::new(),
        }
    }

    pub(super) fn process(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
        for &byte in bytes {
            self.process_sequence_byte(byte);
        }
    }

    pub(super) fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.screen_mut().set_size(rows, cols);
    }

    pub(super) fn snapshot(&self) -> String {
        let screen = self.parser.screen();
        let mut output = Vec::new();
        if screen.alternate_screen() {
            output.extend_from_slice(b"\x1b[?1049h");
        }
        output.extend(screen.state_formatted());
        let modes = self.parser.callbacks();
        if modes.focus_events {
            output.extend_from_slice(b"\x1b[?1004h");
        }
        if modes.unicode_mode {
            output.extend_from_slice(b"\x1b[?2027h");
        }
        if modes.color_scheme_notifications {
            output.extend_from_slice(b"\x1b[?2031h");
        }
        output.extend_from_slice(&self.pending_sequence);
        String::from_utf8_lossy(&output).into_owned()
    }

    fn process_sequence_byte(&mut self, byte: u8) {
        use TerminalSequenceState::{Csi, Escape, Ground, Osc, OscEscape, String, StringEscape};

        match self.sequence_state {
            Ground => {
                if byte == 0x1b {
                    self.start_sequence(Escape, byte);
                }
            }
            Escape => {
                self.pending_sequence.push(byte);
                self.sequence_state = match byte {
                    b'[' => Csi,
                    b']' => Osc,
                    b'P' | b'X' | b'^' | b'_' => String,
                    0x1b => {
                        self.pending_sequence.clear();
                        self.pending_sequence.push(byte);
                        Escape
                    }
                    0x20..=0x2f => Escape,
                    _ => Ground,
                };
                if matches!(self.sequence_state, Ground) {
                    self.pending_sequence.clear();
                }
            }
            Csi => {
                self.pending_sequence.push(byte);
                if byte == 0x1b {
                    self.pending_sequence.clear();
                    self.pending_sequence.push(byte);
                    self.sequence_state = Escape;
                } else if (0x40..=0x7e).contains(&byte) {
                    self.pending_sequence.clear();
                    self.sequence_state = Ground;
                }
            }
            Osc => {
                self.pending_sequence.push(byte);
                if matches!(byte, 0x07 | 0x9c) {
                    self.pending_sequence.clear();
                    self.sequence_state = Ground;
                } else if byte == 0x1b {
                    self.sequence_state = OscEscape;
                }
            }
            OscEscape => {
                self.pending_sequence.push(byte);
                if byte == b'\\' {
                    self.pending_sequence.clear();
                    self.sequence_state = Ground;
                } else if byte != 0x1b {
                    self.sequence_state = Osc;
                }
            }
            String => {
                self.pending_sequence.push(byte);
                if byte == 0x9c {
                    self.pending_sequence.clear();
                    self.sequence_state = Ground;
                } else if byte == 0x1b {
                    self.sequence_state = StringEscape;
                }
            }
            StringEscape => {
                self.pending_sequence.push(byte);
                if byte == b'\\' {
                    self.pending_sequence.clear();
                    self.sequence_state = Ground;
                } else if byte != 0x1b {
                    self.sequence_state = String;
                }
            }
        }
    }

    fn start_sequence(&mut self, state: TerminalSequenceState, byte: u8) {
        self.pending_sequence.clear();
        self.pending_sequence.push(byte);
        self.sequence_state = state;
    }
}

pub(super) struct SessionState {
    pub name: String,
    pub status: SessionStatus,
    pub cols: u16,
    pub rows: u16,
    pub created_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<u32>,
    pub output: String,
    pub terminal: Option<TerminalState>,
    pub agent_activity: Option<AgentActivity>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SessionKind {
    Terminal,
    Agent,
}

impl SessionKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Terminal => "terminal",
            Self::Agent => "agent",
        }
    }

    pub(crate) fn from_str(value: &str) -> Option<Self> {
        match value {
            "terminal" => Some(Self::Terminal),
            "agent" => Some(Self::Agent),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SessionStatus {
    Running,
    Exited,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentActivity {
    pub status: AgentActivityStatus,
    pub phase: AgentActivityPhase,
    pub detail: Option<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentActivityEvent {
    #[serde(skip)]
    pub(crate) sequence: u64,
    pub session_id: String,
    pub activity: Option<AgentActivity>,
    pub updated_at: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AgentActivityStatus {
    Idle,
    Busy,
    Retry,
    Waiting,
    Error,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AgentActivityPhase {
    Idle,
    Thinking,
    Tool,
    Permission,
    Question,
    Retry,
    Error,
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

impl SessionView {
    #[cfg(test)]
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

pub(crate) struct SessionSnapshot {
    pub view: SessionView,
    pub output: String,
    pub activity: Option<AgentActivity>,
    pub status: SessionStatus,
    pub exit_code: Option<u32>,
}

#[derive(Clone)]
pub(crate) enum SessionEvent {
    Output(Arc<str>),
    UpstreamSessionChanged { id: String, cwd: String },
    AgentActivity(AgentActivity),
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

    pub(crate) fn agent_id(&self) -> Option<&'static str> {
        self.agent_id
    }

    pub(crate) fn runtime_dir(&self) -> Option<PathBuf> {
        self.runtime_dir.clone()
    }

    pub(crate) fn runtime_endpoint(&self) -> Option<RuntimeEndpoint> {
        self.runtime_endpoint
            .lock()
            .expect("runtime endpoint lock poisoned")
            .clone()
    }

    pub(crate) async fn ready_runtime_endpoint(
        &self,
        timeout: Duration,
    ) -> Option<RuntimeEndpoint> {
        let ready = self.runtime_endpoint_ready.notified();
        tokio::pin!(ready);
        ready.as_mut().enable();
        if let Some(endpoint) = self
            .runtime_endpoint()
            .filter(|endpoint| endpoint.port != 0)
        {
            return Some(endpoint);
        }
        tokio::time::timeout(timeout, ready).await.ok()?;
        self.runtime_endpoint()
            .filter(|endpoint| endpoint.port != 0)
    }

    pub(crate) fn update_pi_port(&self, port: u16) {
        if self.agent_id != Some(crate::agent::PI_ID) {
            return;
        }
        if let Some(endpoint) = self
            .runtime_endpoint
            .lock()
            .expect("runtime endpoint lock poisoned")
            .as_mut()
        {
            endpoint.port = port;
            if port != 0 {
                self.runtime_endpoint_ready.notify_waiters();
            }
        }
    }

    pub(crate) fn process_id(&self) -> u32 {
        self.process_id
    }

    pub(crate) fn upstream_session_id(&self) -> Option<String> {
        self.identity
            .lock()
            .expect("session identity lock poisoned")
            .upstream_session_id
            .clone()
    }

    pub(crate) fn pending_upstream_session_id(&self) -> Option<String> {
        self.identity
            .lock()
            .expect("session identity lock poisoned")
            .pending_upstream_session_id
            .clone()
    }

    pub(crate) fn upstream_session_file(&self) -> Option<PathBuf> {
        self.identity
            .lock()
            .expect("session identity lock poisoned")
            .upstream_session_file
            .clone()
    }

    pub(crate) fn cwd(&self) -> String {
        self.identity
            .lock()
            .expect("session identity lock poisoned")
            .cwd
            .clone()
    }

    pub(crate) fn correlation_details(&self) -> (String, i64) {
        let cwd = self
            .identity
            .lock()
            .expect("session identity lock poisoned")
            .cwd
            .clone();
        let created_at = self.state.lock().expect("session lock poisoned").created_at as i64;
        (cwd, created_at)
    }

    pub(crate) fn update_runtime_identity(
        &self,
        id: String,
        file: Option<PathBuf>,
        cwd: Option<PathBuf>,
    ) {
        let cwd = cwd.map(crate::filesystem::path_string);
        let mut identity = self
            .identity
            .lock()
            .expect("session identity lock poisoned");
        let id_changed = identity.upstream_session_id.as_deref() != Some(&id);
        let cwd_changed = cwd.as_deref().is_some_and(|cwd| identity.cwd != cwd);
        let file_changed = identity.upstream_session_file != file;
        if !id_changed && !cwd_changed && !file_changed {
            return;
        }
        identity.upstream_session_id = Some(id.clone());
        identity.pending_upstream_session_id = None;
        identity.upstream_session_file = file;
        if let Some(cwd) = cwd {
            identity.cwd = cwd;
        }
        let cwd = identity.cwd.clone();
        drop(identity);
        let _event = id_changed.then(|| {
            self.agent_event_lock
                .lock()
                .expect("agent activity event lock poisoned")
        });
        let mut state = self.state.lock().expect("session lock poisoned");
        if id_changed {
            state.agent_activity = None;
        }
        state.updated_at = crate::clock::now().max(state.updated_at.saturating_add(1));
        if id_changed {
            let _ = self.agent_events.send(AgentActivityEvent {
                sequence: self.agent_event_sequence.fetch_add(1, Ordering::AcqRel) + 1,
                session_id: self.id.clone(),
                activity: None,
                updated_at: state.updated_at,
            });
        }
        drop(state);
        let _ = self
            .events
            .send(SessionEvent::UpstreamSessionChanged { id, cwd });
    }

    pub(crate) fn publish_agent_activity(
        &self,
        status: AgentActivityStatus,
        phase: AgentActivityPhase,
        detail: Option<String>,
    ) {
        let activity = {
            let _event = self
                .agent_event_lock
                .lock()
                .expect("agent activity event lock poisoned");
            let mut state = self.state.lock().expect("session lock poisoned");
            if self.deleting.load(Ordering::Acquire) {
                return;
            }
            let activity = AgentActivity {
                status,
                phase,
                detail,
                updated_at: crate::clock::now().max(state.updated_at.saturating_add(1)),
            };
            if state.agent_activity.as_ref().is_some_and(|current| {
                current.status == activity.status
                    && current.phase == activity.phase
                    && current.detail == activity.detail
            }) {
                return;
            }
            state.agent_activity = Some(activity.clone());
            state.updated_at = activity.updated_at;
            let _ = self.agent_events.send(AgentActivityEvent {
                sequence: self.agent_event_sequence.fetch_add(1, Ordering::AcqRel) + 1,
                session_id: self.id.clone(),
                updated_at: activity.updated_at,
                activity: Some(activity.clone()),
            });
            activity
        };
        let _ = self.events.send(SessionEvent::AgentActivity(activity));
    }

    pub(crate) fn agent_activity_event(&self, sequence: u64) -> AgentActivityEvent {
        let state = self.state.lock().expect("session lock poisoned");
        let activity = state.agent_activity.clone();
        let updated_at = activity
            .as_ref()
            .map_or(state.updated_at, |activity| activity.updated_at);
        AgentActivityEvent {
            sequence,
            session_id: self.id.clone(),
            activity,
            updated_at,
        }
    }

    pub(crate) fn rename(&self, name: String) {
        let mut state = self.state.lock().expect("session lock poisoned");
        state.name = name;
        state.updated_at = crate::clock::now().max(state.updated_at.saturating_add(1));
    }

    pub(crate) fn view(&self) -> SessionView {
        let identity = self
            .identity
            .lock()
            .expect("session identity lock poisoned");
        let state = self.state.lock().expect("session lock poisoned");
        self.view_from_state(&state, &identity)
    }

    #[cfg(test)]
    pub(crate) fn live_view(&self) -> Option<SessionView> {
        let identity = self
            .identity
            .lock()
            .expect("session identity lock poisoned");
        let state = self.state.lock().expect("session lock poisoned");
        (!self.is_deleting() && state.status == SessionStatus::Running)
            .then(|| self.view_from_state(&state, &identity))
    }

    pub(crate) fn snapshot_and_subscribe(
        &self,
    ) -> (SessionSnapshot, broadcast::Receiver<SessionEvent>) {
        let identity = self
            .identity
            .lock()
            .expect("session identity lock poisoned");
        let state = self.state.lock().expect("session lock poisoned");
        let events = self.events.subscribe();
        let snapshot = SessionSnapshot {
            view: self.view_from_state(&state, &identity),
            output: state
                .terminal
                .as_ref()
                .map(TerminalState::snapshot)
                .unwrap_or_else(|| state.output.clone()),
            activity: state.agent_activity.clone(),
            status: state.status,
            exit_code: state.exit_code,
        };
        (snapshot, events)
    }

    pub(crate) fn subscribe(&self) -> broadcast::Receiver<SessionEvent> {
        self.events.subscribe()
    }

    pub(crate) fn publish_removed(&self, code: Option<u32>) {
        let _ = self.events.send(SessionEvent::Removed(code));
    }

    pub(crate) async fn wait_for_completion(&self) {
        self.completion.wait().await;
    }

    fn view_from_state(&self, state: &SessionState, identity: &SessionIdentity) -> SessionView {
        SessionView {
            id: self.id.clone(),
            name: state.name.clone(),
            cwd: identity.cwd.clone(),
            shell: self.shell.clone(),
            status: state.status,
            cols: state.cols,
            rows: state.rows,
            created_at: state.created_at,
            updated_at: state.updated_at,
            exit_code: state.exit_code,
            agent_id: self.agent_id,
            agent_name: self.agent_name,
            upstream_session_id: identity.upstream_session_id.clone(),
            kind: if self.kind == SessionKind::Agent {
                "agent"
            } else {
                "terminal"
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use super::{SessionCompletion, SessionEvent, TerminalModes, TerminalState};

    #[test]
    fn terminal_snapshot_restores_alternate_screen_and_input_modes() {
        let mut terminal = TerminalState::new(3, 12);
        terminal.process(
            b"primary\x1b[?1049h\x1b[2J\x1b[Hhello\x1b[2;3Hworld\x1b[?1004h\x1b[?2004h\x1b[?2026h\x1b[?2027h\x1b[?2031h",
        );

        let snapshot = terminal.snapshot();
        let mut restored = vt100::Parser::new_with_callbacks(3, 12, 0, TerminalModes::default());
        restored.process(snapshot.as_bytes());

        assert!(snapshot.starts_with("\x1b[?1049h"));
        assert!(!snapshot.contains("\x1b[?2026h"));
        assert!(restored.screen().alternate_screen());
        assert_eq!(restored.screen().contents(), "hello\n  world");
        assert!(restored.screen().bracketed_paste());
        assert!(restored.callbacks().focus_events);
        assert!(restored.callbacks().unicode_mode);
        assert!(restored.callbacks().color_scheme_notifications);
    }

    #[test]
    fn terminal_snapshot_restores_sparse_updates() {
        let mut terminal = TerminalState::new(3, 12);
        terminal.process(b"\x1b[?1049h\x1b[2J\x1b[Hfirst\x1b[2;1Hsecond\x1b[3;1Hthird");
        terminal.process(b"\x1b[2;1Hnext");

        let mut restored = vt100::Parser::new(3, 12, 0);
        restored.process(terminal.snapshot().as_bytes());

        assert_eq!(restored.screen().contents(), "first\nnextnd\nthird");
    }

    #[test]
    fn terminal_snapshot_preserves_an_incomplete_escape_sequence() {
        let mut terminal = TerminalState::new(2, 12);
        terminal.process(b"\x1b[?1049h\x1b[Hready\x1b[");
        let snapshot = terminal.snapshot();

        let mut restored = vt100::Parser::new(2, 12, 0);
        restored.process(snapshot.as_bytes());
        restored.process(b"2;1Hdone");

        assert_eq!(restored.screen().contents(), "ready\ndone");
    }

    #[tokio::test]
    async fn completion_waits_until_marked_and_remains_ready() {
        let completion = SessionCompletion::default();
        let waiter = tokio::spawn({
            let completion = completion.clone();
            async move { completion.wait().await }
        });
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());
        completion.complete();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(1), completion.wait())
            .await
            .unwrap();
    }

    #[test]
    fn output_broadcast_shares_data() {
        let (events, _) = tokio::sync::broadcast::channel(1);
        let mut first = events.subscribe();
        let mut second = events.subscribe();
        assert!(
            events
                .send(SessionEvent::Output(String::from("output").into()))
                .is_ok()
        );
        let SessionEvent::Output(first_data) = first.try_recv().unwrap() else {
            panic!("expected output event");
        };
        let SessionEvent::Output(second_data) = second.try_recv().unwrap() else {
            panic!("expected output event");
        };
        assert!(Arc::ptr_eq(&first_data, &second_data));
    }
}
