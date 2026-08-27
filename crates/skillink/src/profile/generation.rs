use crate::{Error, Result, Skillink};
use std::path::PathBuf;

#[cfg(unix)]
pub(super) async fn apply_profile(app: &Skillink, identifier: &str) -> Result<PathBuf> {
    apply_profile_with_ids(app, identifier, uuid::Uuid::new_v4(), uuid::Uuid::new_v4()).await
}

#[cfg(unix)]
async fn apply_profile_with_ids(
    app: &Skillink,
    identifier: &str,
    generation_id: uuid::Uuid,
    temporary_id: uuid::Uuid,
) -> Result<PathBuf> {
    use std::{fs, os::unix::fs::symlink, path::Path};

    let detail = app.show_profile(identifier).await?;
    let profile_root = app.root().join("profiles").join(&detail.profile.id);
    let generation_id = generation_id.to_string();
    let generation = profile_root.join("generations").join(&generation_id);
    fs::create_dir(&generation)?;
    let mut cleanup = GenerationGuard::new(generation.clone())?;
    let canonical_root = fs::canonicalize(app.root())?;
    for skill in detail.skills {
        let target = app.skill_path(&skill)?;
        let canonical_target = fs::canonicalize(&target)
            .map_err(|_| Error::NotFound(format!("skill content for {}", skill.slug)))?;
        if !canonical_target.starts_with(&canonical_root) {
            return Err(Error::UnsafeEntry(target.display().to_string()));
        }
        symlink(&canonical_target, generation.join(&skill.slug))?;
    }
    let temporary = profile_root.join(format!(".current-{temporary_id}"));
    let current_target = Path::new("generations").join(&generation_id);
    symlink(&current_target, &temporary)?;
    cleanup.track_temporary(temporary.clone())?;
    fs::rename(&temporary, profile_root.join("current"))?;
    cleanup.publish();
    Ok(generation)
}

#[cfg(unix)]
#[derive(Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
struct ManagedPath {
    path: PathBuf,
    identity: FileIdentity,
    kind: ManagedPathKind,
}

#[cfg(unix)]
#[derive(Clone, Copy)]
enum ManagedPathKind {
    Directory,
    Symlink,
}

#[cfg(unix)]
impl ManagedPath {
    fn directory(path: PathBuf) -> Result<Self> {
        validate_generation_path(&path)?;
        Self::new(path, ManagedPathKind::Directory)
    }

    fn symlink(path: PathBuf) -> Result<Self> {
        validate_temporary_path(&path)?;
        Self::new(path, ManagedPathKind::Symlink)
    }

    fn new(path: PathBuf, kind: ManagedPathKind) -> Result<Self> {
        let identity = path_identity(&path, kind)?;
        Ok(Self {
            path,
            identity,
            kind,
        })
    }

    fn remove(self) {
        if path_identity(&self.path, self.kind).ok() != Some(self.identity) {
            return;
        }
        match self.kind {
            ManagedPathKind::Directory => {
                let _ = std::fs::remove_dir_all(self.path);
            }
            ManagedPathKind::Symlink => {
                let _ = std::fs::remove_file(self.path);
            }
        }
    }
}

#[cfg(unix)]
struct GenerationGuard {
    generation: Option<ManagedPath>,
    temporary: Option<ManagedPath>,
}

#[cfg(unix)]
impl GenerationGuard {
    fn new(generation: PathBuf) -> Result<Self> {
        Ok(Self {
            generation: Some(ManagedPath::directory(generation)?),
            temporary: None,
        })
    }

    fn track_temporary(&mut self, temporary: PathBuf) -> Result<()> {
        self.temporary = Some(ManagedPath::symlink(temporary)?);
        Ok(())
    }

    fn publish(&mut self) {
        self.temporary = None;
        self.generation = None;
    }
}

#[cfg(unix)]
impl Drop for GenerationGuard {
    fn drop(&mut self) {
        if let Some(temporary) = self.temporary.take() {
            temporary.remove();
        }
        if let Some(generation) = self.generation.take() {
            generation.remove();
        }
    }
}

#[cfg(unix)]
fn validate_generation_path(path: &std::path::Path) -> Result<()> {
    validate_uuid_name(path)?;
    if path.parent().and_then(std::path::Path::file_name)
        != Some(std::ffi::OsStr::new("generations"))
    {
        return Err(Error::UnsafeEntry(path.display().to_string()));
    }
    Ok(())
}

#[cfg(unix)]
fn validate_temporary_path(path: &std::path::Path) -> Result<()> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(".current-"))
        .ok_or_else(|| Error::UnsafeEntry(path.display().to_string()))?;
    uuid::Uuid::parse_str(name).map_err(|_| Error::UnsafeEntry(path.display().to_string()))?;
    Ok(())
}

#[cfg(unix)]
fn validate_uuid_name(path: &std::path::Path) -> Result<()> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| Error::UnsafeEntry(path.display().to_string()))?;
    uuid::Uuid::parse_str(name).map_err(|_| Error::UnsafeEntry(path.display().to_string()))?;
    Ok(())
}

#[cfg(unix)]
fn path_identity(path: &std::path::Path, kind: ManagedPathKind) -> Result<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::symlink_metadata(path)?;
    let matches = match kind {
        ManagedPathKind::Directory => metadata.file_type().is_dir(),
        ManagedPathKind::Symlink => metadata.file_type().is_symlink(),
    };
    if !matches {
        return Err(Error::UnsafeEntry(path.display().to_string()));
    }
    Ok(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
pub(super) async fn apply_profile(_app: &Skillink, _identifier: &str) -> Result<PathBuf> {
    Err(Error::Unsupported(
        "profile apply requires Unix symlinks".into(),
    ))
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::*;
    #[cfg(unix)]
    use crate::{Error, Skillink};
    #[cfg(unix)]
    use std::{fs, os::unix::fs::symlink};
    #[cfg(unix)]
    use tempfile::TempDir;
    #[cfg(unix)]
    use uuid::Uuid;

    #[cfg(unix)]
    fn generation_path(temp: &TempDir, profile_id: &str, generation_id: Uuid) -> PathBuf {
        temp.path()
            .join("profiles")
            .join(profile_id)
            .join("generations")
            .join(generation_id.to_string())
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

    #[cfg(unix)]
    #[tokio::test]
    async fn current_temporary_conflict_removes_generation() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        let generation_id = Uuid::new_v4();
        let temporary_id = Uuid::new_v4();
        let temporary = temp
            .path()
            .join("profiles")
            .join(&profile.id)
            .join(format!(".current-{temporary_id}"));
        fs::write(&temporary, "occupied").unwrap();

        assert!(
            apply_profile_with_ids(&app, &profile.id, generation_id, temporary_id)
                .await
                .is_err()
        );
        assert!(!generation_path(&temp, &profile.id, generation_id).exists());
        assert_eq!(fs::read_to_string(temporary).unwrap(), "occupied");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn current_rename_failure_removes_generation_and_temporary() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        let profile_root = temp.path().join("profiles").join(&profile.id);
        let generation_id = Uuid::new_v4();
        let temporary_id = Uuid::new_v4();
        let temporary = profile_root.join(format!(".current-{temporary_id}"));
        fs::create_dir(profile_root.join("current")).unwrap();

        assert!(
            apply_profile_with_ids(&app, &profile.id, generation_id, temporary_id)
                .await
                .is_err()
        );
        assert!(!generation_path(&temp, &profile.id, generation_id).exists());
        assert!(fs::symlink_metadata(temporary).is_err());
        assert!(profile_root.join("current").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn guard_drop_removes_managed_paths() {
        let temp = TempDir::new().unwrap();
        let generation_id = Uuid::new_v4();
        let generation = temp
            .path()
            .join("generations")
            .join(generation_id.to_string());
        fs::create_dir_all(&generation).unwrap();
        let temporary = temp.path().join(format!(".current-{}", Uuid::new_v4()));
        symlink(
            std::path::Path::new("generations").join(generation_id.to_string()),
            &temporary,
        )
        .unwrap();
        let mut guard = GenerationGuard::new(generation.clone()).unwrap();
        guard.track_temporary(temporary.clone()).unwrap();

        drop(guard);

        assert!(fs::symlink_metadata(generation).is_err());
        assert!(fs::symlink_metadata(temporary).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn guard_drop_preserves_replacement_paths() {
        let temp = TempDir::new().unwrap();
        let generation_id = Uuid::new_v4();
        let generation = temp
            .path()
            .join("generations")
            .join(generation_id.to_string());
        fs::create_dir_all(&generation).unwrap();
        let temporary = temp.path().join(format!(".current-{}", Uuid::new_v4()));
        symlink("missing", &temporary).unwrap();
        let mut guard = GenerationGuard::new(generation.clone()).unwrap();
        guard.track_temporary(temporary.clone()).unwrap();
        fs::remove_dir(&generation).unwrap();
        symlink("replacement", &generation).unwrap();
        fs::remove_file(&temporary).unwrap();
        fs::write(&temporary, "replacement").unwrap();

        drop(guard);

        assert!(
            fs::symlink_metadata(&generation)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(temporary).unwrap(), "replacement");
    }
}
