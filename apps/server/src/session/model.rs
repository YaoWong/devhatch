use std::{
    path::PathBuf,
    sync::{Arc, Mutex, atomic::AtomicBool, mpsc::SyncSender},
};

use portable_pty::{ChildKiller, CommandBuilder, MasterPty};
use serde::Serialize;
use tokio::sync::{broadcast, watch};

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
    pub(super) completion: SessionCompletion,
    pub(super) events: broadcast::Sender<SessionEvent>,
    pub(super) agent_id: Option<&'static str>,
    pub(super) agent_name: Option<&'static str>,
}

pub(crate) type SessionExitCleanup = Box<dyn FnOnce(Arc<Session>, Option<u32>) + Send>;

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
    pub exit_cleanup: Option<SessionExitCleanup>,
}

pub(super) struct SessionIdentity {
    pub upstream_session_id: Option<String>,
    pub upstream_session_file: Option<PathBuf>,
    pub cwd: String,
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

impl SessionView {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
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
    UpstreamSessionChanged { id: String, cwd: String },
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

    pub(crate) fn upstream_session_file(&self) -> Option<PathBuf> {
        self.identity
            .lock()
            .expect("session identity lock poisoned")
            .upstream_session_file
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

    pub(crate) fn compare_and_update_upstream_session_id(
        &self,
        expected: Option<&str>,
        id: String,
    ) -> bool {
        let mut identity = self
            .identity
            .lock()
            .expect("session identity lock poisoned");
        if identity.upstream_session_id.as_deref() != expected {
            return false;
        }
        if identity.upstream_session_id.as_deref() == Some(&id) {
            return true;
        }
        identity.upstream_session_id = Some(id.clone());
        let cwd = identity.cwd.clone();
        drop(identity);
        self.state.lock().expect("session lock poisoned").updated_at = crate::clock::now();
        let _ = self
            .events
            .send(SessionEvent::UpstreamSessionChanged { id, cwd });
        true
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
        let mut upstream = identity.upstream_session_id.clone();
        let mut current_cwd = identity.cwd.clone();
        let identity_changed =
            merge_runtime_identity(&mut upstream, &mut current_cwd, &id, cwd.as_deref());
        let file_changed = file
            .as_ref()
            .is_some_and(|file| identity.upstream_session_file.as_ref() != Some(file));
        if !identity_changed && !file_changed {
            return;
        }
        identity.upstream_session_id = upstream;
        if let Some(file) = file {
            identity.upstream_session_file = Some(file);
        }
        identity.cwd = current_cwd;
        let cwd = identity.cwd.clone();
        drop(identity);
        self.state.lock().expect("session lock poisoned").updated_at = crate::clock::now();
        let _ = self
            .events
            .send(SessionEvent::UpstreamSessionChanged { id, cwd });
    }

    pub(crate) fn rename(&self, name: String) {
        let mut state = self.state.lock().expect("session lock poisoned");
        state.name = name;
        state.updated_at = crate::clock::now();
    }

    pub(crate) fn view(&self) -> SessionView {
        let identity = self
            .identity
            .lock()
            .expect("session identity lock poisoned");
        let state = self.state.lock().expect("session lock poisoned");
        self.view_from_state(&state, &identity)
    }

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
            output: state.output.clone(),
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

fn merge_runtime_identity(
    upstream: &mut Option<String>,
    current_cwd: &mut String,
    id: &str,
    cwd: Option<&str>,
) -> bool {
    let mut changed = false;
    if upstream.as_deref() != Some(id) {
        *upstream = Some(id.to_string());
        changed = true;
    }
    if let Some(cwd) = cwd
        && current_cwd != cwd
    {
        cwd.clone_into(current_cwd);
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{SessionCompletion, merge_runtime_identity};

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
    fn runtime_identity_updates_id_and_cwd() {
        let mut id = Some("old".to_string());
        let mut cwd = "/old".to_string();
        assert!(merge_runtime_identity(
            &mut id,
            &mut cwd,
            "new",
            Some("/new")
        ));
        assert_eq!(id.as_deref(), Some("new"));
        assert_eq!(cwd, "/new");
        assert!(!merge_runtime_identity(&mut id, &mut cwd, "new", None));
    }
}
