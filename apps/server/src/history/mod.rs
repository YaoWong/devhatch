mod api;
pub(crate) mod codex;
mod model;
pub(crate) mod opencode;
pub(crate) mod pi;
mod process;
mod service;
pub(crate) mod trae;

pub(crate) use api::{list, prepare_error_response, remove};
pub(crate) use model::{
    DeleteError, HistoryBackend, HistoryError, HistoryItem, PreparedLaunch, Presence,
};
pub(crate) use opencode::{
    fork_successor, fork_successor_id, new_session_candidates, unique_unclaimed_session,
};
pub(crate) use process::command_output_with_timeout;

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn launch_preparation_covers_backend_new_sessions() {
        assert!(
            super::opencode::root_session_ids(None)
                .await
                .unwrap()
                .is_empty()
        );
        assert!(matches!(
            super::pi::prepare(Vec::new(), None).await.unwrap(),
            super::PreparedLaunch::PiNew { id } if super::pi::valid_session_id(&id)
        ));
    }
}
