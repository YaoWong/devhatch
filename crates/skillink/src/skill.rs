use crate::{
    Error, Result, Skill, Skillink,
    filesystem::{copy_directory_safely, publish_directory, remove_managed_directory},
    manifest::{MAX_MANIFEST_SIZE, parse_permissive},
    validation::{validate_description, validate_relative_path, validate_slug},
};
use std::{fs, path::Path};
use uuid::Uuid;

impl Skillink {
    pub async fn create_skill(&self, slug: &str, description: &str) -> Result<Skill> {
        validate_slug(slug)?;
        validate_description(description)?;
        let id = Uuid::new_v4().to_string();
        let staging = self.staging_path();
        fs::create_dir(&staging)?;
        let name_json = serde_json::to_string(slug).expect("slug serialization cannot fail");
        let description_json =
            serde_json::to_string(description).expect("description serialization cannot fail");
        fs::write(
            staging.join("SKILL.md"),
            format!("---\nname: {name_json}\ndescription: {description_json}\n---\n"),
        )?;
        let destination = self.root().join("custom").join(&id);
        publish_directory(&staging, &destination)?;
        if let Err(error) = self.insert_custom_skill(&id, slug, description).await {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        self.get_skill(&id).await
    }

    pub async fn import_skill(&self, source: &Path, slug: Option<&str>) -> Result<Skill> {
        if !source.join("SKILL.md").is_file() {
            return Err(Error::MissingManifest);
        }
        let metadata = parse_permissive(&source.join("SKILL.md"))?;
        if let (Some(requested), Some(manifest)) = (slug, metadata.0.as_deref())
            && requested != manifest
        {
            return Err(Error::Manifest {
                path: source.join("SKILL.md").display().to_string(),
                message: "name must match the imported skill slug".into(),
            });
        }
        let slug = slug
            .map(str::to_owned)
            .or(metadata.0)
            .or_else(|| {
                source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_owned)
            })
            .ok_or_else(|| Error::InvalidSlug(source.display().to_string()))?;
        validate_slug(&slug)?;
        let description = metadata.1.unwrap_or_default();
        let id = Uuid::new_v4().to_string();
        let staging = self.staging_path();
        copy_directory_safely(source, &staging)?;
        let destination = self.root().join("custom").join(&id);
        publish_directory(&staging, &destination)?;
        if let Err(error) = self.insert_custom_skill(&id, &slug, &description).await {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        self.get_skill(&id).await
    }

    pub async fn list_skills(&self) -> Result<Vec<Skill>> {
        Ok(sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills ORDER BY slug",
        )
        .fetch_all(self.pool())
        .await?)
    }

    pub async fn remove_skill(&self, identifier: &str) -> Result<()> {
        let skill = self.resolve_skill(identifier).await?;
        let references: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM profile_skills WHERE skill_id = ?")
                .bind(&skill.id)
                .fetch_one(self.pool())
                .await?;
        if references != 0 {
            return Err(Error::Conflict("skill is enabled in a profile".into()));
        }
        sqlx::query("DELETE FROM skills WHERE id = ?")
            .bind(&skill.id)
            .execute(self.pool())
            .await?;
        if skill.source_type == "custom" {
            remove_managed_directory(self.root(), "custom", &skill.id)?;
        }
        Ok(())
    }

    pub async fn read_skill_manifest(&self, identifier: &str) -> Result<String> {
        let skill = self.resolve_skill(identifier).await?;
        let directory = self.skill_path(&skill)?;
        let canonical_root = fs::canonicalize(self.root())?;
        let canonical_directory = fs::canonicalize(&directory)?;
        if !canonical_directory.starts_with(&canonical_root) {
            return Err(Error::UnsafeEntry(directory.display().to_string()));
        }
        let manifest = canonical_directory.join("SKILL.md");
        let metadata = fs::symlink_metadata(&manifest)?;
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.len() > MAX_MANIFEST_SIZE
        {
            return Err(Error::UnsafeEntry(manifest.display().to_string()));
        }
        let canonical_manifest = fs::canonicalize(&manifest)?;
        if !canonical_manifest.starts_with(&canonical_directory) {
            return Err(Error::UnsafeEntry(manifest.display().to_string()));
        }
        Ok(fs::read_to_string(canonical_manifest)?)
    }

    pub(crate) async fn get_skill(&self, id: &str) -> Result<Skill> {
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

    async fn insert_custom_skill(&self, id: &str, slug: &str, description: &str) -> Result<()> {
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

    pub(crate) fn skill_path(&self, skill: &Skill) -> Result<std::path::PathBuf> {
        if skill.source_type == "custom" {
            return Ok(self.root().join("custom").join(&skill.id));
        }
        let repository_id = skill
            .repository_id
            .as_deref()
            .ok_or_else(|| Error::UnsafeEntry(skill.id.clone()))?;
        let revision = skill
            .revision
            .as_deref()
            .ok_or_else(|| Error::UnsafeEntry(skill.id.clone()))?;
        let relative = skill
            .relative_path
            .as_deref()
            .ok_or_else(|| Error::UnsafeEntry(skill.id.clone()))?;
        validate_relative_path(Path::new(relative))?;
        Ok(self
            .repository_revision(repository_id, revision)
            .join(relative))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn creates_custom_skill_and_enforces_unique_slug() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let skill = app.create_skill("my-skill", "Useful").await.unwrap();
        assert!(
            temp.path()
                .join("custom")
                .join(&skill.id)
                .join("SKILL.md")
                .is_file()
        );
        assert!(app.create_skill("MY-SKILL", "Duplicate").await.is_err());
        assert_eq!(app.list_skills().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn reads_skill_manifest() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let skill = app
            .create_skill("readable", "Readable skill")
            .await
            .unwrap();
        let content = app.read_skill_manifest(&skill.id).await.unwrap();
        assert!(content.contains("name: \"readable\""));
        assert!(content.contains("description: \"Readable skill\""));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn import_rejects_symlink() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("SKILL.md"), "---\nname: imported\n---\n").unwrap();
        symlink("SKILL.md", source.join("escape")).unwrap();
        let app = Skillink::open(Some(temp.path().join("home")))
            .await
            .unwrap();
        assert!(matches!(
            app.import_skill(&source, None).await,
            Err(Error::UnsafeEntry(_))
        ));
    }
}
