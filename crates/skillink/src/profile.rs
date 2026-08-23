use crate::{Error, Profile, ProfileDetail, Result, Skill, Skillink, validation::validate_slug};
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

impl Skillink {
    pub async fn create_profile(&self, slug: &str) -> Result<Profile> {
        validate_slug(slug)?;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO profiles (id, slug) VALUES (?, ?)")
            .bind(&id)
            .bind(slug)
            .execute(self.pool())
            .await?;
        fs::create_dir_all(self.root().join("profiles").join(&id).join("generations"))?;
        self.resolve_profile(&id).await
    }

    pub async fn list_profiles(&self) -> Result<Vec<Profile>> {
        Ok(
            sqlx::query_as::<_, Profile>("SELECT id, slug FROM profiles ORDER BY slug")
                .fetch_all(self.pool())
                .await?,
        )
    }

    pub async fn show_profile(&self, identifier: &str) -> Result<ProfileDetail> {
        let profile = self.resolve_profile(identifier).await?;
        let skills = sqlx::query_as::<_, Skill>(
            "SELECT s.id, s.slug, s.description, s.source_type, s.repository_id, s.revision, s.relative_path FROM skills s JOIN profile_skills ps ON ps.skill_id = s.id WHERE ps.profile_id = ? ORDER BY s.slug",
        )
        .bind(&profile.id)
        .fetch_all(self.pool())
        .await?;
        Ok(ProfileDetail { profile, skills })
    }

    pub async fn enable_skill(&self, profile: &str, skill: &str) -> Result<()> {
        let profile = self.resolve_profile(profile).await?;
        let skill = self.resolve_skill(skill).await?;
        sqlx::query("INSERT OR IGNORE INTO profile_skills (profile_id, skill_id) VALUES (?, ?)")
            .bind(profile.id)
            .bind(skill.id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn disable_skill(&self, profile: &str, skill: &str) -> Result<()> {
        let profile = self.resolve_profile(profile).await?;
        let skill = self.resolve_skill(skill).await?;
        sqlx::query("DELETE FROM profile_skills WHERE profile_id = ? AND skill_id = ?")
            .bind(profile.id)
            .bind(skill.id)
            .execute(self.pool())
            .await?;
        Ok(())
    }

    pub async fn replace_profile_skills(&self, profile: &str, skills: &[String]) -> Result<()> {
        let profile = self.resolve_profile(profile).await?;
        let mut skill_ids = Vec::new();
        for identifier in skills {
            let id = self.resolve_skill(identifier).await?.id;
            if !skill_ids.contains(&id) {
                skill_ids.push(id);
            }
        }
        let mut transaction = self.pool().begin().await?;
        sqlx::query("DELETE FROM profile_skills WHERE profile_id = ?")
            .bind(&profile.id)
            .execute(&mut *transaction)
            .await?;
        for skill_id in skill_ids {
            sqlx::query("INSERT INTO profile_skills (profile_id, skill_id) VALUES (?, ?)")
                .bind(&profile.id)
                .bind(skill_id)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    #[cfg(unix)]
    pub async fn apply_profile(&self, identifier: &str) -> Result<PathBuf> {
        use std::os::unix::fs::symlink;

        let detail = self.show_profile(identifier).await?;
        let profile_root = self.root().join("profiles").join(&detail.profile.id);
        let generation_id = Uuid::new_v4().to_string();
        let generation = profile_root.join("generations").join(&generation_id);
        fs::create_dir(&generation)?;
        let canonical_root = fs::canonicalize(self.root())?;
        for skill in detail.skills {
            let target = self.skill_path(&skill)?;
            let canonical_target = fs::canonicalize(&target)
                .map_err(|_| Error::NotFound(format!("skill content for {}", skill.slug)))?;
            if !canonical_target.starts_with(&canonical_root) {
                let _ = fs::remove_dir_all(&generation);
                return Err(Error::UnsafeEntry(target.display().to_string()));
            }
            symlink(&canonical_target, generation.join(&skill.slug))?;
        }
        let temporary = profile_root.join(format!(".current-{}", Uuid::new_v4()));
        symlink(Path::new("generations").join(&generation_id), &temporary)?;
        fs::rename(&temporary, profile_root.join("current"))?;
        Ok(generation)
    }

    #[cfg(not(unix))]
    pub async fn apply_profile(&self, _identifier: &str) -> Result<PathBuf> {
        Err(Error::Unsupported(
            "profile apply requires Unix symlinks".into(),
        ))
    }

    async fn resolve_profile(&self, identifier: &str) -> Result<Profile> {
        sqlx::query_as::<_, Profile>(
            "SELECT id, slug FROM profiles WHERE id = ? OR slug = ? COLLATE NOCASE",
        )
        .bind(identifier)
        .bind(identifier)
        .fetch_optional(self.pool())
        .await?
        .ok_or_else(|| Error::NotFound(format!("profile {identifier}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn replaces_profile_skills_atomically() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let first = app.create_skill("first", "First skill").await.unwrap();
        let second = app.create_skill("second", "Second skill").await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        app.enable_skill(&profile.id, &first.id).await.unwrap();

        app.replace_profile_skills(&profile.id, &[second.id.clone(), second.id.clone()])
            .await
            .unwrap();
        let detail = app.show_profile(&profile.id).await.unwrap();
        assert_eq!(detail.skills.len(), 1);
        assert_eq!(detail.skills[0].id, second.id);

        assert!(matches!(
            app.replace_profile_skills(&profile.id, &["missing".into()])
                .await,
            Err(Error::NotFound(_))
        ));
        assert_eq!(app.show_profile(&profile.id).await.unwrap().skills.len(), 1);

        app.replace_profile_skills(&profile.id, &[]).await.unwrap();
        assert!(
            app.show_profile(&profile.id)
                .await
                .unwrap()
                .skills
                .is_empty()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn applies_profile_with_current_links() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let skill = app.create_skill("linked", "Linked skill").await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        app.enable_skill(&profile.id, &skill.id).await.unwrap();
        let generation = app.apply_profile(&profile.id).await.unwrap();
        assert!(generation.join("linked").is_dir());
        let current = temp
            .path()
            .join("profiles")
            .join(&profile.id)
            .join("current");
        assert!(current.is_symlink());
        assert_eq!(
            fs::canonicalize(current).unwrap(),
            fs::canonicalize(generation).unwrap()
        );
        assert!(matches!(
            app.remove_skill(&skill.id).await,
            Err(Error::Conflict(_))
        ));
    }
}
