mod custom;
pub(crate) mod manifest;
mod store;

use crate::{Error, Result, Skill, Skillink, validation::validate_relative_path};
use manifest::MAX_MANIFEST_SIZE;
use std::{fs, path::Path};

impl Skillink {
    pub async fn list_skills(&self) -> Result<Vec<Skill>> {
        Ok(sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills ORDER BY slug",
        )
        .fetch_all(self.pool())
        .await?)
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
