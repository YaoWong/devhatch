use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, RwLock},
};

use indexmap::IndexMap;
use skillink::Skillink;
use sqlx::SqlitePool;

use crate::{
    auth::AuthState,
    session::{Session, SessionKind, SessionView},
    web_app::WebAppManager,
};

pub struct AppState {
    sessions: RwLock<IndexMap<String, Arc<Session>>>,
    history_reconciliation: tokio::sync::Mutex<()>,
    terminal_workspace_lifecycle: tokio::sync::Mutex<()>,
    data_dir: PathBuf,
    pool: SqlitePool,
    history_pool: Option<SqlitePool>,
    web_apps: Arc<WebAppManager>,
    skillink: Skillink,
    auth: AuthState,
}

impl AppState {
    pub fn new(
        data_dir: PathBuf,
        pool: SqlitePool,
        history_pool: Option<SqlitePool>,
        skillink: Skillink,
        setup_token: Option<&str>,
    ) -> Self {
        let web_apps = Arc::new(WebAppManager::new(&data_dir));
        Self {
            sessions: RwLock::new(IndexMap::new()),
            history_reconciliation: tokio::sync::Mutex::new(()),
            terminal_workspace_lifecycle: tokio::sync::Mutex::new(()),
            data_dir,
            pool,
            history_pool,
            web_apps,
            skillink,
            auth: AuthState::new(setup_token),
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

    #[allow(dead_code)]
    pub fn active_upstream_session_ids(&self) -> HashSet<String> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == SessionKind::Agent)
            .filter_map(|session| session.upstream_session_id())
            .collect()
    }

    pub fn active_upstream_session_ids_for(&self, agent_id: &str) -> HashSet<String> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .filter_map(|session| session.upstream_session_id())
            .collect()
    }

    pub fn active_upstream_session_files_for(&self, agent_id: &str) -> HashSet<PathBuf> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .filter_map(|session| session.upstream_session_file())
            .collect()
    }

    pub fn active_agent_cwds_for(&self, agent_id: &str) -> HashSet<PathBuf> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .map(|session| PathBuf::from(session.correlation_details().0))
            .collect()
    }

    pub fn owned_process_ids(&self) -> HashSet<u32> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .map(|session| session.process_id())
            .collect()
    }

    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub(crate) fn history_pool(&self) -> Option<&SqlitePool> {
        self.history_pool.as_ref()
    }

    pub(crate) fn history_reconciliation(&self) -> &tokio::sync::Mutex<()> {
        &self.history_reconciliation
    }

    pub(crate) fn terminal_workspace_lifecycle(&self) -> &tokio::sync::Mutex<()> {
        &self.terminal_workspace_lifecycle
    }

    pub(crate) fn data_dir(&self) -> &PathBuf {
        &self.data_dir
    }

    pub(crate) fn web_apps(&self) -> Arc<WebAppManager> {
        self.web_apps.clone()
    }

    pub(crate) fn skillink(&self) -> &Skillink {
        &self.skillink
    }

    pub(crate) fn auth(&self) -> &AuthState {
        &self.auth
    }

    pub(crate) fn insert_session(&self, session: Arc<Session>) {
        self.sessions
            .write()
            .expect("sessions lock poisoned")
            .insert(session.id().to_string(), session);
    }

    pub(crate) fn session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .get(id)
            .filter(|session| session.kind() == kind)
            .cloned()
    }

    pub(crate) fn session_count(&self, kind: SessionKind) -> usize {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == kind)
            .count()
    }

    pub(crate) fn session_views(&self, kind: SessionKind) -> Vec<SessionView> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == kind)
            .map(|session| session.view())
            .collect()
    }

    pub(crate) fn terminal_cwds(&self) -> HashSet<String> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == SessionKind::Terminal)
            .map(|session| session.correlation_details().0)
            .collect()
    }

    pub(crate) fn has_terminal_cwd(&self, cwd: &str) -> bool {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .any(|session| {
                session.kind() == SessionKind::Terminal && session.correlation_details().0 == cwd
            })
    }

    pub(crate) fn contains_session(&self, session: &Arc<Session>) -> bool {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .get(session.id())
            .is_some_and(|current| Arc::ptr_eq(current, session))
    }

    pub(crate) fn remove_session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        sessions
            .get(id)
            .is_some_and(|session| session.kind() == kind)
            .then(|| sessions.shift_remove(id).expect("session must exist"))
    }

    pub(crate) fn remove_session_if_same(&self, id: &str, session: &Arc<Session>) {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        if sessions
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            sessions.shift_remove(id);
        }
    }
}
