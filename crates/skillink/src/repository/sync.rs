use super::{
    ProgressReporter, SyncPlan, SyncResult,
    discovery::{DiscoveredSkill, discover_repository},
    git::valid_commit,
    links::materialize_internal_file_links,
    plan::build_plan,
    report,
};
use crate::{Error, Repository, Result, Skillink, filesystem::publish_directory};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;

pub(super) struct PreparedSync {
    pub(super) repository: Repository,
    checkout: Option<PathBuf>,
    pub(super) discovered: Vec<DiscoveredSkill>,
    pub(super) plan: SyncPlan,
}

impl Drop for PreparedSync {
    fn drop(&mut self) {
        if let Some(checkout) = self.checkout.take() {
            let _ = fs::remove_dir_all(checkout);
        }
    }
}

impl Skillink {
    pub async fn preview_repository_sync(&self, id: &str) -> Result<SyncPlan> {
        self.preview_repository_sync_with_progress(id, |_| {}).await
    }

    pub async fn preview_repository_sync_with_progress<F>(
        &self,
        id: &str,
        progress: F,
    ) -> Result<SyncPlan>
    where
        F: Fn(super::RepositoryProgress) + Send + Sync + 'static,
    {
        let progress: ProgressReporter = Arc::new(progress);
        Ok(self
            .prepare_repository_sync(id, false, Some(progress))
            .await?
            .plan
            .clone())
    }

    pub async fn sync_repository(&self, id: &str) -> Result<SyncResult> {
        self.sync_repository_with_progress(id, |_| {}).await
    }

    pub async fn sync_repository_with_progress<F>(
        &self,
        id: &str,
        progress: F,
    ) -> Result<SyncResult>
    where
        F: Fn(super::RepositoryProgress) + Send + Sync + 'static,
    {
        self.sync_repository_with_transport(id, false, Some(Arc::new(progress)))
            .await
    }

    pub(super) async fn sync_repository_with_transport(
        &self,
        id: &str,
        local: bool,
        progress: Option<ProgressReporter>,
    ) -> Result<SyncResult> {
        let mut prepared = self
            .prepare_repository_sync(id, local, progress.clone())
            .await?;
        if prepared.plan.noop {
            return Ok(prepared.plan.clone());
        }
        report_if(&progress, "publishing", 90);
        let checkout = prepared
            .checkout
            .take()
            .ok_or_else(|| Error::UnsafeEntry("missing repository staging directory".into()))?;
        let destination = self.repository_revision(id, &prepared.plan.new_commit);
        let published = match self.publish_revision(&checkout, &destination) {
            Ok(published) => published,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
        report_if(&progress, "saving", 95);
        let result = self
            .reconcile_repository(&prepared.repository, &prepared.discovered, &prepared.plan)
            .await;
        if let Err(error) = &result
            && published
            && !matches!(error, Error::ConcurrentSync { .. })
        {
            let referenced: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM repositories WHERE id = ? AND commit_hash = ?",
            )
            .bind(id)
            .bind(&prepared.plan.new_commit)
            .fetch_one(self.pool())
            .await
            .unwrap_or(1);
            if referenced == 0 {
                let _ = self.remove_revision(id, &prepared.plan.new_commit);
            }
        }
        result?;
        Ok(prepared.plan.clone())
    }

    pub(super) async fn prepare_repository_sync(
        &self,
        id: &str,
        local: bool,
        progress: Option<ProgressReporter>,
    ) -> Result<PreparedSync> {
        let repository = self.get_repository(id).await?;
        let existing = self.repository_skills(id).await?;
        let (new_commit, checkout) = self
            .clone_repository(
                &repository.url,
                repository.git_ref.as_deref(),
                local,
                progress.clone(),
            )
            .await?;
        report_if(&progress, "discovering", 80);
        let discovered = match materialize_internal_file_links(&checkout)
            .and_then(|()| discover_repository(&checkout))
        {
            Ok(discovered) => discovered,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
        report_if(&progress, "planning", 85);
        let plan = build_plan(
            id,
            Some(repository.commit_hash.clone()),
            new_commit,
            &existing,
            &discovered,
        );
        Ok(PreparedSync {
            repository,
            checkout: Some(checkout),
            discovered,
            plan,
        })
    }

    pub(super) fn publish_revision(&self, checkout: &Path, destination: &Path) -> Result<bool> {
        if destination.exists() {
            fs::remove_dir_all(checkout)?;
            return Ok(false);
        }
        publish_directory(checkout, destination)?;
        Ok(true)
    }

    fn remove_revision(&self, repository_id: &str, commit: &str) -> Result<()> {
        Uuid::parse_str(repository_id).map_err(|_| Error::UnsafeEntry(repository_id.to_owned()))?;
        if !valid_commit(commit) {
            return Err(Error::UnsafeEntry(commit.to_owned()));
        }
        let revision = self.repository_revision(repository_id, commit);
        if revision.exists() {
            fs::remove_dir_all(revision)?;
        }
        Ok(())
    }
}

fn report_if(progress: &Option<ProgressReporter>, stage: &'static str, percent: u8) {
    if let Some(progress) = progress {
        report(progress, stage, percent);
    }
}
