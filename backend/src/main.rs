mod agent;
mod clock;
mod filesystem;
mod history;
mod launch_path;
mod session;
mod session_socket;
mod state;
mod terminal;

use std::{env, net::SocketAddr, path::PathBuf, str::FromStr, sync::Arc, time::Duration};

use axum::{
    Router,
    extract::Request,
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch},
};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use state::AppState;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 4173;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("backend crate must be inside the project root")
        .to_path_buf();
    let data_dir = env::var_os("DEVHATCH_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| project_root.join("data"));
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

    let history_pool = open_history_pool().await;
    let state = Arc::new(AppState::new(data_dir, pool, history_pool));
    let api = Router::new()
        .route("/api/health", get(terminal::health))
        .route("/api/filesystem/directories", get(filesystem::directories))
        .route("/api/agents", get(agent::agents))
        .route("/api/agents/opencode/history", get(history::list))
        .route(
            "/api/agents/opencode/history/{id}",
            axum::routing::delete(history::remove),
        )
        .route(
            "/api/agent-launch-paths",
            get(launch_path::list).post(launch_path::create),
        )
        .route(
            "/api/agent-launch-paths/{id}",
            patch(launch_path::update).delete(launch_path::remove),
        )
        .route(
            "/api/agent-launch-paths/{id}/touch",
            axum::routing::post(launch_path::touch),
        )
        .route("/api/terminals", get(terminal::list).post(terminal::create))
        .route(
            "/api/terminals/{id}",
            patch(terminal::rename).delete(terminal::remove),
        )
        .route("/api/terminals/{id}/socket", get(terminal::socket))
        .route("/api/agent-sessions", get(agent::list).post(agent::create))
        .route(
            "/api/agent-sessions/{id}",
            patch(agent::rename).delete(agent::remove),
        )
        .route("/api/agent-sessions/{id}/socket", get(agent::socket))
        .layer(middleware::from_fn(require_loopback_host))
        .with_state(state.clone());
    let dist = project_root.join("dist");
    let app = if dist.exists() {
        api.fallback_service(
            ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html"))),
        )
    } else {
        api
    };
    let address = SocketAddr::from(([127, 0, 0, 1], PORT));
    let listener = TcpListener::bind(address).await?;
    println!("DevHatch listening on http://{HOST}:{PORT}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown(state))
        .await?;
    Ok(())
}

async fn require_loopback_host(request: Request, next: Next) -> Response {
    let trusted = request
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|host| matches!(host, "127.0.0.1:4173" | "localhost:4173"));
    if !trusted {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

async fn open_history_pool() -> Option<sqlx::SqlitePool> {
    let path = filesystem::home_dir().join(".local/share/opencode/opencode.db");
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
}
