mod generation;
mod store;

use crate::{Error, Profile, ProfileDetail, Result, Skillink, validation::validate_slug};
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

impl Skillink {
    pub async fn create_profile(&self, slug: &str) -> Result<Profile> {
        validate_slug(slug)?;
        self.create_profile_with_id(slug, &Uuid::new_v4().to_string())
            .await
    }

    async fn create_profile_with_id(&self, slug: &str, id: &str) -> Result<Profile> {
        Uuid::parse_str(id).map_err(|_| Error::UnsafeEntry(id.to_owned()))?;
        let staging = self.staging_path();
        fs::create_dir(&staging)?;
        let mut cleanup = ProfileCreationGuard::new(staging)?;
        fs::create_dir(cleanup.path().join("generations"))?;
        let mut transaction = self.pool().begin().await?;
        store::insert_profile(&mut transaction, id, slug).await?;
        let destination = self.root().join("profiles").join(id);
        validate_uuid_path(&destination)?;
        fs::rename(cleanup.path(), &destination)?;
        cleanup.publish(destination);
        transaction.commit().await?;
        cleanup.disarm();
        Ok(Profile {
            id: id.to_owned(),
            slug: slug.to_owned(),
        })
    }

    pub async fn list_profiles(&self) -> Result<Vec<Profile>> {
        store::list_profiles(self).await
    }

    pub async fn rename_profile(&self, id: &str, slug: &str) -> Result<Profile> {
        validate_slug(slug)?;
        store::rename_profile(self, id, slug).await
    }

    pub async fn show_profile(&self, identifier: &str) -> Result<ProfileDetail> {
        let profile = store::resolve_profile(self, identifier).await?;
        let skills = store::profile_skills(self, &profile.id).await?;
        Ok(ProfileDetail { profile, skills })
    }

    pub async fn enable_skill(&self, profile: &str, skill: &str) -> Result<()> {
        let profile = store::resolve_profile(self, profile).await?;
        let skill = self.resolve_skill(skill).await?;
        store::enable_skill(self, &profile.id, &skill.id).await
    }

    pub async fn disable_skill(&self, profile: &str, skill: &str) -> Result<()> {
        let profile = store::resolve_profile(self, profile).await?;
        let skill = self.resolve_skill(skill).await?;
        store::disable_skill(self, &profile.id, &skill.id).await
    }

    pub async fn replace_profile_skills(&self, profile: &str, skills: &[String]) -> Result<()> {
        let profile = store::resolve_profile(self, profile).await?;
        let mut skill_ids = Vec::new();
        for identifier in skills {
            let id = self.resolve_skill(identifier).await?.id;
            if !skill_ids.contains(&id) {
                skill_ids.push(id);
            }
        }
        store::replace_skills(self, &profile.id, &skill_ids).await
    }

    pub async fn apply_profile(&self, identifier: &str) -> Result<std::path::PathBuf> {
        generation::apply_profile(self, identifier).await
    }
}

struct ProfileCreationGuard {
    path: Option<PathBuf>,
    identity: DirectoryIdentity,
}

impl ProfileCreationGuard {
    fn new(path: PathBuf) -> Result<Self> {
        validate_uuid_path(&path)?;
        let identity = directory_identity(&path)?;
        Ok(Self {
            path: Some(path),
            identity,
        })
    }

    fn path(&self) -> &Path {
        self.path.as_deref().unwrap()
    }

    fn publish(&mut self, path: PathBuf) {
        self.path = Some(path);
    }

    fn disarm(&mut self) {
        self.path = None;
    }
}

impl Drop for ProfileCreationGuard {
    fn drop(&mut self) {
        if let Some(path) = self.path.take()
            && directory_identity(&path).ok() == Some(self.identity)
        {
            let _ = fs::remove_dir_all(path);
        }
    }
}

fn validate_uuid_path(path: &Path) -> Result<()> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| Error::UnsafeEntry(path.display().to_string()))?;
    Uuid::parse_str(name).map_err(|_| Error::UnsafeEntry(path.display().to_string()))?;
    Ok(())
}

#[cfg(unix)]
type DirectoryIdentity = (u64, u64);

#[cfg(unix)]
fn directory_identity(path: &Path) -> Result<DirectoryIdentity> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(Error::UnsafeEntry(path.display().to_string()));
    }
    Ok((metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
#[derive(Clone, Copy, PartialEq, Eq)]
struct DirectoryIdentity {
    created: std::time::SystemTime,
}

#[cfg(not(unix))]
fn directory_identity(path: &Path) -> Result<DirectoryIdentity> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(Error::UnsafeEntry(path.display().to_string()));
    }
    Ok(DirectoryIdentity {
        created: metadata.created()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Error;
    use tempfile::TempDir;

    #[test]
    fn creation_guard_removes_staging_directory() {
        let temp = TempDir::new().unwrap();
        let staging = temp.path().join(Uuid::new_v4().to_string());
        fs::create_dir(&staging).unwrap();

        drop(ProfileCreationGuard::new(staging.clone()).unwrap());

        assert!(!staging.exists());
    }

    #[test]
    fn creation_guard_removes_published_directory() {
        let temp = TempDir::new().unwrap();
        let staging = temp.path().join(Uuid::new_v4().to_string());
        let published = temp.path().join(Uuid::new_v4().to_string());
        fs::create_dir(&staging).unwrap();
        let mut guard = ProfileCreationGuard::new(staging.clone()).unwrap();
        fs::rename(&staging, &published).unwrap();
        guard.publish(published.clone());

        drop(guard);

        assert!(!published.exists());
    }

    #[test]
    fn disarmed_creation_guard_keeps_published_directory() {
        let temp = TempDir::new().unwrap();
        let staging = temp.path().join(Uuid::new_v4().to_string());
        let published = temp.path().join(Uuid::new_v4().to_string());
        fs::create_dir(&staging).unwrap();
        let mut guard = ProfileCreationGuard::new(staging.clone()).unwrap();
        fs::rename(&staging, &published).unwrap();
        guard.publish(published.clone());
        guard.disarm();

        drop(guard);

        assert!(published.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn creation_guard_does_not_remove_replacement_symlink() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let staging = temp.path().join(Uuid::new_v4().to_string());
        let target = temp.path().join("target");
        fs::create_dir(&staging).unwrap();
        fs::create_dir(&target).unwrap();
        let guard = ProfileCreationGuard::new(staging.clone()).unwrap();
        fs::remove_dir(&staging).unwrap();
        symlink(&target, &staging).unwrap();

        drop(guard);

        assert!(
            fs::symlink_metadata(&staging)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert!(target.is_dir());
    }

    #[tokio::test]
    async fn rename_failure_leaves_no_profile_row() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let id = Uuid::new_v4().to_string();
        let destination = temp.path().join("profiles").join(&id);
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("occupied"), []).unwrap();

        assert!(app.create_profile_with_id("default", &id).await.is_err());
        assert!(app.list_profiles().await.unwrap().is_empty());
        assert!(
            fs::read_dir(temp.path().join("staging"))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[tokio::test]
    async fn creates_profile() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();

        let profile = app.create_profile("default").await.unwrap();

        assert_eq!(profile.slug, "default");
        let profiles = app.list_profiles().await.unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, profile.id);
        assert!(
            temp.path()
                .join("profiles")
                .join(profile.id)
                .join("generations")
                .is_dir()
        );
        assert!(
            fs::read_dir(temp.path().join("staging"))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[tokio::test]
    async fn slug_conflict_removes_staging() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        app.create_profile("default").await.unwrap();

        assert!(app.create_profile("default").await.is_err());
        assert_eq!(app.list_profiles().await.unwrap().len(), 1);
        assert!(
            fs::read_dir(temp.path().join("staging"))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[tokio::test]
    async fn renames_profile_without_changing_identity_or_skills() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let skill = app.create_skill("first", "First skill").await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        app.enable_skill(&profile.id, &skill.id).await.unwrap();

        let renamed = app.rename_profile(&profile.id, "renamed").await.unwrap();

        assert_eq!(renamed.id, profile.id);
        assert_eq!(renamed.slug, "renamed");
        let detail = app.show_profile(&profile.id).await.unwrap();
        assert_eq!(detail.profile.id, renamed.id);
        assert_eq!(detail.profile.slug, renamed.slug);
        assert_eq!(detail.skills.len(), 1);
        assert!(temp.path().join("profiles").join(profile.id).is_dir());
    }

    #[tokio::test]
    async fn rejects_invalid_duplicate_and_missing_profile_renames() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        app.create_profile("other").await.unwrap();

        assert!(matches!(
            app.rename_profile(&profile.id, "Invalid").await,
            Err(Error::InvalidSlug(_))
        ));
        assert!(app.rename_profile(&profile.id, "other").await.is_err());
        assert!(matches!(
            app.rename_profile("missing", "renamed").await,
            Err(Error::NotFound(_))
        ));
        assert_eq!(
            app.show_profile(&profile.id).await.unwrap().profile.slug,
            "default"
        );
    }

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
}
