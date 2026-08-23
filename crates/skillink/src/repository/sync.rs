use super::{
    SyncItem, SyncPlan, SyncResult,
    discovery::{DiscoveredSkill, discover_repository},
    git::valid_commit,
    store::ExistingSkill,
};
use crate::{Error, Repository, Result, Skillink, filesystem::publish_directory};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
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
        Ok(self.prepare_repository_sync(id, false).await?.plan.clone())
    }

    pub async fn sync_repository(&self, id: &str) -> Result<SyncResult> {
        self.sync_repository_with_transport(id, false).await
    }

    pub(super) async fn sync_repository_with_transport(
        &self,
        id: &str,
        local: bool,
    ) -> Result<SyncResult> {
        let mut prepared = self.prepare_repository_sync(id, local).await?;
        if prepared.plan.noop {
            return Ok(prepared.plan.clone());
        }
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
        let result = self.reconcile_repository(&prepared).await;
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
    ) -> Result<PreparedSync> {
        let repository = self.get_repository(id).await?;
        let existing = self.repository_skills(id).await?;
        let (new_commit, checkout) = self
            .clone_repository(&repository.url, repository.git_ref.as_deref(), local)
            .await?;
        let discovered = match discover_repository(&checkout) {
            Ok(discovered) => discovered,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
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

pub(super) fn build_plan(
    repository_id: &str,
    old_commit: Option<String>,
    new_commit: String,
    existing: &[ExistingSkill],
    discovered: &[DiscoveredSkill],
) -> SyncPlan {
    let same_commit = old_commit.as_deref() == Some(new_commit.as_str());
    let old: BTreeMap<&str, &ExistingSkill> = existing
        .iter()
        .map(|skill| (skill.relative_path.as_str(), skill))
        .collect();
    let new: BTreeMap<&str, &DiscoveredSkill> = discovered
        .iter()
        .map(|skill| (skill.relative_path.as_str(), skill))
        .collect();
    let add: Vec<SyncItem> = new
        .iter()
        .filter(|(path, _)| !old.contains_key(*path))
        .map(|(_, skill)| sync_item(None, &skill.slug, &skill.relative_path))
        .collect();
    let update: Vec<SyncItem> = new
        .iter()
        .filter_map(|(path, skill)| {
            old.get(path).and_then(|old| {
                let metadata_changed =
                    old.slug != skill.slug || old.description != skill.description;
                (!same_commit || metadata_changed)
                    .then(|| sync_item(Some(old.id.clone()), &skill.slug, &skill.relative_path))
            })
        })
        .collect();
    let remove: Vec<SyncItem> = old
        .iter()
        .filter(|(path, _)| !new.contains_key(*path))
        .map(|(_, skill)| sync_item(Some(skill.id.clone()), &skill.slug, &skill.relative_path))
        .collect();
    SyncPlan {
        repository_id: repository_id.to_owned(),
        old_commit,
        new_commit,
        noop: same_commit && add.is_empty() && update.is_empty() && remove.is_empty(),
        add,
        update,
        remove,
    }
}

fn sync_item(id: Option<String>, slug: &str, relative_path: &str) -> SyncItem {
    SyncItem {
        id,
        slug: slug.to_owned(),
        relative_path: relative_path.to_owned(),
    }
}
