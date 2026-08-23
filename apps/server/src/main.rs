mod agent;
mod auth;
mod clock;
mod filesystem;
mod history;
mod launch_config;
mod launch_path;
mod session;
mod session_socket;
mod skillink;
mod state;
mod terminal;
mod web_app;

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
    let protected = Router::new()
        .route("/api/health", get(terminal::health))
        .route("/api/auth/verify", get(auth::verify))
        .route("/api/auth/logout", axum::routing::post(auth::logout))
        .route("/api/filesystem/directories", get(filesystem::directories))
        .route("/api/agents", get(agent::agents))
        .route(
            "/api/agent-launch-configs",
            get(launch_config::list).post(launch_config::create),
        )
        .route(
            "/api/agent-launch-configs/{id}",
            patch(launch_config::update).delete(launch_config::remove),
        )
        .route("/api/agents/opencode/history", get(history::list))
        .route(
            "/api/skill-repositories",
            get(skillink::list_repositories).post(skillink::create_repository),
        )
        .route(
            "/api/skill-repositories/{id}",
            patch(skillink::update_repository).delete(skillink::remove_repository),
        )
        .route(
            "/api/skill-repositories/{id}/sync-preview",
            axum::routing::post(skillink::preview_repository_sync),
        )
        .route(
            "/api/skill-repositories/{id}/sync",
            axum::routing::post(skillink::sync_repository),
        )
        .route(
            "/api/skills",
            get(skillink::list_skills).post(skillink::create_skill),
        )
        .route(
            "/api/skills/import",
            axum::routing::post(skillink::import_skill),
        )
        .route("/api/skills/{id}/manifest", get(skillink::skill_manifest))
        .route(
            "/api/skills/{id}",
            axum::routing::delete(skillink::remove_skill),
        )
        .route(
            "/api/skill-profiles",
            get(skillink::list_profiles).post(skillink::create_profile),
        )
        .route("/api/skill-profiles/{id}", get(skillink::profile_detail))
        .route(
            "/api/skill-profiles/{id}/skills",
            axum::routing::put(skillink::replace_profile_skills),
        )
        .route(
            "/api/skill-profiles/{profileId}/skills/{skillId}",
            axum::routing::post(skillink::enable_profile_skill)
                .delete(skillink::disable_profile_skill),
        )
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
        .route("/api/web-apps", get(web_app::list))
        .route(
            "/api/web-apps/open-design/install",
            axum::routing::post(web_app::install),
        )
        .route(
            "/api/web-apps/open-design/check-update",
            axum::routing::post(web_app::check_update),
        )
        .route(
            "/api/web-apps/open-design/update",
            axum::routing::post(web_app::update),
        )
        .route(
            "/api/web-apps/open-design/start",
            axum::routing::post(web_app::start),
        )
        .route(
            "/api/web-apps/open-design/stop",
            axum::routing::post(web_app::stop),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));
    let api = Router::new()
        .route("/api/auth/status", get(auth::status))
        .route("/api/auth/setup", axum::routing::post(auth::setup))
        .route("/api/auth/login", axum::routing::post(auth::login))
        .merge(protected)
        .route("/api/{*path}", axum::routing::any(api_not_found))
        .layer(middleware::from_fn(require_trusted_request))
        .with_state(state.clone());
    let dist = env::var_os("DEVHATCH_WEB_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|| apps_dir.join("web/dist"));
    let app = if dist.exists() {
        api.fallback_service(
            ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html"))),
        )
    } else {
        api
    };
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

async fn api_not_found() -> Response {
    (
        StatusCode::NOT_FOUND,
        axum::Json(serde_json::json!({ "error": "NOT_FOUND" })),
    )
        .into_response()
}

async fn require_trusted_request(request: Request, next: Next) -> Response {
    let host = request
        .headers()
        .get("host")
        .and_then(|value| value.to_str().ok());
    let public_origin = env::var("DEVHATCH_PUBLIC_ORIGIN").ok();
    let public_authority = public_origin
        .as_deref()
        .and_then(|origin| url::Url::parse(origin).ok())
        .and_then(|origin| {
            origin.host_str().map(|host| match origin.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.to_string(),
            })
        });
    let trusted_host = host.is_some_and(|host| {
        matches!(host, "127.0.0.1:4173" | "localhost:4173")
            || public_authority.as_deref() == Some(host)
    });
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());
    let cross_site = request
        .headers()
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        == Some("cross-site");
    let expected_origin = host.map(|host| {
        if public_authority.as_deref() == Some(host) {
            public_origin
                .as_deref()
                .unwrap_or_default()
                .trim_end_matches('/')
                .to_string()
        } else {
            format!("http://{host}")
        }
    });
    let trusted_origin = !cross_site
        && (origin.is_none()
            || origin
                .zip(expected_origin.as_deref())
                .is_some_and(|(origin, expected)| origin == expected));
    if !trusted_host || !trusted_origin {
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
    state.web_apps().shutdown().await;
}
