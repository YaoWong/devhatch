mod history;
mod sessions;
mod skill_repository_operation;

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
pub(crate) use skill_repository_operation::{
    SkillRepositoryOperationCoordinator, SkillRepositoryOperationKind,
};

pub struct AppState {
    sessions: Arc<SessionRegistry>,
    history: Arc<HistoryCoordinator>,
    terminal_workspace_lifecycle: tokio::sync::Mutex<()>,
    agent_workspace_lifecycle: Arc<tokio::sync::Mutex<()>>,
    data_dir: PathBuf,
    pool: SqlitePool,
    history_pool: OpenCodeHistoryPool,
    web_apps: Arc<WebAppManager>,
    skillink: Skillink,
    skill_repository_operations: SkillRepositoryOperationCoordinator,
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
            agent_workspace_lifecycle: Arc::new(tokio::sync::Mutex::new(())),
            data_dir,
            pool,
            history_pool,
            web_apps,
            skillink,
            skill_repository_operations: SkillRepositoryOperationCoordinator::default(),
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

    pub fn pending_upstream_session_ids_for(&self, agent_id: &str) -> HashSet<String> {
        self.sessions.pending_upstream_session_ids_for(agent_id)
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

    pub(crate) fn agent_workspace_lifecycle(&self) -> &tokio::sync::Mutex<()> {
        self.agent_workspace_lifecycle.as_ref()
    }

    pub(crate) fn agent_exit_cleanup(&self) -> crate::session::SessionExitCleanup {
        let pool = self.pool.clone();
        let lifecycle = self.agent_workspace_lifecycle.clone();
        let sessions = self.sessions.clone();
        let runtime = tokio::runtime::Handle::current();
        Box::new(move |session, code| {
            session.finish_exit(code);
            runtime.block_on(async move {
                let _lifecycle = lifecycle.lock().await;
                sessions.remove_if_same(session.id(), &session);
                let _ = crate::agent_workspace::remove_agent_session(&pool, session.id()).await;
                session.publish_removed(code);
            });
        })
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

    pub(crate) fn skill_repository_operations(&self) -> &SkillRepositoryOperationCoordinator {
        &self.skill_repository_operations
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

    pub(crate) fn agent_snapshot(&self) -> (HashSet<String>, Vec<SessionView>) {
        self.sessions.live_snapshot(SessionKind::Agent)
    }

    pub(crate) fn agent_ids(&self) -> HashSet<String> {
        self.agent_snapshot().0
    }

    pub(crate) fn contains_session(&self, session: &Arc<Session>) -> bool {
        self.sessions.contains(session)
    }

    pub(crate) fn live_agent_ids_if_contains(
        &self,
        session: &Arc<Session>,
    ) -> Option<HashSet<String>> {
        self.sessions
            .live_ids_if_contains(session, SessionKind::Agent)
    }

    pub(crate) fn remove_session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        self.sessions.remove(id, kind)
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use portable_pty::CommandBuilder;
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{AppState, OpenCodeHistoryPool};
    use crate::session::{Session, SessionEvent, SessionKind, SessionSpawn};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn agent_natural_exit_is_not_live_while_cleanup_waits_for_lifecycle_lock() {
        let temp = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(temp.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            temp.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(temp.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        let lifecycle = state.agent_workspace_lifecycle().lock().await;
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "read _; exit 0"]);
        let session = Session::spawn(
            state.session_registry(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Agent,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: temp.path().to_owned(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: Some("test"),
                agent_name: Some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: Some(state.agent_exit_cleanup()),
            },
            |_| {},
        )
        .unwrap();
        let mut events = session.subscribe();
        sqlx::query("INSERT INTO agent_workspaces (id, name, active_agent_session_id, created_at, updated_at) VALUES ('workspace', NULL, ?, 0, 0)")
            .bind(session.id())
            .execute(state.pool())
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_workspace_members (agent_session_id, workspace_id, position) VALUES (?, 'workspace', 0)")
            .bind(session.id())
            .execute(state.pool())
            .await
            .unwrap();
        assert!(session.write_input("\n"));
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if matches!(events.recv().await.unwrap(), SessionEvent::Exit(Some(0))) {
                    break;
                }
            }
        })
        .await
        .unwrap();
        assert!(state.live_agent_ids_if_contains(&session).is_none());
        assert!(state.session(session.id(), SessionKind::Agent).is_some());
        let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_workspace_members")
            .fetch_one(state.pool())
            .await
            .unwrap();
        assert_eq!(members, 1);
        drop(lifecycle);
        tokio::time::timeout(Duration::from_secs(5), session.wait_for_completion())
            .await
            .unwrap();
        assert!(matches!(
            events.recv().await.unwrap(),
            SessionEvent::Removed(Some(0))
        ));
        assert!(
            tokio::time::timeout(Duration::from_millis(100), events.recv())
                .await
                .is_err()
        );
        assert!(state.session(session.id(), SessionKind::Agent).is_none());
        let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_workspace_members")
            .fetch_one(state.pool())
            .await
            .unwrap();
        assert_eq!(members, 0);
    }
}
