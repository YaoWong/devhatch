use std::{
    collections::HashSet,
    fs::File,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use sqlx::{
    SqliteConnection, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

pub(crate) struct OpenCodeHistoryPool {
    path: std::sync::RwLock<PathBuf>,
    state: tokio::sync::Mutex<Option<PoolState>>,
    connecting: tokio::sync::Mutex<()>,
    generation: AtomicU64,
    #[cfg(test)]
    deletion_test: Arc<DeletionTestControl>,
}

#[cfg(test)]
#[derive(Default)]
struct DeletionTestControl {
    before_commit_gate: Arc<tokio::sync::Mutex<()>>,
    before_commit_reached: std::sync::atomic::AtomicBool,
    before_commit_notify: tokio::sync::Notify,
    before_invalidation_gate: Arc<tokio::sync::Mutex<()>>,
    before_invalidation_reached: std::sync::atomic::AtomicBool,
    before_invalidation_notify: tokio::sync::Notify,
}

struct PoolState {
    pool: SqlitePool,
    path: PathBuf,
    identity: FileIdentity,
    file: Arc<File>,
    generation: u64,
    #[cfg(test)]
    deletion_test: Arc<DeletionTestControl>,
}

#[derive(Clone)]
pub(crate) struct HistoryPoolHandle {
    pub(crate) pool: SqlitePool,
    pub(crate) path: PathBuf,
    pub(crate) identity: FileIdentity,
    file: Arc<File>,
    generation: u64,
    #[cfg(test)]
    deletion_test: Arc<DeletionTestControl>,
}

impl HistoryPoolHandle {
    #[cfg(test)]
    pub(crate) async fn pause_before_delete_commit(&self) -> tokio::sync::OwnedMutexGuard<()> {
        self.deletion_test
            .before_commit_gate
            .clone()
            .lock_owned()
            .await
    }

    #[cfg(test)]
    pub(crate) async fn wait_before_delete_commit(&self) {
        loop {
            let notified = self.deletion_test.before_commit_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self
                .deletion_test
                .before_commit_reached
                .load(Ordering::Acquire)
            {
                return;
            }
            notified.await;
        }
    }

    #[cfg(test)]
    pub(crate) async fn pause_before_delete_invalidation(
        &self,
    ) -> tokio::sync::OwnedMutexGuard<()> {
        self.deletion_test
            .before_invalidation_gate
            .clone()
            .lock_owned()
            .await
    }

    #[cfg(test)]
    pub(crate) async fn wait_before_delete_invalidation(&self) {
        loop {
            let notified = self.deletion_test.before_invalidation_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self
                .deletion_test
                .before_invalidation_reached
                .load(Ordering::Acquire)
            {
                return;
            }
            notified.await;
        }
    }

    #[cfg(test)]
    pub(crate) async fn test_before_delete_commit(&self) {
        self.deletion_test
            .before_commit_reached
            .store(true, Ordering::Release);
        self.deletion_test.before_commit_notify.notify_waiters();
        let _gate = self.deletion_test.before_commit_gate.lock().await;
    }

    #[cfg(test)]
    pub(crate) async fn test_before_delete_invalidation(&self) {
        self.deletion_test
            .before_invalidation_reached
            .store(true, Ordering::Release);
        self.deletion_test
            .before_invalidation_notify
            .notify_waiters();
        let _gate = self.deletion_test.before_invalidation_gate.lock().await;
    }

    pub(crate) fn file_is_current(&self) -> bool {
        self.file
            .metadata()
            .ok()
            .and_then(|metadata| file_identity_from_metadata(&metadata))
            == Some(self.identity)
            && file_identity(&self.path) == Some(self.identity)
    }

    pub(crate) async fn connection_is_current(&self, connection: &mut SqliteConnection) -> bool {
        self.file_is_current() && sqlite_connection_file_is_current(connection).await
    }

    #[cfg(unix)]
    pub(crate) fn is_private_current_user_file(&self) -> bool {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        self.file.metadata().is_ok_and(|metadata| {
            self.matches_metadata(&metadata)
                && metadata.uid() == unsafe { libc::geteuid() }
                && metadata.permissions().mode() & 0o077 == 0
                && metadata.nlink() == 1
        })
    }

    #[cfg(unix)]
    pub(crate) fn matches_metadata(&self, metadata: &std::fs::Metadata) -> bool {
        use std::os::unix::fs::MetadataExt;

        metadata.is_file()
            && metadata.dev() == self.identity.device
            && metadata.ino() == self.identity.inode
    }

    #[cfg(not(unix))]
    pub(crate) fn matches_metadata(&self, metadata: &std::fs::Metadata) -> bool {
        metadata.is_file() && file_identity(&self.path) == Some(self.identity)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct FileIdentity {
    device: u64,
    inode: u64,
}

impl OpenCodeHistoryPool {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path: std::sync::RwLock::new(path),
            state: tokio::sync::Mutex::new(None),
            connecting: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
            #[cfg(test)]
            deletion_test: Arc::new(DeletionTestControl::default()),
        }
    }

    pub(crate) fn path(&self) -> PathBuf {
        self.path
            .read()
            .expect("OpenCode history path lock poisoned")
            .clone()
    }

    pub(crate) async fn get(&self) -> Option<HistoryPoolHandle> {
        let path = self.path();
        let identity = file_identity(&path)?;
        {
            let state = self.state.lock().await;
            if let Some(current) = state.as_ref()
                && current.path == path
                && current.identity == identity
                && !current.pool.is_closed()
            {
                return Some(HistoryPoolHandle {
                    pool: current.pool.clone(),
                    path: path.clone(),
                    identity,
                    file: current.file.clone(),
                    generation: current.generation,
                    #[cfg(test)]
                    deletion_test: current.deletion_test.clone(),
                });
            }
        }
        let _connecting = self.connecting.lock().await;
        let path = self.path();
        let file = Arc::new(open_history_anchor(&path)?);
        let identity = file_identity_from_metadata(&file.metadata().ok()?)?;
        if file_identity(&path) != Some(identity) {
            return None;
        }
        {
            let state = self.state.lock().await;
            if let Some(current) = state.as_ref()
                && current.path == path
                && current.identity == identity
                && !current.pool.is_closed()
            {
                return Some(HistoryPoolHandle {
                    pool: current.pool.clone(),
                    path: path.clone(),
                    identity,
                    file: current.file.clone(),
                    generation: current.generation,
                    #[cfg(test)]
                    deletion_test: current.deletion_test.clone(),
                });
            }
        }
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .read_only(true)
            .busy_timeout(Duration::from_secs(2));
        let after_connect_path = path.clone();
        let before_acquire_path = path.clone();
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .after_connect(move |connection, _| {
                let path = after_connect_path.clone();
                Box::pin(async move {
                    sqlx::query("PRAGMA query_only = ON")
                        .execute(&mut *connection)
                        .await?;
                    if file_identity(&path) != Some(identity)
                        || !sqlite_connection_file_is_current(connection).await
                    {
                        return Err(sqlx::Error::Protocol(
                            "OpenCode database changed while opening it".into(),
                        ));
                    }
                    Ok(())
                })
            })
            .before_acquire(move |connection, _| {
                let path = before_acquire_path.clone();
                Box::pin(async move {
                    Ok(file_identity(&path) == Some(identity)
                        && sqlite_connection_file_is_current(connection).await)
                })
            })
            .after_release(|_, _| Box::pin(async { Ok(false) }))
            .connect_with(options)
            .await
            .ok()?;
        if file_identity(&path) != Some(identity) {
            pool.close().await;
            return None;
        }
        let generation = self
            .generation
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        let previous = {
            let mut state = self.state.lock().await;
            state.replace(PoolState {
                pool: pool.clone(),
                path: path.clone(),
                identity,
                file: file.clone(),
                generation,
                #[cfg(test)]
                deletion_test: self.deletion_test.clone(),
            })
        };
        if let Some(previous) = previous {
            previous.pool.close().await;
        }
        Some(HistoryPoolHandle {
            pool,
            path,
            identity,
            file,
            generation,
            #[cfg(test)]
            deletion_test: self.deletion_test.clone(),
        })
    }

    pub(crate) async fn rebind(&self, path: PathBuf) {
        let _connecting = self.connecting.lock().await;
        if self.path() == path {
            return;
        }
        self.generation.fetch_add(1, Ordering::AcqRel);
        *self
            .path
            .write()
            .expect("OpenCode history path lock poisoned") = path;
        let previous = self.state.lock().await.take();
        if let Some(current) = previous {
            current.pool.close().await;
        }
    }

    pub(crate) fn handle_is_current(&self, handle: &HistoryPoolHandle) -> bool {
        self.generation.load(Ordering::Acquire) == handle.generation
            && self.path() == handle.path
            && handle.file_is_current()
    }

    pub(crate) async fn invalidate(&self, handle: &HistoryPoolHandle) {
        let _connecting = self.connecting.lock().await;
        let previous = {
            let mut state = self.state.lock().await;
            if state
                .as_ref()
                .is_some_and(|current| current.generation == handle.generation)
            {
                self.generation.fetch_add(1, Ordering::AcqRel);
                state.take()
            } else {
                None
            }
        };
        if let Some(previous) = previous {
            previous.pool.close().await;
        }
    }
}

#[cfg(unix)]
pub(crate) async fn sqlite_connection_file_is_current(connection: &mut SqliteConnection) -> bool {
    use std::ffi::c_void;

    let Ok(mut handle) = connection.lock_handle().await else {
        return false;
    };
    let mut moved = 1_i32;
    // SAFETY: lock_handle excludes SQLx's worker from the sqlite3 handle for this call. SQLite
    // reads and writes the live `moved` integer before returning, and `main` names the primary
    // database.
    let result = unsafe {
        libsqlite3_sys::sqlite3_file_control(
            handle.as_raw_handle().as_ptr(),
            c"main".as_ptr(),
            libsqlite3_sys::SQLITE_FCNTL_HAS_MOVED,
            (&mut moved as *mut i32).cast::<c_void>(),
        )
    };
    result == libsqlite3_sys::SQLITE_OK && moved == 0
}

#[cfg(not(unix))]
pub(crate) async fn sqlite_connection_file_is_current(_: &mut SqliteConnection) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn open_history_anchor(path: &Path) -> Option<File> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_PATH | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .ok()
}

#[cfg(not(target_os = "linux"))]
fn open_history_anchor(path: &Path) -> Option<File> {
    File::open(path).ok()
}

#[cfg(unix)]
fn file_identity_from_metadata(metadata: &std::fs::Metadata) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt;

    metadata.is_file().then_some(FileIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

#[cfg(unix)]
fn file_identity(path: &Path) -> Option<FileIdentity> {
    file_identity_from_metadata(&std::fs::metadata(path).ok()?)
}

#[cfg(not(unix))]
fn file_identity_from_metadata(metadata: &std::fs::Metadata) -> Option<FileIdentity> {
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

#[cfg(not(unix))]
fn file_identity(path: &Path) -> Option<FileIdentity> {
    file_identity_from_metadata(&std::fs::metadata(path).ok()?)
}

pub(crate) struct HistoryCoordinator {
    reconciliation: Arc<tokio::sync::Mutex<()>>,
    deletions: Mutex<HashSet<(String, String)>>,
}

impl Default for HistoryCoordinator {
    fn default() -> Self {
        Self {
            reconciliation: Arc::new(tokio::sync::Mutex::new(())),
            deletions: Mutex::new(HashSet::new()),
        }
    }
}

impl HistoryCoordinator {
    pub(crate) fn lock(&self) -> &tokio::sync::Mutex<()> {
        self.reconciliation.as_ref()
    }

    pub(crate) fn owned_lock(&self) -> Arc<tokio::sync::Mutex<()>> {
        self.reconciliation.clone()
    }

    pub(crate) fn begin(
        self: &std::sync::Arc<Self>,
        agent_id: &str,
        id: &str,
    ) -> Option<HistoryDeletionGuard> {
        let key = (agent_id.to_string(), id.to_string());
        self.deletions
            .lock()
            .expect("history deletions lock poisoned")
            .insert(key.clone())
            .then(|| HistoryDeletionGuard {
                coordinator: self.clone(),
                keys: HashSet::from([key]),
                #[cfg(test)]
                before_remove: None,
            })
    }

    pub(crate) fn extend_deletion<I>(
        &self,
        guard: &mut HistoryDeletionGuard,
        agent_id: &str,
        ids: I,
    ) -> bool
    where
        I: IntoIterator<Item = String>,
    {
        if !std::ptr::eq(guard.coordinator.as_ref(), self) {
            return false;
        }
        let requested = ids
            .into_iter()
            .map(|id| (agent_id.to_string(), id))
            .collect::<HashSet<_>>();
        let mut deletions = self
            .deletions
            .lock()
            .expect("history deletions lock poisoned");
        if requested
            .iter()
            .any(|key| deletions.contains(key) && !guard.keys.contains(key))
        {
            return false;
        }
        deletions.extend(requested.iter().cloned());
        guard.keys.extend(requested);
        true
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
    keys: HashSet<(String, String)>,
    #[cfg(test)]
    before_remove: Option<Box<dyn FnOnce() + Send>>,
}

impl HistoryDeletionGuard {
    #[cfg(test)]
    pub(crate) fn set_before_remove(&mut self, observer: impl FnOnce() + Send + 'static) {
        self.before_remove = Some(Box::new(observer));
    }
}

impl Drop for HistoryDeletionGuard {
    fn drop(&mut self) {
        #[cfg(test)]
        if let Some(observer) = self.before_remove.take() {
            observer();
        }
        let mut deletions = self
            .coordinator
            .deletions
            .lock()
            .expect("history deletions lock poisoned");
        for key in &self.keys {
            deletions.remove(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use sqlx::Connection;

    use super::{
        HistoryCoordinator, OpenCodeHistoryPool, SqliteConnectOptions, SqliteConnection,
        SqlitePoolOptions,
    };

    #[tokio::test]
    async fn opencode_pool_does_not_retain_idle_sqlite_locks() {
        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-idle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        sqlx::query("PRAGMA journal_mode = WAL")
            .execute(&writable)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE item (id INTEGER)")
            .execute(&writable)
            .await
            .unwrap();
        writable.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        sqlx::query("SELECT * FROM item")
            .fetch_all(&handle.pool)
            .await
            .unwrap();

        let options = SqliteConnectOptions::new()
            .filename(&path)
            .busy_timeout(Duration::from_millis(100));
        let mut writer = SqliteConnection::connect_with(&options).await.unwrap();
        sqlx::query("PRAGMA locking_mode = EXCLUSIVE")
            .execute(&mut writer)
            .await
            .unwrap();
        sqlx::query("BEGIN EXCLUSIVE")
            .execute(&mut writer)
            .await
            .unwrap();
        sqlx::query("ROLLBACK").execute(&mut writer).await.unwrap();
        handle.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn stale_invalidation_cannot_race_a_replacement_install() {
        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-race-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let old_path = root.join("opencode-old.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE first (id INTEGER)")
            .execute(&writable)
            .await
            .unwrap();
        writable.close().await;

        let holder = Arc::new(OpenCodeHistoryPool::new(path.clone()));
        let stale = holder.get().await.unwrap();
        std::fs::rename(&path, &old_path).unwrap();
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE second (id INTEGER)")
            .execute(&writable)
            .await
            .unwrap();
        writable.close().await;

        let barrier = Arc::new(tokio::sync::Barrier::new(3));
        let getter = {
            let holder = holder.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                holder.get().await.unwrap()
            })
        };
        let invalidator = {
            let holder = holder.clone();
            let barrier = barrier.clone();
            let stale = stale.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                holder.invalidate(&stale).await;
            })
        };
        barrier.wait().await;
        let replacement = getter.await.unwrap();
        invalidator.await.unwrap();

        let current = holder.get().await.unwrap();
        assert!(holder.handle_is_current(&current));
        assert_eq!(replacement.generation, current.generation);
        assert!(!current.pool.is_closed());
        assert!(
            sqlx::query("SELECT * FROM second")
                .fetch_all(&current.pool)
                .await
                .is_ok()
        );
        stale.pool.close().await;
        current.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

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

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_pool_pins_the_original_inode_after_pool_close() {
        use std::os::unix::fs::MetadataExt;

        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-pin-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        writable.close().await;

        let holder = OpenCodeHistoryPool::new(path.clone());
        let handle = holder.get().await.unwrap();
        let original = handle.file.metadata().unwrap();
        holder.invalidate(&handle).await;
        handle.pool.close().await;
        std::fs::remove_file(&path).unwrap();

        assert_eq!(handle.file.metadata().unwrap().nlink(), 0);
        let replacement = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        replacement.close().await;
        let replacement = std::fs::metadata(&path).unwrap();
        assert_ne!(
            (original.dev(), original.ino()),
            (replacement.dev(), replacement.ino())
        );
        assert!(!handle.file_is_current());
        assert!(!holder.handle_is_current(&handle));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_pool_marks_non_private_database_unsafe_for_deletion() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-mode-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        writable.close().await;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();

        let holder = OpenCodeHistoryPool::new(path);
        let handle = holder.get().await.unwrap();
        assert!(!handle.is_private_current_user_file());
        handle.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn opencode_pool_uses_path_only_inode_anchor() {
        use std::os::fd::AsRawFd;

        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-anchor-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        writable.close().await;

        let holder = OpenCodeHistoryPool::new(path);
        let handle = holder.get().await.unwrap();
        let flags = unsafe { libc::fcntl(handle.file.as_raw_fd(), libc::F_GETFL) };
        assert_ne!(flags, -1);
        assert_eq!(flags & libc::O_PATH, libc::O_PATH);
        handle.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_pool_rejects_hard_linked_database_for_deletion() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-links-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("opencode.db");
        let alias = root.join("alias.db");
        let writable = SqlitePoolOptions::new()
            .connect(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        writable.close().await;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::hard_link(&path, &alias).unwrap();

        let holder = OpenCodeHistoryPool::new(path);
        let handle = holder.get().await.unwrap();
        assert!(!handle.is_private_current_user_file());
        handle.pool.close().await;
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn opencode_pool_rebinds_without_reusing_the_old_handle() {
        let root =
            std::env::temp_dir().join(format!("devhatch-opencode-rebind-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let first_path = root.join("opencode.db");
        let second_path = root.join("opencode-local.db");
        for (path, table) in [(&first_path, "first"), (&second_path, "second")] {
            let writable = SqlitePoolOptions::new()
                .connect(&format!("sqlite://{}?mode=rwc", path.display()))
                .await
                .unwrap();
            sqlx::query(&format!("CREATE TABLE {table} (id INTEGER)"))
                .execute(&writable)
                .await
                .unwrap();
            writable.close().await;
        }
        let holder = OpenCodeHistoryPool::new(first_path.clone());
        let first = holder.get().await.unwrap();
        assert!(holder.handle_is_current(&first));

        holder.rebind(second_path.clone()).await;
        assert!(!holder.handle_is_current(&first));
        assert_eq!(holder.path(), second_path);
        let second = holder.get().await.unwrap();
        assert!(holder.handle_is_current(&second));
        assert!(
            sqlx::query("SELECT * FROM second")
                .fetch_all(&second.pool)
                .await
                .is_ok()
        );
        second.pool.close().await;
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
    fn extending_deletion_is_atomic_when_a_descendant_is_already_fenced() {
        let coordinator = Arc::new(HistoryCoordinator::default());
        let mut root = coordinator.begin("agent", "root").unwrap();
        let child = coordinator.begin("agent", "child").unwrap();
        assert!(!coordinator.extend_deletion(
            &mut root,
            "agent",
            ["free".to_string(), "child".to_string()],
        ));
        assert!(!coordinator.deletion_pending("agent", "free"));
        assert!(coordinator.deletion_pending("agent", "root"));
        assert!(coordinator.deletion_pending("agent", "child"));
        drop(child);
        drop(root);
    }

    #[test]
    fn deletion_guard_clears_every_pending_deletion() {
        let coordinator = Arc::new(HistoryCoordinator::default());
        let mut guard = coordinator.begin("agent", "session").unwrap();
        assert!(coordinator.extend_deletion(
            &mut guard,
            "agent",
            ["child".to_string(), "grandchild".to_string()],
        ));
        for id in ["session", "child", "grandchild"] {
            assert!(coordinator.deletion_pending("agent", id));
            assert!(coordinator.begin("agent", id).is_none());
        }
        drop(guard);
        for id in ["session", "child", "grandchild"] {
            assert!(!coordinator.deletion_pending("agent", id));
        }
    }
}
