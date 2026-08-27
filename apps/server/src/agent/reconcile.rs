use std::{collections::HashSet, sync::Arc, time::Duration};

use crate::{
    agent::{CODEX_ID, OPENCODE_ID},
    session::Session,
    state::AppState,
};

pub(super) fn start_codex_reconciler(
    session: &Arc<Session>,
    app_state: Arc<AppState>,
    home: std::path::PathBuf,
    baseline: HashSet<String>,
) {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        for _ in 0..240 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let Some(session) = weak.upgrade() else {
                return;
            };
            if session.is_deleting()
                || session.upstream_session_id().is_some()
                || !app_state.contains_session(&session)
            {
                return;
            }
            let (directory, launched_at) = session.correlation_details();
            drop(session);
            let candidates = crate::history::codex::new_session_candidates(
                home.clone(),
                std::path::PathBuf::from(directory),
                launched_at,
                &baseline,
            )
            .await;
            let Ok(candidates) = candidates else {
                continue;
            };
            let _reconciliation = app_state.history_reconciliation().lock().await;
            let Some(session) = weak.upgrade() else {
                return;
            };
            let claimed = app_state.active_upstream_session_ids_for(CODEX_ID);
            let record = crate::history::codex::unique_unclaimed_session(candidates, &claimed);
            if let Some(record) = record
                && !app_state.history_deletion_pending(CODEX_ID, &record.id)
                && app_state.contains_session(&session)
                && !session.is_deleting()
                && session.upstream_session_id().is_none()
            {
                session.update_runtime_identity(record.id, Some(record.path), Some(record.cwd));
                return;
            }
        }
    });
}

pub(super) fn start_history_reconciler(
    session: &Arc<Session>,
    app_state: Arc<AppState>,
    baseline: HashSet<String>,
) {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        loop {
            let Some(session) = weak.upgrade() else {
                return;
            };
            if session.is_deleting() || session.upstream_session_id().is_some() {
                return;
            }
            let (directory, launched_at) = session.correlation_details();
            drop(session);
            let candidates = crate::history::new_session_candidates(
                app_state.history_pool(),
                &directory,
                launched_at,
                &baseline,
            )
            .await;
            let Ok(candidates) = candidates else {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            };
            let _reconciliation = app_state.history_reconciliation().lock().await;
            let Some(session) = weak.upgrade() else {
                return;
            };
            let claimed = app_state.active_upstream_session_ids_for(OPENCODE_ID);
            let id = crate::history::unique_unclaimed_session(candidates, &claimed);
            if let Some(id) = id
                && !app_state.history_deletion_pending(OPENCODE_ID, &id)
                && app_state.contains_session(&session)
                && !session.is_deleting()
                && session.upstream_session_id().is_none()
            {
                session.update_upstream_session_id(id);
                return;
            }
            drop(_reconciliation);
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
}

pub(super) fn start_fork_reconciler(session: &Arc<Session>, app_state: Arc<AppState>) {
    let weak = Arc::downgrade(session);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(500)).await;
            let Some(session) = weak.upgrade() else {
                return;
            };
            if session.is_deleting() {
                return;
            }
            let Some(current_id) = session.upstream_session_id() else {
                continue;
            };
            let (directory, launched_at) = session.correlation_details();
            drop(session);
            let successor = crate::history::fork_successor_id(
                app_state.history_pool(),
                &current_id,
                &directory,
                launched_at,
            )
            .await;
            if let Ok(Some(id)) = successor {
                let _reconciliation = app_state.history_reconciliation().lock().await;
                if let Some(session) = weak.upgrade()
                    && !app_state.history_deletion_pending(OPENCODE_ID, &id)
                    && !session.is_deleting()
                {
                    session.update_upstream_session_id(id);
                }
            }
        }
    });
}
