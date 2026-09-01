mod address;
mod discovery;
mod git;
mod links;
mod plan;
mod store;
mod sync;

#[cfg(test)]
mod tests;

pub use plan::{SyncItem, SyncPlan};
pub type SyncResult = SyncPlan;

use crate::{Error, Repository, Result, Skillink, filesystem::remove_managed_directory};
use address::parse_repository_address;
pub use address::repository_name;
use discovery::discover_repository;
use links::materialize_internal_file_links;
use std::{fs, sync::Arc};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryProgress {
    pub stage: &'static str,
    pub progress: u8,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

pub(super) type ProgressReporter = Arc<dyn Fn(RepositoryProgress) + Send + Sync>;

pub(super) fn report(progress: &ProgressReporter, stage: &'static str, percent: u8) {
    progress(RepositoryProgress {
        stage,
        progress: percent,
        downloaded_bytes: None,
        total_bytes: None,
    });
}

impl Skillink {
    pub async fn add_repository(&self, url: &str, git_ref: Option<&str>) -> Result<Repository> {
        self.add_repository_with_progress(url, git_ref, |_| {})
            .await
    }

    pub async fn add_repository_with_progress<F>(
        &self,
        url: &str,
        git_ref: Option<&str>,
        progress: F,
    ) -> Result<Repository>
    where
        F: Fn(RepositoryProgress) + Send + Sync + 'static,
    {
        let progress: ProgressReporter = Arc::new(progress);
        let address = parse_repository_address(url)?;
        let id = Uuid::new_v4().to_string();
        let (commit, checkout) = self
            .clone_repository(&address.clone_url, git_ref, false, Some(progress.clone()))
            .await?;
        report(&progress, "discovering", 80);
        let discovered = match materialize_internal_file_links(&checkout)
            .and_then(|()| discover_repository(&checkout))
        {
            Ok(discovered) => discovered,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
        report(&progress, "planning", 85);
        let destination = self.repository_revision(&id, &commit);
        report(&progress, "publishing", 90);
        let published = match self.publish_revision(&checkout, &destination) {
            Ok(published) => published,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
        report(&progress, "saving", 95);
        let result = self
            .insert_repository(
                &id,
                url.trim(),
                &address.clone_url,
                git_ref,
                &commit,
                &discovered,
            )
            .await;
        if let Err(error) = result {
            if published {
                let _ = fs::remove_dir_all(self.root().join("repositories").join(&id));
            }
            return Err(error);
        }
        self.get_repository(&id).await
    }

    pub async fn list_repositories(&self) -> Result<Vec<Repository>> {
        Ok(sqlx::query_as::<_, Repository>(
            "SELECT id, name, url, git_ref, commit_hash, sync_version FROM repositories ORDER BY name, url",
        )
        .fetch_all(self.pool())
        .await?)
    }

    pub async fn rename_repository(&self, id: &str, name: &str) -> Result<Repository> {
        let name = name.trim();
        if name.is_empty() || name.len() > 2048 || name.bytes().any(|byte| byte.is_ascii_control())
        {
            return Err(Error::InvalidRepositoryName);
        }
        let result = sqlx::query(
            "UPDATE repositories SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(name)
        .bind(id)
        .execute(self.pool())
        .await?;
        if result.rows_affected() == 0 {
            return Err(Error::NotFound(format!("repository {id}")));
        }
        self.get_repository(id).await
    }

    pub async fn remove_repository(&self, id: &str) -> Result<()> {
        self.get_repository(id).await?;
        let references: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM profile_skills ps JOIN skills s ON s.id = ps.skill_id WHERE s.repository_id = ?")
            .bind(id).fetch_one(self.pool()).await?;
        if references != 0 {
            return Err(Error::Conflict(
                "repository skills are enabled in a profile".into(),
            ));
        }
        let mut transaction = self.pool().begin().await?;
        sqlx::query("DELETE FROM skills WHERE repository_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM repositories WHERE id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        remove_managed_directory(self.root(), "repositories", id)
    }
}
