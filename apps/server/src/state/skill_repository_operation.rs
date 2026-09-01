use std::sync::{Arc, Mutex};

use serde::Serialize;
use skillink::RepositoryProgress;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SkillRepositoryOperationKind {
    Add,
    Preview,
    Sync,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillRepositoryOperation {
    id: String,
    kind: SkillRepositoryOperationKind,
    repository_id: Option<String>,
    stage: &'static str,
    progress: u8,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

#[derive(Default)]
pub(crate) struct SkillRepositoryOperationCoordinator {
    state: Arc<Mutex<SkillRepositoryOperationState>>,
}

#[derive(Default)]
struct SkillRepositoryOperationState {
    operation: Option<SkillRepositoryOperation>,
    revision: u64,
    deletions: Vec<SkillRepositoryDeletion>,
}

struct SkillRepositoryDeletion {
    id: String,
    repository_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillRepositoryOperationSnapshot {
    operation: Option<SkillRepositoryOperation>,
    revision: u64,
}

pub(crate) struct SkillRepositoryOperationGuard {
    state: Arc<Mutex<SkillRepositoryOperationState>>,
    id: String,
}

pub(crate) struct SkillRepositoryDeletionGuard {
    state: Arc<Mutex<SkillRepositoryOperationState>>,
    id: String,
}

impl SkillRepositoryOperationCoordinator {
    pub(crate) fn begin(
        &self,
        kind: SkillRepositoryOperationKind,
        repository_id: Option<String>,
    ) -> Option<SkillRepositoryOperationGuard> {
        let mut state = self
            .state
            .lock()
            .expect("skill repository operation lock poisoned");
        if state.operation.is_some()
            || state.deletions.iter().any(|deletion| {
                kind == SkillRepositoryOperationKind::Add || deletion.repository_id == repository_id
            })
        {
            return None;
        }
        let id = Uuid::new_v4().to_string();
        state.operation = Some(SkillRepositoryOperation {
            id: id.clone(),
            kind,
            repository_id,
            stage: "queued",
            progress: 0,
            downloaded_bytes: None,
            total_bytes: None,
        });
        state.revision = state.revision.saturating_add(1);
        Some(SkillRepositoryOperationGuard {
            state: self.state.clone(),
            id,
        })
    }

    pub(crate) fn begin_deletion(
        &self,
        repository_id: Option<String>,
    ) -> Option<SkillRepositoryDeletionGuard> {
        let mut state = self
            .state
            .lock()
            .expect("skill repository operation lock poisoned");
        if state.operation.as_ref().is_some_and(|operation| {
            operation.repository_id.is_none()
                || repository_id.is_none()
                || operation.repository_id == repository_id
        }) {
            return None;
        }
        let id = Uuid::new_v4().to_string();
        state.deletions.push(SkillRepositoryDeletion {
            id: id.clone(),
            repository_id,
        });
        Some(SkillRepositoryDeletionGuard {
            state: self.state.clone(),
            id,
        })
    }

    pub(crate) fn current(&self) -> SkillRepositoryOperationSnapshot {
        let state = self
            .state
            .lock()
            .expect("skill repository operation lock poisoned");
        SkillRepositoryOperationSnapshot {
            operation: state.operation.clone(),
            revision: state.revision,
        }
    }
}

impl SkillRepositoryOperationGuard {
    pub(crate) fn reporter(&self) -> impl Fn(RepositoryProgress) + Send + Sync + 'static {
        let state = self.state.clone();
        let id = self.id.clone();
        move |update| {
            let mut state = state
                .lock()
                .expect("skill repository operation lock poisoned");
            if let Some(active) = state.operation.as_mut().filter(|active| active.id == id) {
                let progress = active.progress.max(update.progress);
                let changed = active.stage != update.stage
                    || active.progress != progress
                    || active.downloaded_bytes != update.downloaded_bytes
                    || active.total_bytes != update.total_bytes;
                active.stage = update.stage;
                active.progress = progress;
                active.downloaded_bytes = update.downloaded_bytes;
                active.total_bytes = update.total_bytes;
                if changed {
                    state.revision = state.revision.saturating_add(1);
                }
            }
        }
    }
}

impl Drop for SkillRepositoryOperationGuard {
    fn drop(&mut self) {
        let mut state = self
            .state
            .lock()
            .expect("skill repository operation lock poisoned");
        if state
            .operation
            .as_ref()
            .is_some_and(|operation| operation.id == self.id)
        {
            state.operation = None;
            state.revision = state.revision.saturating_add(1);
        }
    }
}

impl Drop for SkillRepositoryDeletionGuard {
    fn drop(&mut self) {
        let mut state = self
            .state
            .lock()
            .expect("skill repository operation lock poisoned");
        state.deletions.retain(|deletion| deletion.id != self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_concurrent_operations_and_releases_on_drop() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        assert_eq!(coordinator.current().revision, 0);
        let guard = coordinator
            .begin(SkillRepositoryOperationKind::Add, None)
            .unwrap();
        assert_eq!(coordinator.current().revision, 1);
        assert!(
            coordinator
                .begin(SkillRepositoryOperationKind::Sync, Some("repo".into()))
                .is_none()
        );
        drop(guard);
        let current = coordinator.current();
        assert!(current.operation.is_none());
        assert_eq!(current.revision, 2);
        assert!(
            coordinator
                .begin(SkillRepositoryOperationKind::Preview, Some("repo".into()))
                .is_some()
        );
    }

    #[test]
    fn deletion_conflicts_only_with_relevant_repository_operations() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        let operation = coordinator
            .begin(SkillRepositoryOperationKind::Sync, Some("repo-a".into()))
            .unwrap();
        assert!(coordinator.begin_deletion(Some("repo-a".into())).is_none());
        assert!(coordinator.begin_deletion(Some("repo-b".into())).is_some());
        drop(operation);

        let deletion = coordinator.begin_deletion(Some("repo-a".into())).unwrap();
        assert!(
            coordinator
                .begin(SkillRepositoryOperationKind::Preview, Some("repo-a".into()))
                .is_none()
        );
        assert!(
            coordinator
                .begin(SkillRepositoryOperationKind::Preview, Some("repo-b".into()))
                .is_some()
        );
        drop(deletion);
    }

    #[test]
    fn add_conflicts_with_any_repository_deletion() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        let _deletion = coordinator.begin_deletion(Some("repo".into())).unwrap();
        assert!(
            coordinator
                .begin(SkillRepositoryOperationKind::Add, None)
                .is_none()
        );
    }

    #[test]
    fn unrelated_custom_skill_deletion_needs_no_repository_guard() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        let _operation = coordinator
            .begin(SkillRepositoryOperationKind::Sync, Some("repo".into()))
            .unwrap();
        assert!(
            coordinator
                .begin_deletion(Some("other-repo".into()))
                .is_some()
        );
    }

    #[test]
    fn custom_skill_deletion_does_not_block_repository_specific_operation() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        let _deletion = coordinator.begin_deletion(None).unwrap();
        assert!(
            coordinator
                .begin(SkillRepositoryOperationKind::Sync, Some("repo".into()))
                .is_some()
        );
    }

    #[test]
    fn revision_saturates_without_overflowing() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        coordinator.state.lock().unwrap().revision = u64::MAX;
        let operation = coordinator
            .begin(SkillRepositoryOperationKind::Sync, Some("repo".into()))
            .unwrap();
        assert_eq!(coordinator.current().revision, u64::MAX);
        drop(operation);
        assert_eq!(coordinator.current().revision, u64::MAX);
    }

    #[test]
    fn progress_is_monotonic_and_guard_owned() {
        let coordinator = SkillRepositoryOperationCoordinator::default();
        let guard = coordinator
            .begin(SkillRepositoryOperationKind::Sync, Some("repo".into()))
            .unwrap();
        let report = guard.reporter();
        report(RepositoryProgress {
            stage: "receiving",
            progress: 60,
            downloaded_bytes: Some(100),
            total_bytes: Some(200),
        });
        report(RepositoryProgress {
            stage: "resolving",
            progress: 50,
            downloaded_bytes: None,
            total_bytes: None,
        });
        let current = coordinator.current();
        let operation = current.operation.unwrap();
        assert_eq!(operation.progress, 60);
        assert_eq!(operation.stage, "resolving");
        assert_eq!(operation.repository_id.as_deref(), Some("repo"));
        assert_eq!(current.revision, 3);
        drop(guard);
        report(RepositoryProgress {
            stage: "saving",
            progress: 95,
            downloaded_bytes: None,
            total_bytes: None,
        });
        let current = coordinator.current();
        assert!(current.operation.is_none());
        assert_eq!(current.revision, 4);
    }
}
