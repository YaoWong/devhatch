use crate::{Error, Result, database};
use sqlx::SqlitePool;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use uuid::Uuid;

#[derive(Clone)]
pub struct Skillink {
    root: PathBuf,
    pool: SqlitePool,
}

impl Skillink {
    pub async fn open(home: Option<PathBuf>) -> Result<Self> {
        let root = match home {
            Some(path) => path,
            None => default_home()?,
        };
        prepare_root(&root)?;
        let root = fs::canonicalize(&root)?;
        for directory in ["repositories", "custom", "profiles", "staging"] {
            prepare_managed_directory(&root, directory)?;
        }
        let database_path = root.join("skillink.sqlite3");
        secure_database_files(&database_path)?;
        let pool = database::open(&root).await?;
        secure_database_files(&database_path)?;
        Ok(Self { root, pool })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    pub(crate) fn repository_revision(&self, repository_id: &str, commit: &str) -> PathBuf {
        self.root
            .join("repositories")
            .join(repository_id)
            .join("revisions")
            .join(commit)
    }

    pub(crate) fn staging_path(&self) -> PathBuf {
        self.root.join("staging").join(Uuid::new_v4().to_string())
    }
}

fn default_home() -> Result<PathBuf> {
    if let Some(path) = env::var_os("SKILLINK_HOME") {
        return Ok(PathBuf::from(path));
    }
    dirs::data_dir()
        .map(|path| path.join("skillink"))
        .ok_or_else(|| Error::Unsupported("unable to determine the user data directory".into()))
}

fn reject_symlink(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} must not be a symlink", path.display()),
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn prepare_root(root: &Path) -> io::Result<()> {
    reject_symlink(root)?;
    fs::create_dir_all(root)?;
    reject_symlink(root)?;
    secure_directory(root)
}

fn prepare_managed_directory(root: &Path, name: &str) -> io::Result<()> {
    let directory = root.join(name);
    reject_symlink(&directory)?;
    fs::create_dir(&directory).or_else(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            Ok(())
        } else {
            Err(error)
        }
    })?;
    reject_symlink(&directory)?;
    let canonical = fs::canonicalize(&directory)?;
    if canonical.parent() != Some(root) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} escapes the Skillink root", directory.display()),
        ));
    }
    secure_directory(&directory)
}

#[cfg(unix)]
fn secure_directory(path: &Path) -> io::Result<()> {
    let metadata = fs::metadata(path)?;
    if !metadata.is_dir() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            format!("{} is not owned by the current user", path.display()),
        ));
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn secure_directory(_: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn secure_database_files(path: &Path) -> io::Result<()> {
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if metadata.file_type().is_symlink()
            || !metadata.is_file()
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("{} is not a safe database file", path.display()),
            ));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn secure_database_files(_: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlinked_root_and_managed_directories() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let target = temp.path().join("target");
        fs::create_dir(&target).unwrap();
        let root_link = temp.path().join("root-link");
        symlink(&target, &root_link).unwrap();
        assert!(Skillink::open(Some(root_link)).await.is_err());

        let root = temp.path().join("root");
        fs::create_dir(&root).unwrap();
        symlink(&target, root.join("custom")).unwrap();
        assert!(Skillink::open(Some(root)).await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn secures_root_managed_directories_and_database() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        let app = Skillink::open(Some(root)).await.unwrap();
        for path in [
            app.root().to_path_buf(),
            app.root().join("repositories"),
            app.root().join("custom"),
            app.root().join("profiles"),
            app.root().join("staging"),
        ] {
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
        assert_eq!(
            fs::metadata(app.root().join("skillink.sqlite3"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
