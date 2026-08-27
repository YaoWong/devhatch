use std::{collections::HashSet, path::PathBuf, sync::Arc};

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

use crate::{agent, state::AppState};

pub(crate) mod codex;
pub(crate) mod opencode;
pub(crate) mod pi;
pub(crate) mod trae;

pub(crate) use opencode::{fork_successor, fork_successor_id, unique_new_session};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HistoryKind {
    Codex,
    OpenCode,
    Pi,
    Trae,
}

#[derive(Clone, Copy)]
pub(crate) enum HistoryBackend {
    Codex,
    OpenCode,
    Pi,
    Trae,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PreparedLaunch {
    None,
    CodexNew {
        home: PathBuf,
        baseline: HashSet<String>,
    },
    CodexResume {
        home: PathBuf,
        id: String,
        path: PathBuf,
        cwd: PathBuf,
    },
    OpenCodeNew {
        baseline: HashSet<String>,
    },
    OpenCodeResume {
        id: String,
        cwd: String,
    },
    PiNew {
        id: String,
    },
    PiResume {
        id: String,
        path: PathBuf,
        cwd: PathBuf,
    },
    TraeNew {
        id: String,
    },
    TraeResume {
        id: String,
        path: PathBuf,
        cwd: PathBuf,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HistoryError {
    InvalidId,
    Unavailable,
    NotFound,
    Ambiguous,
    InvalidCwd,
    Active,
    ExternalActive,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Presence {
    ActiveHere,
    PossiblyActiveElsewhere,
    Inactive,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryItem {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) directory: String,
    pub(crate) project_id: Option<String>,
    pub(crate) project_name: Option<String>,
    pub(crate) project_worktree: Option<String>,
    pub(crate) time_created: i64,
    pub(crate) time_updated: i64,
    pub(crate) presence: Presence,
}

impl HistoryKind {
    pub(crate) const fn backend(self) -> HistoryBackend {
        match self {
            Self::Codex => HistoryBackend::Codex,
            Self::OpenCode => HistoryBackend::OpenCode,
            Self::Pi => HistoryBackend::Pi,
            Self::Trae => HistoryBackend::Trae,
        }
    }
}

impl HistoryBackend {
    async fn items(self, state: &AppState) -> Result<Vec<HistoryItem>, &'static str> {
        match self {
            Self::Codex => codex::list(state).await,
            Self::OpenCode => opencode::list(state).await,
            Self::Pi => {
                let _history_guard = state.history_reconciliation().lock().await;
                let mut workspaces = crate::launch_path::paths_for_agent(state, agent::PI_ID)
                    .await
                    .map_err(|_| "PI_HISTORY_UNAVAILABLE")?;
                workspaces.extend(state.active_agent_cwds_for(agent::PI_ID));
                pi::list(
                    workspaces,
                    state.active_upstream_session_ids_for(agent::PI_ID),
                    state.active_upstream_session_files_for(agent::PI_ID),
                )
                .await
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
            Self::Codex => agent::CODEX_ID,
            Self::OpenCode => agent::OPENCODE_ID,
            Self::Pi => agent::PI_ID,
            Self::Trae => agent::TRAECLI_ID,
        };
        let active = state.active_upstream_session_ids_for(agent_id);
        if requested_id.is_some_and(|id| active_resume(&active, id)) {
            return Err(HistoryError::Active);
        }
        match self {
            Self::Codex => codex::prepare(requested_id).await,
            Self::OpenCode => opencode::prepare(state.history_pool(), requested_id).await,
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

    async fn delete(self, state: &AppState, id: String) -> Result<(), DeleteError> {
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

#[derive(Debug)]
pub(crate) enum DeleteError {
    History(HistoryError),
    Failed {
        status: StatusCode,
        code: &'static str,
        message: Option<String>,
    },
}

pub async fn list(State(state): State<Arc<AppState>>, Path(agent_id): Path<String>) -> Response {
    let Some(kind) = agent::history_kind(&agent_id) else {
        return error(StatusCode::BAD_REQUEST, "AGENT_HISTORY_UNSUPPORTED");
    };
    match kind.backend().items(&state).await {
        Ok(sessions) => {
            Json(serde_json::json!({ "available": true, "diagnostic": null, "sessions": sessions }))
                .into_response()
        }
        Err(diagnostic) => Json(
            serde_json::json!({ "available": false, "diagnostic": diagnostic, "sessions": [] }),
        )
        .into_response(),
    }
}

pub async fn remove(
    State(state): State<Arc<AppState>>,
    Path((agent_id, id)): Path<(String, String)>,
) -> Response {
    let Some(kind) = agent::history_kind(&agent_id) else {
        return error(StatusCode::BAD_REQUEST, "AGENT_HISTORY_UNSUPPORTED");
    };
    let _history_guard = state.history_reconciliation().lock().await;
    if state
        .active_upstream_session_ids_for(&agent_id)
        .contains(&id)
    {
        return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
    }
    match kind.backend().delete(&state, id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(DeleteError::History(error_kind)) => history_error_response(kind, error_kind),
        Err(DeleteError::Failed {
            status,
            code,
            message,
        }) => match message {
            Some(message) => (
                status,
                Json(serde_json::json!({ "error": code, "message": message })),
            )
                .into_response(),
            None => error(status, code),
        },
    }
}

pub(crate) fn prepare_error_response(kind: HistoryKind, value: HistoryError) -> Response {
    history_error_response(kind, value)
}

fn history_error_response(kind: HistoryKind, value: HistoryError) -> Response {
    match value {
        HistoryError::InvalidId => error(StatusCode::BAD_REQUEST, "INVALID_UPSTREAM_SESSION_ID"),
        HistoryError::NotFound => error(StatusCode::NOT_FOUND, "UPSTREAM_SESSION_NOT_FOUND"),
        HistoryError::InvalidCwd => error(StatusCode::BAD_REQUEST, "INVALID_CWD"),
        HistoryError::Active => error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE"),
        HistoryError::ExternalActive => error(
            StatusCode::CONFLICT,
            "UPSTREAM_SESSION_POSSIBLY_ACTIVE_ELSEWHERE",
        ),
        HistoryError::Ambiguous => error(
            StatusCode::SERVICE_UNAVAILABLE,
            "PI_HISTORY_SESSION_AMBIGUOUS",
        ),
        HistoryError::Unavailable => error(
            StatusCode::SERVICE_UNAVAILABLE,
            match kind {
                HistoryKind::Codex => "CODEX_HISTORY_UNAVAILABLE",
                HistoryKind::OpenCode => "OPENCODE_HISTORY_UNAVAILABLE",
                HistoryKind::Pi => "PI_HISTORY_UNAVAILABLE",
                HistoryKind::Trae => "TRAE_HISTORY_UNAVAILABLE",
            },
        ),
    }
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{HistoryBackend, HistoryKind, active_resume};
    use std::collections::HashSet;

    #[tokio::test]
    async fn launch_preparation_covers_backend_new_sessions() {
        assert!(matches!(
            super::opencode::prepare(None, None).await.unwrap(),
            super::PreparedLaunch::OpenCodeNew { baseline } if baseline.is_empty()
        ));
        assert!(matches!(
            super::pi::prepare(Vec::new(), None).await.unwrap(),
            super::PreparedLaunch::PiNew { id } if super::pi::valid_session_id(&id)
        ));
    }

    #[test]
    fn active_resume_is_agent_scoped_by_the_callers_set() {
        let pi = HashSet::from(["same-id".to_string()]);
        let opencode = HashSet::new();
        assert!(active_resume(&pi, "same-id"));
        assert!(!active_resume(&pi, "different-id"));
        assert!(!active_resume(&opencode, "same-id"));
    }

    #[test]
    fn closed_backend_dispatch_is_stable() {
        assert!(matches!(
            HistoryKind::OpenCode.backend(),
            HistoryBackend::OpenCode
        ));
        assert!(matches!(HistoryKind::Pi.backend(), HistoryBackend::Pi));
        assert!(matches!(HistoryKind::Trae.backend(), HistoryBackend::Trae));
    }
}
