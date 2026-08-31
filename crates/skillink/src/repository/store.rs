use super::{SyncPlan, discovery::DiscoveredSkill};
use crate::{Error, Repository, Result, Skillink};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub(super) struct ExistingSkill {
    pub(super) id: String,
    pub(super) slug: String,
    pub(super) description: String,
    pub(super) relative_path: String,
}

impl Skillink {
    pub(crate) async fn get_repository(&self, id: &str) -> Result<Repository> {
        sqlx::query_as::<_, Repository>(
            "SELECT id, name, url, git_ref, commit_hash, sync_version FROM repositories WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool())
        .await?
        .ok_or_else(|| Error::NotFound(format!("repository {id}")))
    }

    pub(super) async fn insert_repository(
        &self,
        id: &str,
        name: &str,
        url: &str,
        git_ref: Option<&str>,
        commit: &str,
        discovered: &[DiscoveredSkill],
    ) -> Result<()> {
        let mut transaction = self.pool().begin().await?;
        let insert = sqlx::query(
            "INSERT INTO repositories (id, name, url, git_ref, commit_hash) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(url)
        .bind(git_ref)
        .bind(commit)
        .execute(&mut *transaction)
        .await;
        map_repository_write(insert)?;
        for skill in discovered {
            let insert = sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES (?, ?, ?, 'repository', ?, ?, ?)")
                .bind(Uuid::new_v4().to_string()).bind(&skill.slug).bind(&skill.description)
                .bind(id).bind(commit).bind(&skill.relative_path).execute(&mut *transaction).await;
            map_skill_write(insert, &skill.slug, &skill.relative_path)?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(super) async fn reconcile_repository(
        &self,
        repository: &Repository,
        discovered: &[DiscoveredSkill],
        plan: &SyncPlan,
    ) -> Result<()> {
        let mut transaction = self.pool().begin().await?;
        let current: Option<(String, i64)> =
            sqlx::query_as("SELECT commit_hash, sync_version FROM repositories WHERE id = ?")
                .bind(&repository.id)
                .fetch_optional(&mut *transaction)
                .await?;
        let Some((commit, version)) = current else {
            return Err(Error::ConcurrentSync {
                repository_id: repository.id.clone(),
            });
        };
        if commit != repository.commit_hash || version != repository.sync_version {
            return Err(Error::ConcurrentSync {
                repository_id: repository.id.clone(),
            });
        }
        for id in plan.remove.iter().filter_map(|item| item.id.as_ref()) {
            let references: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM profile_skills WHERE skill_id = ?")
                    .bind(id)
                    .fetch_one(&mut *transaction)
                    .await?;
            if references != 0 {
                return Err(Error::RepositorySkillInUse {
                    skill_id: id.clone(),
                });
            }
        }
        for item in &plan.remove {
            sqlx::query("DELETE FROM skills WHERE id = ? AND repository_id = ?")
                .bind(item.id.as_deref())
                .bind(&repository.id)
                .execute(&mut *transaction)
                .await?;
        }
        for skill in discovered {
            let existing: Option<String> = sqlx::query_scalar(
                "SELECT id FROM skills WHERE repository_id = ? AND relative_path = ?",
            )
            .bind(&repository.id)
            .bind(&skill.relative_path)
            .fetch_optional(&mut *transaction)
            .await?;
            if let Some(id) = existing {
                let update = sqlx::query("UPDATE skills SET slug = ?, description = ?, revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
                    .bind(&skill.slug).bind(&skill.description).bind(&plan.new_commit).bind(id).execute(&mut *transaction).await;
                map_skill_write(update, &skill.slug, &skill.relative_path)?;
            } else {
                let insert = sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES (?, ?, ?, 'repository', ?, ?, ?)")
                    .bind(Uuid::new_v4().to_string()).bind(&skill.slug).bind(&skill.description)
                    .bind(&repository.id).bind(&plan.new_commit).bind(&skill.relative_path).execute(&mut *transaction).await;
                map_skill_write(insert, &skill.slug, &skill.relative_path)?;
            }
        }
        let updated = sqlx::query("UPDATE repositories SET commit_hash = ?, sync_version = sync_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND commit_hash = ? AND sync_version = ?")
            .bind(&plan.new_commit).bind(&repository.id).bind(&repository.commit_hash)
            .bind(repository.sync_version).execute(&mut *transaction).await?;
        if updated.rows_affected() != 1 {
            return Err(Error::ConcurrentSync {
                repository_id: repository.id.clone(),
            });
        }
        transaction.commit().await?;
        Ok(())
    }

    pub(super) async fn repository_skills(&self, id: &str) -> Result<Vec<ExistingSkill>> {
        Ok(sqlx::query_as::<_, (String, String, String, String)>("SELECT id, slug, description, relative_path FROM skills WHERE repository_id = ? ORDER BY relative_path")
            .bind(id).fetch_all(self.pool()).await?.into_iter()
            .map(|(id, slug, description, relative_path)| ExistingSkill { id, slug, description, relative_path }).collect())
    }
}

fn map_repository_write(
    result: std::result::Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error>,
) -> Result<sqlx::sqlite::SqliteQueryResult> {
    result.map_err(|error| {
        if is_unique_violation(&error) {
            Error::Conflict("repository URL already exists".into())
        } else {
            Error::Database(error)
        }
    })
}

fn map_skill_write(
    result: std::result::Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error>,
    slug: &str,
    relative_path: &str,
) -> Result<sqlx::sqlite::SqliteQueryResult> {
    result.map_err(|error| {
        if is_unique_violation(&error) {
            Error::SkillConflict {
                slug: slug.to_owned(),
                relative_path: relative_path.to_owned(),
            }
        } else {
            Error::Database(error)
        }
    })
}

fn is_unique_violation(error: &sqlx::Error) -> bool {
    matches!(error, sqlx::Error::Database(database) if database.is_unique_violation())
}
