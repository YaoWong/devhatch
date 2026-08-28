mod history;
mod sessions;

use std::{collections::HashSet, path::PathBuf, sync::Arc};

use skillink::Skillink;
use sqlx::SqlitePool;

use crate::{
    auth::AuthState,
    session::{Session, SessionKind, SessionView},
    web_app::WebAppManager,
};

pub(crate) use history::{HistoryCoordinator, HistoryPoolHandle, OpenCodeHistoryPool};
pub(crate) use sessions::SessionRegistry;

pub struct AppState {
    sessions: Arc<SessionRegistry>,
    history: Arc<HistoryCoordinator>,
    terminal_workspace_lifecycle: tokio::sync::Mutex<()>,
    data_dir: PathBuf,
    pool: SqlitePool,
    history_pool: OpenCodeHistoryPool,
    web_apps: Arc<WebAppManager>,
    skillink: Skillink,
    auth: AuthState,
}

impl AppState {
    pub fn new(
        data_dir: PathBuf,
        pool: SqlitePool,
        history_pool: OpenCodeHistoryPool,
        skillink: Skillink,
        setup_token: Option<&str>,
        secure_cookie: bool,
    ) -> Self {
        let web_apps = Arc::new(WebAppManager::new(&data_dir));
        Self {
            sessions: Arc::new(SessionRegistry::default()),
            history: Arc::new(HistoryCoordinator::default()),
            terminal_workspace_lifecycle: tokio::sync::Mutex::new(()),
            data_dir,
            pool,
            history_pool,
            web_apps,
            skillink,
            auth: AuthState::new(setup_token, secure_cookie),
        }
    }

    pub async fn shutdown_sessions(&self, timeout: std::time::Duration) -> bool {
        self.sessions.shutdown_all(timeout).await
    }

    #[allow(dead_code)]
    pub fn active_upstream_session_ids(&self) -> HashSet<String> {
        self.sessions.active_upstream_session_ids()
    }

    pub fn active_upstream_session_ids_for(&self, agent_id: &str) -> HashSet<String> {
        self.sessions.active_upstream_session_ids_for(agent_id)
    }

    pub fn active_upstream_session_files_for(&self, agent_id: &str) -> HashSet<PathBuf> {
        self.sessions.active_upstream_session_files_for(agent_id)
    }

    pub fn active_agent_cwds_for(&self, agent_id: &str) -> HashSet<PathBuf> {
        self.sessions.active_agent_cwds_for(agent_id)
    }

    pub fn owned_process_ids(&self) -> HashSet<u32> {
        self.sessions.owned_process_ids()
    }

    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub(crate) async fn history_pool(&self) -> Option<HistoryPoolHandle> {
        self.history_pool.get().await
    }

    pub(crate) async fn invalidate_history_pool(&self, handle: &HistoryPoolHandle) {
        self.history_pool.invalidate(handle).await;
    }

    pub(crate) fn history_reconciliation(&self) -> &tokio::sync::Mutex<()> {
        self.history.lock()
    }

    pub(crate) fn history_coordinator(&self) -> Arc<HistoryCoordinator> {
        self.history.clone()
    }

    pub(crate) fn history_deletion_pending(&self, agent_id: &str, id: &str) -> bool {
        self.history.deletion_pending(agent_id, id)
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

    pub(crate) fn session_registry(&self) -> Arc<SessionRegistry> {
        self.sessions.clone()
    }

    pub(crate) fn session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        self.sessions.session(id, kind)
    }

    pub(crate) fn session_count(&self, kind: SessionKind) -> usize {
        self.sessions.count(kind)
    }

    pub(crate) fn session_views(&self, kind: SessionKind) -> Vec<SessionView> {
        self.sessions.views(kind)
    }

    pub(crate) fn terminal_ids(&self) -> HashSet<String> {
        self.sessions.ids(SessionKind::Terminal)
    }

    pub(crate) fn contains_session(&self, session: &Arc<Session>) -> bool {
        self.sessions.contains(session)
    }

    pub(crate) fn remove_session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        self.sessions.remove(id, kind)
    }
}
