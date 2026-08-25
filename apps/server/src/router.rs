use std::{env, path::Path, sync::Arc};

use axum::{
    Router,
    extract::Request,
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, patch},
};
use tower_http::services::{ServeDir, ServeFile};

use crate::{
    agent, auth, filesystem, history, launch_config, launch_path, settings, skillink,
    state::AppState, terminal, web_app,
};

pub(crate) fn build(state: Arc<AppState>, apps_dir: &Path) -> Router {
    let protected = Router::new()
        .route("/api/health", get(terminal::health))
        .route("/api/auth/verify", get(auth::verify))
        .route("/api/auth/logout", axum::routing::post(auth::logout))
        .route("/api/filesystem/directories", get(filesystem::directories))
        .route("/api/settings", get(settings::get).patch(settings::update))
        .route("/api/agents", get(agent::agents))
        .route(
            "/api/agent-launch-configs",
            get(launch_config::list).post(launch_config::create),
        )
        .route(
            "/api/agent-launch-configs/{id}",
            patch(launch_config::update).delete(launch_config::remove),
        )
        .route("/api/agents/{agentId}/history", get(history::list))
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
            "/api/agents/{agentId}/history/{id}",
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
        .with_state(state);
    let dist = env::var_os("DEVHATCH_WEB_DIST")
        .map(Into::into)
        .unwrap_or_else(|| apps_dir.join("web/dist"));
    if dist.exists() {
        api.fallback_service(
            ServeDir::new(&dist).not_found_service(ServeFile::new(dist.join("index.html"))),
        )
    } else {
        api
    }
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
