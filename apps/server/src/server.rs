use std::{
    env, io,
    net::SocketAddr,
    path::{Path, PathBuf},
    str::FromStr,
    sync::Arc,
    time::Duration,
};

use axum::{
    extract::connect_info::Connected,
    serve::{IncomingStream, Listener},
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tokio::{
    net::TcpListener,
    sync::{oneshot, watch},
};

use crate::state::AppState;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 4173;
const SESSION_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);

struct StoppableListener {
    listener: TcpListener,
    stop: watch::Receiver<bool>,
    stopped: Option<oneshot::Sender<()>>,
}

impl Listener for StoppableListener {
    type Io = <TcpListener as Listener>::Io;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        if *self.stop.borrow() {
            self.confirm_stopped();
            return std::future::pending().await;
        }
        tokio::select! {
            connection = Listener::accept(&mut self.listener) => connection,
            _ = self.stop.changed() => {
                self.confirm_stopped();
                std::future::pending().await
            },
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

impl StoppableListener {
    fn confirm_stopped(&mut self) {
        if let Some(stopped) = self.stopped.take() {
            let _ = stopped.send(());
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) struct ClientAddr(pub(crate) SocketAddr);

impl Connected<IncomingStream<'_, StoppableListener>> for ClientAddr {
    fn connect_info(target: IncomingStream<'_, StoppableListener>) -> Self {
        Self(*target.remote_addr())
    }
}

pub(crate) async fn run(admin_password: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let apps_dir = manifest_dir
        .parent()
        .expect("server crate must be inside the apps directory");
    let workspace_root = apps_dir
        .parent()
        .expect("apps directory must be inside the workspace root");
    let data_dir = env::var_os("DEVHATCH_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_root.join("data"));
    prepare_data_dir(&data_dir)?;
    let public_origin = validated_public_origin()?;
    let public_origin_value = public_origin.as_ref().map(url::Url::to_string);
    let secure_cookie = public_origin
        .as_ref()
        .is_some_and(|origin| origin.scheme() == "https");
    let database_path = data_dir.join("devhatch.sqlite3");
    secure_database_files(&database_path)?;
    let database_url = format!("sqlite://{}", database_path.display());
    let options = SqliteConnectOptions::from_str(&database_url)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    secure_database_files(&database_path)?;
    let skillink = ::skillink::Skillink::open(Some(data_dir.join("skillink"))).await?;
    let history_pool = crate::state::OpenCodeHistoryPool::new(
        crate::filesystem::home_dir().join(".local/share/opencode/opencode.db"),
    );
    let mut initialized =
        sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM admin_credentials WHERE id = 1)")
            .fetch_one(&pool)
            .await?
            != 0;
    if !initialized && let Some(password) = admin_password {
        initialized = crate::auth::initialize_password(&pool, password).await?;
        if initialized {
            println!("Administrator credentials initialized from password file");
        } else {
            initialized = true;
        }
    }
    let setup_token = (!initialized).then(|| {
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        println!("DevHatch setup token: {token}");
        token
    });
    let web_dist = resolve_web_dist(
        env::var_os("DEVHATCH_WEB_DIST").as_deref().map(Path::new),
        env::current_exe().ok().as_deref().and_then(Path::parent),
        env::current_dir().ok().as_deref(),
        &workspace_root.join("apps/web/dist"),
    )
    .and_then(|path| match std::fs::canonicalize(&path) {
        Ok(path) => Some(path),
        Err(error) => {
            eprintln!(
                "Failed to canonicalize DevHatch web distribution {}: {error}",
                path.display()
            );
            None
        }
    });
    if web_dist.is_none() {
        eprintln!(
            "No DevHatch web distribution containing index.html was found; static web fallback is disabled"
        );
    }
    let bind_host = env::var("DEVHATCH_BIND").unwrap_or_else(|_| HOST.to_string());
    let supervisor = match env::current_exe() {
        Ok(current_exe) => {
            match crate::supervisor::SupervisorContext::capture(
                current_exe,
                web_dist.clone(),
                data_dir.clone(),
                bind_host.clone(),
                public_origin_value,
            ) {
                Ok(context) => Some(crate::supervisor::Supervisor::new(context)),
                Err(error) => {
                    eprintln!("Supervisor unavailable: {error}");
                    None
                }
            }
        }
        Err(error) => {
            eprintln!("Supervisor unavailable: {error}");
            None
        }
    };
    let state = Arc::new(AppState::new(
        data_dir,
        pool,
        history_pool,
        skillink,
        setup_token.as_deref(),
        secure_cookie,
    ));
    if let Some(supervisor) = supervisor {
        let _ = state.set_supervisor(supervisor);
    }
    let app = crate::router::build(state.clone(), web_dist);
    let address = format!("{bind_host}:{PORT}");
    let listener = TcpListener::bind(&address).await?;
    println!("DevHatch listening on http://{address}");
    let (stop, stop_requested) = watch::channel(false);
    let (stopped, accept_stopped) = oneshot::channel();
    let (cleanup_complete, cleanup_completed) = oneshot::channel();
    let shutdown_state = state.clone();
    tokio::spawn(async move {
        tokio::select! {
            () = shutdown_signal() => {},
            () = shutdown_state.wait_for_internal_shutdown() => {},
        }
        let _ = stop.send(true);
        let _ = accept_stopped.await;
        if !shutdown_state
            .shutdown_sessions(SESSION_SHUTDOWN_TIMEOUT)
            .await
        {
            eprintln!("Timed out waiting for sessions to shut down");
        }
        shutdown_state.web_apps().shutdown().await;
        let _ = cleanup_complete.send(());
    });
    axum::serve(
        StoppableListener {
            listener,
            stop: stop_requested,
            stopped: Some(stopped),
        },
        app.into_make_service_with_connect_info::<ClientAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = cleanup_completed.await;
    })
    .await?;
    Ok(())
}

fn resolve_web_dist(
    configured: Option<&Path>,
    executable_dir: Option<&Path>,
    current_dir: Option<&Path>,
    development_dist: &Path,
) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = configured {
        candidates.push(configured.to_path_buf());
    }
    if let Some(executable_dir) = executable_dir {
        candidates.push(executable_dir.join("web/dist"));
        candidates.push(executable_dir.join("dist"));
    }
    if let Some(current_dir) = current_dir {
        candidates.push(current_dir.join("apps/web/dist"));
    }
    candidates.push(development_dist.to_path_buf());
    candidates
        .into_iter()
        .find(|candidate| candidate.join("index.html").is_file())
}

fn validated_public_origin() -> Result<Option<url::Url>, Box<dyn std::error::Error>> {
    let Some(value) = env::var("DEVHATCH_PUBLIC_ORIGIN").ok() else {
        return Ok(None);
    };
    let origin = url::Url::parse(&value)?;
    if !matches!(origin.scheme(), "http" | "https")
        || origin.host_str().is_none()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.path() != "/"
        || origin.query().is_some()
        || origin.fragment().is_some()
    {
        return Err("DEVHATCH_PUBLIC_ORIGIN must be an HTTP(S) origin without path, query, userinfo, or fragment".into());
    }
    Ok(Some(origin))
}

#[cfg(unix)]
fn prepare_data_dir(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    std::fs::create_dir_all(path)?;
    let metadata = std::fs::metadata(path)?;
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "data directory is not owned by the current user",
        ));
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn prepare_data_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

#[cfg(unix)]
fn secure_database_files(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    for path in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        if !path.exists() {
            continue;
        }
        let metadata = std::fs::metadata(&path)?;
        if metadata.uid() != unsafe { libc::geteuid() } {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("{} is not owned by the current user", path.display()),
            ));
        }
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn secure_database_files(_: &Path) -> std::io::Result<()> {
    Ok(())
}

async fn shutdown_signal() {
    let interrupt = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {},
        () = terminate => {},
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::{prepare_data_dir, resolve_web_dist, secure_database_files};

    #[tokio::test]
    async fn stop_acknowledgement_precedes_cleanup_signal() {
        let (stop, mut stop_requested) = tokio::sync::watch::channel(false);
        let (stopped, accept_stopped) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            stop.send(true).unwrap();
            accept_stopped.await.unwrap();
            true
        });
        stop_requested.changed().await.unwrap();
        assert!(*stop_requested.borrow());
        assert!(!task.is_finished());
        stopped.send(()).unwrap();
        assert!(task.await.unwrap());
    }

    #[test]
    fn resolves_web_dist_in_priority_order_and_requires_index() {
        let root = tempfile::tempdir().unwrap();
        let configured = root.path().join("configured");
        let executable = root.path().join("bin");
        let current = root.path().join("current");
        let development = root.path().join("development");
        let candidates = [
            configured.clone(),
            executable.join("web/dist"),
            executable.join("dist"),
            current.join("apps/web/dist"),
            development.clone(),
        ];
        for candidate in &candidates {
            std::fs::create_dir_all(candidate).unwrap();
        }
        let resolve = || {
            resolve_web_dist(
                Some(&configured),
                Some(&executable),
                Some(&current),
                &development,
            )
        };
        assert_eq!(resolve(), None);
        for expected in candidates.iter().rev() {
            std::fs::write(expected.join("index.html"), "").unwrap();
            assert_eq!(resolve().as_deref(), Some(expected.as_path()));
        }
    }

    #[test]
    fn secures_data_directory_and_database_files() {
        let root =
            std::env::temp_dir().join(format!("devhatch-permissions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o755)).unwrap();
        prepare_data_dir(&root).unwrap();
        assert_eq!(
            std::fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let database = root.join("devhatch.sqlite3");
        for path in [
            database.clone(),
            root.join("devhatch.sqlite3-wal"),
            root.join("devhatch.sqlite3-shm"),
        ] {
            std::fs::write(&path, b"").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        secure_database_files(&database).unwrap();
        for path in [
            database,
            root.join("devhatch.sqlite3-wal"),
            root.join("devhatch.sqlite3-shm"),
        ] {
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
