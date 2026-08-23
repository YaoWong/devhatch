mod address;
mod discovery;
mod git;
mod store;
mod sync;

#[cfg(test)]
mod tests;

use crate::{Error, Repository, Result, Skillink, filesystem::remove_managed_directory};
use address::parse_repository_address;
pub use address::repository_name;
use discovery::{discover_repository, materialize_internal_file_links};
use serde::Serialize;
use std::fs;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SyncItem {
    pub id: Option<String>,
    pub slug: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SyncPlan {
    pub repository_id: String,
    pub old_commit: Option<String>,
    pub new_commit: String,
    pub noop: bool,
    pub add: Vec<SyncItem>,
    pub update: Vec<SyncItem>,
    pub remove: Vec<SyncItem>,
}

pub type SyncResult = SyncPlan;

impl Skillink {
    pub async fn add_repository(&self, url: &str, git_ref: Option<&str>) -> Result<Repository> {
        let address = parse_repository_address(url)?;
        let id = Uuid::new_v4().to_string();
        let (commit, checkout) = self
            .clone_repository(&address.clone_url, git_ref, false)
            .await?;
        let discovered = match materialize_internal_file_links(&checkout)
            .and_then(|()| discover_repository(&checkout))
        {
            Ok(discovered) => discovered,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
        let destination = self.repository_revision(&id, &commit);
        let published = match self.publish_revision(&checkout, &destination) {
            Ok(published) => published,
            Err(error) => {
                let _ = fs::remove_dir_all(checkout);
                return Err(error);
            }
        };
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
            "SELECT id, COALESCE(name, '') AS name, url, git_ref, commit_hash, sync_version FROM repositories ORDER BY name, url",
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
