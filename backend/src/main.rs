mod filesystem;
mod terminal;

use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

use axum::{
    Router,
    routing::{get, patch},
};
use terminal::AppState;
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

    let state = Arc::new(AppState::new(data_dir));
    let api = Router::new()
        .route("/api/health", get(terminal::health))
        .route("/api/filesystem/directories", get(filesystem::directories))
        .route("/api/terminals", get(terminal::list).post(terminal::create))
        .route(
            "/api/terminals/{id}",
            patch(terminal::rename).delete(terminal::remove),
        )
        .route("/api/terminals/{id}/socket", get(terminal::socket))
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
