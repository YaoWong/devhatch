use crate::{Error, Result, Skill, Skillink};

impl Skillink {
    pub(super) async fn get_skill(&self, id: &str) -> Result<Skill> {
        sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(self.pool())
        .await?
        .ok_or_else(|| Error::NotFound(format!("skill {id}")))
    }

    pub(crate) async fn resolve_skill(&self, identifier: &str) -> Result<Skill> {
        sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills WHERE id = ? OR slug = ? COLLATE NOCASE",
        )
        .bind(identifier)
        .bind(identifier)
        .fetch_optional(self.pool())
        .await?
        .ok_or_else(|| Error::NotFound(format!("skill {identifier}")))
    }

    pub(super) async fn insert_custom_skill(
        &self,
        id: &str,
        slug: &str,
        description: &str,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO skills (id, slug, description, source_type) VALUES (?, ?, ?, 'custom')",
        )
        .bind(id)
        .bind(slug)
        .bind(description)
        .execute(self.pool())
        .await?;
        Ok(())
    }
}
