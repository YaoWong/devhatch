use std::{env, net::SocketAddr, path::PathBuf, str::FromStr, sync::Arc, time::Duration};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use tokio::net::TcpListener;

use crate::state::AppState;

const HOST: &str = "127.0.0.1";
const PORT: u16 = 4173;

pub(crate) async fn run() -> Result<(), Box<dyn std::error::Error>> {
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
    std::fs::create_dir_all(&data_dir)?;
    let database_url = format!("sqlite://{}", data_dir.join("devhatch.sqlite3").display());
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
    let skillink = ::skillink::Skillink::open(Some(data_dir.join("skillink"))).await?;
    let history_pool = open_history_pool().await;
    let initialized =
        sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM admin_credentials WHERE id = 1)")
            .fetch_one(&pool)
            .await?
            != 0;
    let setup_token = (!initialized).then(|| {
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        println!("DevHatch setup token: {token}");
        token
    });
    let state = Arc::new(AppState::new(
        data_dir,
        pool,
        history_pool,
        skillink,
        setup_token.as_deref(),
    ));
    let app = crate::router::build(state.clone(), apps_dir);
    let bind_host = env::var("DEVHATCH_BIND").unwrap_or_else(|_| HOST.to_string());
    let address = format!("{bind_host}:{PORT}");
    let listener = TcpListener::bind(&address).await?;
    println!("DevHatch listening on http://{address}");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown(state))
    .await?;
    Ok(())
}

async fn open_history_pool() -> Option<sqlx::SqlitePool> {
    let path = crate::filesystem::home_dir().join(".local/share/opencode/opencode.db");
    if !path.is_file() {
        return None;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .busy_timeout(Duration::from_secs(2));
    SqlitePoolOptions::new()
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
        .ok()
}

async fn shutdown(state: Arc<AppState>) {
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
    state.terminate_all();
    state.web_apps().shutdown().await;
}
