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

#[derive(Default)]
struct RegistryState {
    sessions: IndexMap<String, Arc<Session>>,
    shutting_down: bool,
}

impl Deref for RegistryState {
    type Target = IndexMap<String, Arc<Session>>;

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
        state.sessions.values().cloned().collect()
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
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == SessionKind::Agent)
            .filter_map(|session| session.upstream_session_id())
            .collect()
    }

    pub(crate) fn active_upstream_session_ids_for(&self, agent_id: &str) -> HashSet<String> {
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

    pub(crate) fn active_upstream_session_files_for(&self, agent_id: &str) -> HashSet<PathBuf> {
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

    pub(crate) fn active_agent_cwds_for(&self, agent_id: &str) -> HashSet<PathBuf> {
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

    pub(crate) fn owned_process_ids(&self) -> HashSet<u32> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .map(|session| session.process_id())
            .collect()
    }

    pub(crate) fn insert(&self, session: Arc<Session>) -> bool {
        let mut state = self.sessions.write().expect("sessions lock poisoned");
        if state.shutting_down {
            return false;
        }
        state.insert(session.id().to_string(), session);
        true
    }

    pub(crate) fn session(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .get(id)
            .filter(|session| session.kind() == kind)
            .cloned()
    }

    pub(crate) fn count(&self, kind: SessionKind) -> usize {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .values()
            .filter(|session| session.kind() == kind)
            .count()
    }

    pub(crate) fn views(&self, kind: SessionKind) -> Vec<SessionView> {
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

    pub(crate) fn contains(&self, session: &Arc<Session>) -> bool {
        self.sessions
            .read()
            .expect("sessions lock poisoned")
            .get(session.id())
            .is_some_and(|current| Arc::ptr_eq(current, session))
    }

    pub(crate) fn remove(&self, id: &str, kind: SessionKind) -> Option<Arc<Session>> {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        sessions
            .get(id)
            .is_some_and(|session| session.kind() == kind)
            .then(|| sessions.shift_remove(id).expect("session must exist"))
    }

    pub(crate) fn remove_if_same(&self, id: &str, session: &Arc<Session>) {
        let mut sessions = self.sessions.write().expect("sessions lock poisoned");
        if sessions
            .get(id)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            sessions.shift_remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

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
                cwd: std::env::temp_dir(),
                name: "test".to_string(),
                cols: 80,
                rows: 24,
                agent_id: None,
                agent_name: None,
                cleanup_path: Some(cleanup_path.clone()),
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
                    cwd: std::env::temp_dir(),
                    name: "rejected".to_string(),
                    cols: 80,
                    rows: 24,
                    agent_id: None,
                    agent_name: None,
                    cleanup_path: None,
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

    #[test]
    fn shutdown_closes_registration_before_snapshot() {
        let registry = SessionRegistry::default();
        assert!(registry.begin_shutdown().is_empty());
        let state = registry.sessions.read().expect("sessions lock poisoned");
        assert!(state.shutting_down);
    }
}
