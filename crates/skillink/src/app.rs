use crate::{Error, Result};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    env, fs,
    path::{Path, PathBuf},
    str::FromStr,
    time::Duration,
};
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
        fs::create_dir_all(&root)?;
        for directory in ["repositories", "custom", "profiles", "staging"] {
            fs::create_dir_all(root.join(directory))?;
        }
        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}",
            root.join("skillink.sqlite3").display()
        ))?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        sqlx::migrate!().run(&pool).await?;
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
