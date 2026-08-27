use std::collections::HashSet;

use crate::{agent, agent::AgentKind, state::AppState};

use super::{
    DeleteError, HistoryBackend, HistoryError, HistoryItem, PreparedLaunch, codex, opencode, pi,
    trae,
};

impl HistoryBackend {
    pub(super) async fn items(self, state: &AppState) -> Result<Vec<HistoryItem>, &'static str> {
        match self {
            Self::Codex => codex::list(state).await,
            Self::OpenCode => opencode::list(state).await,
            Self::Pi => {
                let mut workspaces = crate::launch_path::paths_for_agent(state, agent::PI_ID)
                    .await
                    .map_err(|_| "PI_HISTORY_UNAVAILABLE")?;
                let (active_ids, active_files, owned_pids) = {
                    let _history_guard = state.history_reconciliation().lock().await;
                    workspaces.extend(state.active_agent_cwds_for(agent::PI_ID));
                    (
                        state.active_upstream_session_ids_for(agent::PI_ID),
                        state.active_upstream_session_files_for(agent::PI_ID),
                        state.owned_process_ids(),
                    )
                };
                pi::list(workspaces, active_ids, active_files, owned_pids).await
            }
            Self::Trae => trae::list(state).await,
        }
    }

    pub(crate) async fn prepare(
        self,
        state: &AppState,
        requested_id: Option<&str>,
    ) -> Result<PreparedLaunch, HistoryError> {
        let agent_id = match self {
            Self::Codex => AgentKind::Codex,
            Self::OpenCode => AgentKind::OpenCode,
            Self::Pi => AgentKind::Pi,
            Self::Trae => AgentKind::TraeCli,
        }
        .as_str();
        let active = state.active_upstream_session_ids_for(agent_id);
        if requested_id.is_some_and(|id| {
            active_resume(&active, id) || state.history_deletion_pending(agent_id, id)
        }) {
            return Err(HistoryError::Active);
        }
        match self {
            Self::Codex => codex::prepare(requested_id).await,
            Self::OpenCode => opencode::prepare(state, requested_id).await,
            Self::Pi => {
                let mut workspaces = crate::launch_path::paths_for_agent(state, agent::PI_ID)
                    .await
                    .map_err(|_| HistoryError::Unavailable)?;
                workspaces.extend(state.active_agent_cwds_for(agent::PI_ID));
                pi::prepare(workspaces, requested_id).await
            }
            Self::Trae => trae::prepare(requested_id).await,
        }
    }

    pub(super) async fn delete(self, state: &AppState, id: String) -> Result<(), DeleteError> {
        match self {
            Self::Codex => codex::delete(state, id).await,
            Self::OpenCode => opencode::delete(state, id).await,
            Self::Pi => {
                let mut workspaces = crate::launch_path::paths_for_agent(state, agent::PI_ID)
                    .await
                    .map_err(|_| DeleteError::History(HistoryError::Unavailable))?;
                workspaces.extend(state.active_agent_cwds_for(agent::PI_ID));
                pi::delete(state, workspaces, id).await
            }
            Self::Trae => trae::delete(state, id).await,
        }
    }
}

fn active_resume(active: &HashSet<String>, id: &str) -> bool {
    active.contains(id)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::active_resume;

    #[test]
    fn active_resume_is_agent_scoped_by_the_callers_set() {
        let pi = HashSet::from(["same-id".to_string()]);
        let opencode = HashSet::new();
        assert!(active_resume(&pi, "same-id"));
        assert!(!active_resume(&pi, "different-id"));
        assert!(!active_resume(&opencode, "same-id"));
    }
}
