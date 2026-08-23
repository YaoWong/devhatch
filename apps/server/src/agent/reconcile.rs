use std::{collections::HashSet, sync::Arc, time::Duration};

use crate::{session::Session, state::AppState};

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
            let _reconciliation = app_state.history_reconciliation().lock().await;
            let claimed = app_state.active_upstream_session_ids();
            drop(session);
            if let Ok(Some(id)) = crate::history::unique_new_session(
                app_state.history_pool(),
                &directory,
                launched_at,
                &baseline,
                &claimed,
            )
            .await
            {
                let Some(session) = weak.upgrade() else {
                    return;
                };
                session.update_upstream_session_id(id);
                return;
            }
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
            if let Ok(Some(id)) = successor
                && let Some(session) = weak.upgrade()
                && !session.is_deleting()
            {
                session.update_upstream_session_id(id);
            }
        }
    });
}
