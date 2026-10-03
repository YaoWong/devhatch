use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::{agent::AgentKind, state::AppState};

struct OpenCodeDeletionScope {
    reconciliation: Option<tokio::sync::OwnedMutexGuard<()>>,
    deletion: Option<crate::state::HistoryDeletionGuard>,
}

impl OpenCodeDeletionScope {
    fn deletion_mut(&mut self) -> &mut crate::state::HistoryDeletionGuard {
        self.deletion
            .as_mut()
            .expect("OpenCode deletion guard must be present")
    }
}

impl Drop for OpenCodeDeletionScope {
    fn drop(&mut self) {
        drop(self.reconciliation.take());
        drop(self.deletion.take());
    }
}

use super::{DeleteError, HistoryError};

pub async fn list(State(state): State<Arc<AppState>>, Path(agent_id): Path<String>) -> Response {
    let kind = match AgentKind::try_from(agent_id.as_str()) {
        Ok(kind) => kind,
        Err(()) => return error(StatusCode::BAD_REQUEST, "AGENT_HISTORY_UNSUPPORTED"),
    };
    let coordinator = state.history_coordinator();
    let _history_guard = if kind == AgentKind::OpenCode {
        let guard = coordinator.lock().lock().await;
        super::opencode::refresh_history_binding(&state).await;
        Some(guard)
    } else {
        None
    };
    match kind.history_backend().items(&state).await {
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
    let kind = match AgentKind::try_from(agent_id.as_str()) {
        Ok(kind) => kind,
        Err(()) => return error(StatusCode::BAD_REQUEST, "AGENT_HISTORY_UNSUPPORTED"),
    };
    let agent_id = kind.as_str();
    let coordinator = state.history_coordinator();
    if kind == AgentKind::OpenCode {
        let state = state.clone();
        let reconciliation = coordinator.owned_lock().lock_owned().await;
        super::opencode::refresh_history_binding(&state).await;
        if state
            .active_upstream_session_ids_for(agent_id)
            .contains(&id)
        {
            return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
        }
        let Some(marker) = coordinator.begin(agent_id, &id) else {
            return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
        };
        let task = spawn_opencode_delete_task(state, id, reconciliation, marker);
        return match task.await {
            Ok(result) => delete_response(AgentKind::OpenCode, result),
            Err(_) => error(StatusCode::BAD_GATEWAY, "OPENCODE_SESSION_DELETE_FAILED"),
        };
    }
    let _history_guard = coordinator.lock().lock().await;
    if state
        .active_upstream_session_ids_for(agent_id)
        .contains(&id)
        || (kind == AgentKind::TraeCli && super::trae::pending_thread_claims_id(&state, &id).await)
    {
        return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
    }
    let Some(deletion) = coordinator.begin(agent_id, &id) else {
        return error(StatusCode::CONFLICT, "UPSTREAM_SESSION_ACTIVE_HERE");
    };
    let result = kind.history_backend().delete(&state, id, None).await;
    drop(deletion);
    delete_response(kind, result)
}

fn spawn_opencode_delete_task(
    state: Arc<AppState>,
    id: String,
    reconciliation: tokio::sync::OwnedMutexGuard<()>,
    deletion: crate::state::HistoryDeletionGuard,
) -> tokio::task::JoinHandle<Result<(), DeleteError>> {
    tokio::spawn(async move {
        let mut scope = OpenCodeDeletionScope {
            reconciliation: Some(reconciliation),
            deletion: Some(deletion),
        };
        AgentKind::OpenCode
            .history_backend()
            .delete(&state, id, Some(scope.deletion_mut()))
            .await
    })
}

fn delete_response(kind: AgentKind, result: Result<(), DeleteError>) -> Response {
    match result {
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

pub(crate) fn prepare_error_response(kind: AgentKind, value: HistoryError) -> Response {
    history_error_response(kind, value)
}

fn history_error_response(kind: AgentKind, value: HistoryError) -> Response {
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
                AgentKind::Codex => "CODEX_HISTORY_UNAVAILABLE",
                AgentKind::OpenCode => "OPENCODE_HISTORY_UNAVAILABLE",
                AgentKind::Pi => "PI_HISTORY_UNAVAILABLE",
                AgentKind::TraeCli => "TRAE_HISTORY_UNAVAILABLE",
            },
        ),
    }
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use std::{future::pending, os::unix::fs::PermissionsExt, sync::Arc};

    use sqlx::sqlite::SqlitePoolOptions;
    use tempfile::TempDir;

    use super::{OpenCodeDeletionScope, spawn_opencode_delete_task};
    use crate::state::{AppState, HistoryCoordinator, HistoryPoolHandle, OpenCodeHistoryPool};

    async fn deletion_state() -> (TempDir, Arc<AppState>, HistoryPoolHandle) {
        let root = TempDir::new().unwrap();
        let history_path = root.path().join("opencode.db");
        let history = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&format!("sqlite://{}?mode=rwc", history_path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT, worktree TEXT); CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT NOT NULL, share_url TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER); CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, directory TEXT NOT NULL, title TEXT, share_url TEXT, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_archived INTEGER); INSERT INTO session_v2 (id, project_id, parent_id, directory, title, time_created, time_updated, time_archived) VALUES ('ses_root', NULL, NULL, '/root', 'Root', 1, 2, NULL)")
            .execute(&history)
            .await
            .unwrap();
        history.close().await;
        std::fs::set_permissions(&history_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let application_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&application_pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            root.path().to_owned(),
            application_pool,
            OpenCodeHistoryPool::new(history_path),
            skillink,
            None,
            false,
        ));
        let handle = state.history_pool().await.unwrap();
        (root, state, handle)
    }

    async fn exercise_cancelled_delete(commit_paused: bool) {
        let (_root, state, handle) = deletion_state().await;
        let commit_gate = if commit_paused {
            Some(handle.pause_before_delete_commit().await)
        } else {
            None
        };
        let invalidation_gate = handle.pause_before_delete_invalidation().await;
        let coordinator = state.history_coordinator();
        let reconciliation = coordinator.owned_lock().lock_owned().await;
        let deletion = coordinator.begin("opencode", "ses_root").unwrap();
        let operation = spawn_opencode_delete_task(
            state.clone(),
            "ses_root".to_string(),
            reconciliation,
            deletion,
        );
        let mut waiter = Some(tokio::spawn(operation));

        if commit_paused {
            handle.wait_before_delete_commit().await;
            let task = waiter.take().unwrap();
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
            assert!(coordinator.deletion_pending("opencode", "ses_root"));
            drop(commit_gate);
        }
        handle.wait_before_delete_invalidation().await;
        if let Some(task) = waiter.take() {
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        }
        assert!(coordinator.deletion_pending("opencode", "ses_root"));
        assert!(state.opencode_history_handle_is_current(&handle));
        drop(invalidation_gate);
        let completed = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            coordinator.owned_lock().lock_owned(),
        )
        .await
        .unwrap();
        drop(completed);
        assert!(!coordinator.deletion_pending("opencode", "ses_root"));
        assert!(!state.opencode_history_handle_is_current(&handle));
        assert!(handle.pool.is_closed());
    }

    #[tokio::test]
    async fn cancellation_before_commit_does_not_cancel_delete_or_invalidation() {
        exercise_cancelled_delete(true).await;
    }

    #[tokio::test]
    async fn cancellation_after_commit_does_not_skip_invalidation() {
        exercise_cancelled_delete(false).await;
    }

    async fn exercise_scope_drop(panic: bool) {
        let coordinator = Arc::new(HistoryCoordinator::default());
        let (started, started_waiter) = tokio::sync::oneshot::channel();
        let (proceed, proceed_waiter) = tokio::sync::oneshot::channel();
        let (observed, observed_waiter) = tokio::sync::oneshot::channel();
        let task_coordinator = coordinator.clone();
        let task = tokio::spawn(async move {
            let reconciliation = task_coordinator.owned_lock().lock_owned().await;
            let mut deletion = task_coordinator.begin("opencode", "root").unwrap();
            assert!(task_coordinator.extend_deletion(
                &mut deletion,
                "opencode",
                ["root".to_string(), "child".to_string()],
            ));
            let observer_coordinator = task_coordinator.clone();
            deletion.set_before_remove(move || {
                let _ = observed.send(observer_coordinator.lock().try_lock().is_ok());
            });
            let _scope = OpenCodeDeletionScope {
                reconciliation: Some(reconciliation),
                deletion: Some(deletion),
            };
            let _ = started.send(());
            let _ = proceed_waiter.await;
            if panic {
                panic!("exercise deletion unwind");
            }
            pending::<()>().await;
        });

        started_waiter.await.unwrap();
        assert!(coordinator.deletion_pending("opencode", "root"));
        assert!(coordinator.deletion_pending("opencode", "child"));
        let _ = proceed.send(());
        if !panic {
            task.abort();
        }
        let error = task.await.unwrap_err();
        assert_eq!(error.is_panic(), panic);
        assert_eq!(error.is_cancelled(), !panic);
        assert!(observed_waiter.await.unwrap());
        assert!(!coordinator.deletion_pending("opencode", "root"));
        assert!(!coordinator.deletion_pending("opencode", "child"));
    }

    #[tokio::test]
    async fn cancellation_releases_reconciliation_before_descendant_markers() {
        exercise_scope_drop(false).await;
    }

    #[tokio::test]
    async fn panic_releases_reconciliation_before_descendant_markers() {
        exercise_scope_drop(true).await;
    }
}
