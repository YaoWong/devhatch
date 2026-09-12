use std::{
    collections::HashSet,
    ops::{Deref, DerefMut},
    path::PathBuf,
    sync::{Arc, RwLock},
    time::Duration,
};

use futures_util::future::join_all;
use indexmap::IndexMap;

use crate::session::{Session, SessionKind, SessionView};

#[derive(Default)]
pub(crate) struct SessionRegistry {
    sessions: RwLock<RegistryState>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SessionKey {
    kind: SessionKind,
    id: String,
}

impl SessionKey {
    fn new(kind: SessionKind, id: impl Into<String>) -> Self {
        Self {
            kind,
            id: id.into(),
        }
    }

    fn borrowed(kind: SessionKind, id: &str) -> Self {
        Self::new(kind, id)
    }

    fn for_session(session: &Session) -> Self {
        Self::new(session.kind(), session.id())
    }
}

#[derive(Default)]
struct RegistryState {
    sessions: IndexMap<SessionKey, Arc<Session>>,
    terminating_agents: IndexMap<SessionKey, Arc<Session>>,
    shutting_down: bool,
}

impl Deref for RegistryState {
    type Target = IndexMap<SessionKey, Arc<Session>>;

    fn deref(&self) -> &Self::Target {
        &self.sessions
    }
}

impl DerefMut for RegistryState {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.sessions
    }
}

impl SessionRegistry {
    fn begin_shutdown(&self) -> Vec<Arc<Session>> {
        let mut state = self.sessions.write().expect("sessions lock poisoned");
        state.shutting_down = true;
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .cloned()
            .collect()
    }

    pub(crate) async fn shutdown_all(&self, timeout: Duration) -> bool {
        let sessions = self.begin_shutdown();
        for session in &sessions {
            session.terminate();
        }
        tokio::time::timeout(
            timeout,
            join_all(
                sessions
                    .into_iter()
                    .map(|session| async move { session.wait_for_completion().await }),
            ),
        )
        .await
        .is_ok()
    }

    #[allow(dead_code)]
    pub(crate) fn active_upstream_session_ids(&self) -> HashSet<String> {
        let state = self.sessions.read().expect("sessions lock poisoned");
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .filter(|session| session.kind() == SessionKind::Agent)
            .filter_map(|session| session.upstream_session_id())
            .collect()
    }

    pub(crate) fn active_upstream_session_ids_for(&self, agent_id: &str) -> HashSet<String> {
        let state = self.sessions.read().expect("sessions lock poisoned");
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .filter_map(|session| session.upstream_session_id())
            .collect()
    }

    pub(crate) fn pending_upstream_session_ids_for(&self, agent_id: &str) -> HashSet<String> {
        let state = self.sessions.read().expect("sessions lock poisoned");
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .filter_map(|session| session.pending_upstream_session_id())
            .collect()
    }

    pub(crate) fn active_upstream_session_files_for(&self, agent_id: &str) -> HashSet<PathBuf> {
        let state = self.sessions.read().expect("sessions lock poisoned");
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .filter_map(|session| session.upstream_session_file())
            .collect()
    }

    pub(crate) fn active_agent_cwds_for(&self, agent_id: &str) -> HashSet<PathBuf> {
        let state = self.sessions.read().expect("sessions lock poisoned");
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .filter(|session| {
                session.kind() == SessionKind::Agent && session.agent_id() == Some(agent_id)
            })
            .map(|session| PathBuf::from(session.correlation_details().0))
            .collect()
    }

    pub(crate) fn owned_process_ids(&self) -> HashSet<u32> {
        let state = self.sessions.read().expect("sessions lock poisoned");
        state
            .sessions
            .values()
            .chain(state.terminating_agents.values())
            .map(|session| session.process_id())
            .collect()
    }

    pub(crate) fn insert(&self, session: Arc<Session>) -> bool {
        let mut state = self.sessions.write().expect("sessions lock poisoned");
        if state.shutting_down {
            return false;
        }
        let key = SessionKey::for_session(&session);
        state.sessions.insert(key, session);
        true
    }

    pub(crate) fn session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .sessions
            .get(&SessionKey::borrowed(kind, id))
            .cloned()
    }

    pub(crate) fn count(&self, kind: SessionKind) -> usize {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .sessions
            .keys()
            .filter(|key| key.kind == kind)
            .count()
    }

    pub(crate) fn views(&self, kind: SessionKind) -> Vec<SessionView> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .sessions
            .iter()
            .filter(|(key, _)| key.kind == kind)
            .map(|(_, session)| session.view())
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn live_snapshot(&self, kind: SessionKind) -> (HashSet<String>, Vec<SessionView>) {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        let views = sessions
            .values()
            .filter(|session| session.kind() == kind)
            .filter_map(|session| session.live_view())
            .collect::<Vec<_>>();
        let ids = views.iter().map(|view| view.id().to_string()).collect();
        (ids, views)
    }

    pub(crate) fn workspace_snapshot(
        &self,
    ) -> (HashSet<crate::workspace::MemberIdentity>, Vec<SessionView>) {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        let mut eligible = HashSet::new();
        let mut views = Vec::new();
        for session in sessions.values() {
            let included = match session.kind() {
                SessionKind::Terminal => !session.is_deleting(),
                SessionKind::Agent => session.is_live(),
            };
            if included {
                eligible.insert(crate::workspace::MemberIdentity::new(
                    session.id(),
                    session.kind(),
                ));
                views.push(session.view());
            }
        }
        (eligible, views)
    }

    #[cfg(test)]
    pub(crate) fn terminal_cwds(&self) -> HashSet<String> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == SessionKind::Terminal)
            .map(|session| session.correlation_details().0)
            .collect()
    }

    pub(crate) fn contains(&self, session: &Arc<Session>) -> bool {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .sessions
            .get(&SessionKey::for_session(session))
            .is_some_and(|current| Arc::ptr_eq(current, session))
    }

    pub(crate) fn live_ids_if_contains(
        &self,
        session: &Arc<Session>,
        kind: SessionKind,
    ) -> Option<HashSet<String>> {
        let sessions = self.sessions.read().expect("sessions lock poisoned");
        let key = SessionKey::borrowed(kind, session.id());
        let current = sessions.sessions.get(&key)?;
        if !Arc::ptr_eq(current, session) || !current.is_live() {
            return None;
        }
        Some(
            sessions
                .sessions
                .iter()
                .filter(|(key, session)| key.kind == kind && session.is_live())
                .map(|(key, _)| key.id.clone())
                .collect(),
        )
    }

    pub(crate) fn remove(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        let mut state = self.sessions.write().expect("sessions lock poisoned");
        let key = SessionKey::borrowed(kind, id);
        let removed = state.sessions.shift_remove(&key);
        if let Some(session) = &removed
            && kind == SessionKind::Agent
            && session.is_live()
        {
            state.terminating_agents.insert(key, session.clone());
        }
        removed
    }

    pub(crate) fn remove_if_same(&self, session: &Arc<Session>) {
        let mut state = self.sessions.write().expect("sessions lock poisoned");
        let key = SessionKey::for_session(session);
        if state
            .sessions
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            state.sessions.shift_remove(&key);
        }
        if state
            .terminating_agents
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            state.terminating_agents.shift_remove(&key);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, sync::Arc, time::Duration};

    use portable_pty::CommandBuilder;

    use super::SessionRegistry;
    use crate::session::{Session, SessionKind, SessionSpawn};

    #[test]
    fn empty_registry_queries_are_consistent() {
        let registry = SessionRegistry::default();
        assert_eq!(registry.count(SessionKind::Agent), 0);
        assert!(registry.session("missing", SessionKind::Agent).is_none());
        assert!(registry.active_upstream_session_ids().is_empty());
        assert!(registry.terminal_cwds().is_empty());
    }

    #[tokio::test]
    async fn shutdown_waits_for_child_and_cleanup_and_rejects_registration() {
        let registry = Arc::new(SessionRegistry::default());
        let cleanup_path = std::env::temp_dir().join(format!(
            "devhatch-session-shutdown-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&cleanup_path).unwrap();
        let session = Session::spawn(
            registry.clone(),
            SessionSpawn {
                command: CommandBuilder::new("/bin/sh"),
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Terminal,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: None,
                agent_name: None,
                cleanup_path: Some(cleanup_path.clone()),
                runtime_endpoint: None,
                exit_cleanup: None,
            },
            |_| {},
        )
        .unwrap();
        assert!(registry.shutdown_all(Duration::from_secs(5)).await);
        assert!(!cleanup_path.exists());
        assert!(
            Session::spawn(
                registry.clone(),
                SessionSpawn {
                    command: CommandBuilder::new("/bin/sh"),
                    shell: "/bin/sh".to_string(),
                    kind: SessionKind::Terminal,
                    upstream_session_id: None,
                    pending_upstream_session_id: None,
                    cwd: std::env::temp_dir(),
                    name: "rejected".to_string(),
                    cols: 80,
                    rows: 24,
                    agent_id: None,
                    agent_name: None,
                    cleanup_path: None,
                    runtime_endpoint: None,
                    exit_cleanup: None,
                },
                |_| {},
            )
            .is_err()
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(100), session.wait_for_completion())
                .await
                .is_ok()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminate_returns_without_waiting_for_the_grace_period() {
        let registry = Arc::new(SessionRegistry::default());
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Session::spawn(
            registry.clone(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Terminal,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: None,
                agent_name: None,
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: None,
            },
            |_| {},
        )
        .unwrap();
        let started = std::time::Instant::now();

        session.terminate();

        assert!(started.elapsed() < Duration::from_millis(200));
        tokio::time::timeout(Duration::from_secs(5), session.wait_for_completion())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn live_snapshot_rejects_deleting_and_exited_registry_entries() {
        let registry = Arc::new(SessionRegistry::default());
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Session::spawn(
            registry.clone(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Agent,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: Some("test"),
                agent_name: Some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: None,
            },
            |_| {},
        )
        .unwrap();
        let (ids, views) = registry.live_snapshot(SessionKind::Agent);
        assert_eq!(ids, HashSet::from([session.id().to_string()]));
        assert_eq!(
            views.iter().map(|view| view.id()).collect::<Vec<_>>(),
            vec![session.id()]
        );
        assert!(
            registry
                .live_ids_if_contains(&session, SessionKind::Agent)
                .is_some_and(|ids| ids.contains(session.id()))
        );
        session.mark_deleting();
        let (ids, views) = registry.live_snapshot(SessionKind::Agent);
        assert!(ids.is_empty());
        assert!(views.is_empty());
        assert!(
            registry
                .live_ids_if_contains(&session, SessionKind::Agent)
                .is_none()
        );
        registry.remove_if_same(&session);
        session.terminate();
        session.wait_for_completion().await;

        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let exited = Session::spawn(
            registry.clone(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Agent,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: Some("test"),
                agent_name: Some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: None,
            },
            |_| {},
        )
        .unwrap();
        exited.terminate();
        exited.finish_exit(Some(0));
        assert!(
            registry
                .live_ids_if_contains(&exited, SessionKind::Agent)
                .is_none()
        );
        registry.remove_if_same(&exited);
        exited.terminate();
        exited.wait_for_completion().await;
    }

    #[tokio::test]
    async fn naturally_exited_terminal_remains_workspace_eligible() {
        let registry = Arc::new(SessionRegistry::default());
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "exit 0"]);
        let session = Session::spawn(
            registry.clone(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Terminal,
                upstream_session_id: None,
                pending_upstream_session_id: None,
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: None,
                agent_name: None,
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: None,
            },
            |_| {},
        )
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), session.wait_for_completion())
            .await
            .unwrap();
        let (eligible, views) = registry.workspace_snapshot();
        assert!(eligible.contains(&crate::workspace::MemberIdentity::new(
            session.id(),
            SessionKind::Terminal,
        )));
        assert_eq!(views.len(), 1);
        assert!(
            registry
                .session(session.id(), SessionKind::Terminal)
                .is_some()
        );
        registry.remove(session.id(), SessionKind::Terminal);
    }

    #[tokio::test]
    async fn terminating_agent_owns_upstream_history_until_process_exit() {
        let registry = Arc::new(SessionRegistry::default());
        let mut command = CommandBuilder::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let session = Session::spawn(
            registry.clone(),
            SessionSpawn {
                command,
                shell: "/bin/sh".to_string(),
                kind: SessionKind::Agent,
                upstream_session_id: Some("history".to_string()),
                pending_upstream_session_id: None,
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: Some("test"),
                agent_name: Some("Test"),
                cleanup_path: None,
                runtime_endpoint: None,
                exit_cleanup: None,
            },
            |_| {},
        )
        .unwrap();
        let removed = registry.remove(session.id(), SessionKind::Agent).unwrap();
        removed.mark_deleting();
        assert_eq!(
            registry.active_upstream_session_ids_for("test"),
            HashSet::from(["history".to_string()])
        );
        removed.terminate();
        tokio::time::timeout(Duration::from_secs(5), removed.wait_for_completion())
            .await
            .unwrap();
        assert!(registry.active_upstream_session_ids_for("test").is_empty());
    }

    #[tokio::test]
    async fn same_raw_id_across_kinds_is_stored_and_removed_independently() {
        let registry = Arc::new(SessionRegistry::default());
        let spawn = |kind, name: &str| {
            let mut command = CommandBuilder::new("/bin/sh");
            command.args(["-c", "sleep 30"]);
            Session::spawn_with_id(
                registry.clone(),
                SessionSpawn {
                    command,
                    shell: "/bin/sh".to_string(),
                    kind,
                    upstream_session_id: None,
                    pending_upstream_session_id: None,
                    cwd: std::env::temp_dir(),
                    name: name.to_string(),
                    cols: 80,
                    rows: 24,
                    agent_id: (kind == SessionKind::Agent).then_some("test"),
                    agent_name: (kind == SessionKind::Agent).then_some("Test"),
                    cleanup_path: None,
                    runtime_endpoint: None,
                    exit_cleanup: None,
                },
                |_| {},
                "shared",
            )
            .unwrap()
        };
        let terminal = spawn(SessionKind::Terminal, "terminal");
        let agent = spawn(SessionKind::Agent, "agent");

        assert!(Arc::ptr_eq(
            &registry.session("shared", SessionKind::Terminal).unwrap(),
            &terminal
        ));
        assert!(Arc::ptr_eq(
            &registry.session("shared", SessionKind::Agent).unwrap(),
            &agent
        ));
        assert_eq!(registry.count(SessionKind::Terminal), 1);
        assert_eq!(registry.count(SessionKind::Agent), 1);

        assert!(Arc::ptr_eq(
            &registry.remove("shared", SessionKind::Terminal).unwrap(),
            &terminal
        ));
        assert!(registry.session("shared", SessionKind::Terminal).is_none());
        assert!(Arc::ptr_eq(
            &registry.session("shared", SessionKind::Agent).unwrap(),
            &agent
        ));
        assert!(Arc::ptr_eq(
            &registry.remove("shared", SessionKind::Agent).unwrap(),
            &agent
        ));
        terminal.mark_deleting();
        terminal.terminate();
        agent.mark_deleting();
        agent.terminate();
        tokio::time::timeout(Duration::from_secs(5), terminal.wait_for_completion())
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), agent.wait_for_completion())
            .await
            .unwrap();
    }

    #[test]
    fn shutdown_closes_registration_before_snapshot() {
        let registry = SessionRegistry::default();
        assert!(registry.begin_shutdown().is_empty());
        let state = registry.sessions.read().expect("sessions lock poisoned");
        assert!(state.shutting_down);
    }
}
