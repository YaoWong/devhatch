use super::manifest::parse_permissive;
use crate::{
    Error, Result, Skill, Skillink,
    filesystem::{copy_directory_safely, publish_directory, remove_managed_directory},
    validation::{validate_description, validate_slug},
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
        let manifest = source.join("SKILL.md");
        let manifest_metadata = match fs::symlink_metadata(&manifest) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(Error::MissingManifest);
            }
            Err(error) => return Err(error.into()),
        };
        if manifest_metadata.file_type().is_symlink() || !manifest_metadata.is_file() {
            return Err(Error::UnsafeEntry(manifest.display().to_string()));
        }
        let staging = self.staging_path();
        copy_directory_safely(source, &staging)?;
        let imported = (|| {
            let metadata = parse_permissive(&staging.join("SKILL.md"))?;
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
            Ok((slug, metadata.1.unwrap_or_default()))
        })();
        let (slug, description) = match imported {
            Ok(imported) => imported,
            Err(error) => {
                let _ = fs::remove_dir_all(&staging);
                return Err(error);
            }
        };
        let id = Uuid::new_v4().to_string();
        let destination = self.root().join("custom").join(&id);
        publish_directory(&staging, &destination)?;
        if let Err(error) = self.insert_custom_skill(&id, &slug, &description).await {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        self.get_skill(&id).await
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
}
