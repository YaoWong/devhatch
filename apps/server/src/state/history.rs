use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

pub(crate) struct OpenCodeHistoryPool {
    path: PathBuf,
    state: tokio::sync::Mutex<Option<PoolState>>,
    connecting: tokio::sync::Mutex<()>,
    generation: AtomicU64,
}

struct PoolState {
    pool: SqlitePool,
    identity: FileIdentity,
    generation: u64,
}

#[derive(Clone)]
pub(crate) struct HistoryPoolHandle {
    pub(crate) pool: SqlitePool,
    generation: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

impl OpenCodeHistoryPool {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path,
            state: tokio::sync::Mutex::new(None),
            connecting: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
        }
    }

    pub(crate) async fn get(&self) -> Option<HistoryPoolHandle> {
        let identity = file_identity(&self.path)?;
        {
            let state = self.state.lock().await;
            if let Some(current) = state.as_ref()
                && current.identity == identity
                && !current.pool.is_closed()
            {
                return Some(HistoryPoolHandle {
                    pool: current.pool.clone(),
                    generation: current.generation,
                });
            }
        }
        let _connecting = self.connecting.lock().await;
        let identity = file_identity(&self.path)?;
        {
            let state = self.state.lock().await;
            if let Some(current) = state.as_ref()
                && current.identity == identity
                && !current.pool.is_closed()
            {
                return Some(HistoryPoolHandle {
                    pool: current.pool.clone(),
                    generation: current.generation,
                });
            }
        }
        let options = SqliteConnectOptions::new()
            .filename(&self.path)
            .read_only(true)
            .busy_timeout(Duration::from_secs(2));
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("PRAGMA query_only = ON")
                        .execute(connection)
                        .await?;
                    Ok(())
                })
            })
            .connect_with(options)
            .await
            .ok()?;
        if file_identity(&self.path) != Some(identity) {
            pool.close().await;
            return None;
        }
        let generation = self
            .generation
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);
        let mut state = self.state.lock().await;
        *state = Some(PoolState {
            pool: pool.clone(),
            identity,
            generation,
        });
        Some(HistoryPoolHandle { pool, generation })
    }

    pub(crate) async fn invalidate(&self, handle: &HistoryPoolHandle) {
        let mut state = self.state.lock().await;
        if state
            .as_ref()
            .is_some_and(|current| current.generation == handle.generation)
        {
            state.take();
        }
    }
}

#[cfg(unix)]
fn file_identity(path: &Path) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::metadata(path).ok()?;
    metadata.is_file().then_some(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(not(unix))]
fn file_identity(path: &Path) -> Option<FileIdentity> {
    let metadata = std::fs::metadata(path).ok()?;
    metadata.is_file().then_some(FileIdentity {
        device: metadata.len(),
        inode: metadata
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos() as u64,
    })
}

pub(crate) struct HistoryCoordinator {
    reconciliation: tokio::sync::Mutex<()>,
    deletions: Mutex<HashSet<(String, String)>>,
}

impl Default for HistoryCoordinator {
    fn default() -> Self {
        Self {
            reconciliation: tokio::sync::Mutex::new(()),
            deletions: Mutex::new(HashSet::new()),
        }
    }
}

impl HistoryCoordinator {
    pub(crate) fn lock(&self) -> &tokio::sync::Mutex<()> {
        &self.reconciliation
    }

    pub(crate) fn begin(
        self: &std::sync::Arc<Self>,
        agent_id: &str,
        id: &str,
    ) -> Option<HistoryDeletionGuard> {
        let agent_id = agent_id.to_string();
        let id = id.to_string();
        self.deletions
            .lock()
            .expect("history deletions lock poisoned")
            .insert((agent_id.clone(), id.clone()))
            .then(|| HistoryDeletionGuard {
                coordinator: self.clone(),
                agent_id,
                id,
            })
    }

    pub(crate) fn end_deletion(&self, agent_id: &str, id: &str) {
        self.deletions
            .lock()
            .expect("history deletions lock poisoned")
            .remove(&(agent_id.to_string(), id.to_string()));
    }

    pub(crate) fn deletion_pending(&self, agent_id: &str, id: &str) -> bool {
        self.deletions
            .lock()
            .expect("history deletions lock poisoned")
            .contains(&(agent_id.to_string(), id.to_string()))
    }
}

pub(crate) struct HistoryDeletionGuard {
    coordinator: std::sync::Arc<HistoryCoordinator>,
    agent_id: String,
    id: String,
}

impl Drop for HistoryDeletionGuard {
    fn drop(&mut self) {
        self.coordinator.end_deletion(&self.agent_id, &self.id);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{HistoryCoordinator, OpenCodeHistoryPool, SqlitePoolOptions};

    #[tokio::test]
    async fn opencode_pool_retries_missing_file_and_reopens_replacement() {
        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-pool-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let holder = Arc::new(OpenCodeHistoryPool::new(path.clone()));
        assert!(holder.get().await.is_none());
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE first (id INTEGER)")
            .execute(&writable)
            .await
            .unwrap();
        writable.close().await;
        let first = holder.get().await.unwrap();
        assert!(
            sqlx::query("SELECT * FROM first")
                .fetch_all(&first.pool)
                .await
                .is_ok()
        );
        std::fs::remove_file(&path).unwrap();
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE second (id INTEGER)")
            .execute(&writable)
            .await
            .unwrap();
        writable.close().await;
        let second = holder.get().await.unwrap();
        assert_ne!(first.generation, second.generation);
        assert!(
            sqlx::query("SELECT * FROM second")
                .fetch_all(&second.pool)
                .await
                .is_ok()
        );
        holder.invalidate(&first).await;
        let current = holder.get().await.unwrap();
        assert_eq!(second.generation, current.generation);
        holder.invalidate(&second).await;
        let third = holder.get().await.unwrap();
        assert_ne!(second.generation, third.generation);
        first.pool.close().await;
        second.pool.close().await;
        third.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn opencode_pool_deduplicates_concurrent_connections() {
        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-pool-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        writable.close().await;
        let holder = Arc::new(OpenCodeHistoryPool::new(path));
        let mut tasks = Vec::new();
        for _ in 0..8 {
            let holder = holder.clone();
            tasks.push(tokio::spawn(async move { holder.get().await.unwrap() }));
        }
        let mut handles = Vec::new();
        for task in tasks {
            handles.push(task.await.unwrap());
        }
        assert!(
            handles
                .iter()
                .all(|handle| handle.generation == handles[0].generation)
        );
        handles[0].pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_guard_clears_pending_deletion() {
        let coordinator = Arc::new(HistoryCoordinator::default());
        let guard = coordinator.begin("agent", "session").unwrap();
        assert!(coordinator.deletion_pending("agent", "session"));
        assert!(coordinator.begin("agent", "session").is_none());
        drop(guard);
        assert!(!coordinator.deletion_pending("agent", "session"));
    }
}
