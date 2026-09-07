use std::sync::Arc;

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::{api::ApiError, clock::now, state::AppState};

const MIN_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX: i64 = 160;
const MAX_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX: i64 = 480;
const MIN_NAVIGATION_RAIL_WIDTH_PX: i64 = 240;
const MAX_NAVIGATION_RAIL_WIDTH_PX: i64 = 480;
const MIN_FONT_SIZE_PX: i64 = 12;
const MAX_FONT_SIZE_PX: i64 = 20;
const MIN_UI_SCALE_PERCENT: i64 = 80;
const MAX_UI_SCALE_PERCENT: i64 = 125;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Theme {
    Default,
    Latte,
    Frappe,
    Macchiato,
    Mocha,
}

impl Theme {
    fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Latte => "latte",
            Self::Frappe => "frappe",
            Self::Macchiato => "macchiato",
            Self::Mocha => "mocha",
        }
    }
}

impl TryFrom<String> for Theme {
    type Error = ();

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "default" => Ok(Self::Default),
            "latte" => Ok(Self::Latte),
            "frappe" => Ok(Self::Frappe),
            "macchiato" => Ok(Self::Macchiato),
            "mocha" => Ok(Self::Mocha),
            _ => Err(()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    theme: Theme,
    agent_launch_paths_max_height_px: i64,
    navigation_rail_width_px: i64,
    font_size_px: i64,
    ui_scale_percent: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRequest {
    theme: Option<Theme>,
    agent_launch_paths_max_height_px: Option<i64>,
    navigation_rail_width_px: Option<i64>,
    font_size_px: Option<i64>,
    ui_scale_percent: Option<i64>,
}

pub(crate) async fn get(State(state): State<Arc<AppState>>) -> Response {
    settings_response(&state).await
}

pub(crate) async fn update(
    State(state): State<Arc<AppState>>,
    request: Result<Json<UpdateRequest>, JsonRejection>,
) -> Response {
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => return error(StatusCode::BAD_REQUEST, "INVALID_REQUEST"),
    };
    if let Err(code) = validate_update(&request) {
        return error(StatusCode::BAD_REQUEST, code);
    }
    match sqlx::query_as::<_, (String, i64, i64, i64, i64, i64, i64)>(
        "UPDATE app_settings SET theme = COALESCE(?, theme), agent_launch_paths_max_height_px = COALESCE(?, agent_launch_paths_max_height_px), navigation_rail_width_px = COALESCE(?, navigation_rail_width_px), font_size_px = COALESCE(?, font_size_px), ui_scale_percent = COALESCE(?, ui_scale_percent), updated_at = ? WHERE id = 1 RETURNING theme, agent_launch_paths_max_height_px, navigation_rail_width_px, font_size_px, ui_scale_percent, created_at, updated_at",
    )
    .bind(request.theme.map(Theme::as_str))
    .bind(request.agent_launch_paths_max_height_px)
    .bind(request.navigation_rail_width_px)
    .bind(request.font_size_px)
    .bind(request.ui_scale_percent)
    .bind(now() as i64)
    .fetch_one(state.pool())
    .await
    .and_then(app_settings)
    {
        Ok(settings) => Json(serde_json::json!({ "settings": settings })).into_response(),
        Err(_) => database_error(),
    }
}

async fn settings_response(state: &AppState) -> Response {
    match find(state).await {
        Ok(settings) => Json(serde_json::json!({ "settings": settings })).into_response(),
        Err(_) => database_error(),
    }
}

async fn find(state: &AppState) -> Result<AppSettings, sqlx::Error> {
    let row = sqlx::query_as::<_, (String, i64, i64, i64, i64, i64, i64)>(
        "SELECT theme, agent_launch_paths_max_height_px, navigation_rail_width_px, font_size_px, ui_scale_percent, created_at, updated_at FROM app_settings WHERE id = 1",
    )
    .fetch_one(state.pool())
    .await?;
    app_settings(row)
}

fn app_settings(
    (
        theme,
        agent_launch_paths_max_height_px,
        navigation_rail_width_px,
        font_size_px,
        ui_scale_percent,
        created_at,
        updated_at,
    ): (String, i64, i64, i64, i64, i64, i64),
) -> Result<AppSettings, sqlx::Error> {
    let theme = Theme::try_from(theme).map_err(|_| sqlx::Error::RowNotFound)?;
    Ok(AppSettings {
        theme,
        agent_launch_paths_max_height_px,
        navigation_rail_width_px,
        font_size_px,
        ui_scale_percent,
        created_at,
        updated_at,
    })
}

fn validate_update(request: &UpdateRequest) -> Result<(), &'static str> {
    if request.theme.is_none()
        && request.agent_launch_paths_max_height_px.is_none()
        && request.navigation_rail_width_px.is_none()
        && request.font_size_px.is_none()
        && request.ui_scale_percent.is_none()
    {
        return Err("EMPTY_UPDATE");
    }
    if request
        .agent_launch_paths_max_height_px
        .is_some_and(|height| {
            !(MIN_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX..=MAX_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX)
                .contains(&height)
        })
        || request.navigation_rail_width_px.is_some_and(|width| {
            !(MIN_NAVIGATION_RAIL_WIDTH_PX..=MAX_NAVIGATION_RAIL_WIDTH_PX).contains(&width)
        })
        || request
            .font_size_px
            .is_some_and(|size| !(MIN_FONT_SIZE_PX..=MAX_FONT_SIZE_PX).contains(&size))
        || request.ui_scale_percent.is_some_and(|scale| {
            !(MIN_UI_SCALE_PERCENT..=MAX_UI_SCALE_PERCENT).contains(&scale) || scale % 5 != 0
        })
    {
        return Err("INVALID_REQUEST");
    }
    Ok(())
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &'static str) -> Response {
    ApiError::new(status, code).into_response()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::{Json, body::to_bytes, extract::State, http::StatusCode};
    use serde_json::Value;
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        MAX_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX, MAX_FONT_SIZE_PX, MAX_NAVIGATION_RAIL_WIDTH_PX,
        MAX_UI_SCALE_PERCENT, MIN_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX, MIN_FONT_SIZE_PX,
        MIN_NAVIGATION_RAIL_WIDTH_PX, MIN_UI_SCALE_PERCENT, Theme, UpdateRequest, get, update,
        validate_update,
    };
    use crate::state::{AppState, OpenCodeHistoryPool};

    async fn test_state() -> (tempfile::TempDir, Arc<AppState>) {
        let root = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(root.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            root.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(root.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        (root, state)
    }

    async fn response_json(response: axum::response::Response) -> Value {
        assert_eq!(response.status(), StatusCode::OK);
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
    }

    #[test]
    fn validates_theme_values() {
        let request: UpdateRequest = serde_json::from_str(r#"{"theme":"mocha"}"#).unwrap();
        assert_eq!(request.theme, Some(Theme::Mocha));
        assert!(serde_json::from_str::<UpdateRequest>(r#"{"theme":"dark"}"#).is_err());
    }

    #[test]
    fn rejects_layout_mode() {
        assert!(serde_json::from_str::<UpdateRequest>(r#"{"layoutMode":"canvas"}"#).is_err());
    }

    #[test]
    fn accepts_height_boundaries_and_combinations() {
        for height in [
            MIN_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX,
            MAX_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX,
        ] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "agentLaunchPathsMaxHeightPx": height
            }))
            .unwrap();
            assert_eq!(request.agent_launch_paths_max_height_px, Some(height));
            assert_eq!(validate_update(&request), Ok(()));
        }
        let request: UpdateRequest =
            serde_json::from_str(r#"{"theme":"frappe","agentLaunchPathsMaxHeightPx":320}"#)
                .unwrap();
        assert_eq!(request.theme, Some(Theme::Frappe));
        assert_eq!(request.agent_launch_paths_max_height_px, Some(320));
    }

    #[test]
    fn parses_out_of_range_heights_for_handler_validation() {
        for height in [
            MIN_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX - 1,
            MAX_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX + 1,
        ] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "agentLaunchPathsMaxHeightPx": height
            }))
            .unwrap();
            assert_eq!(request.agent_launch_paths_max_height_px, Some(height));
            assert_eq!(validate_update(&request), Err("INVALID_REQUEST"));
        }
    }

    #[test]
    fn accepts_width_boundaries() {
        for width in [MIN_NAVIGATION_RAIL_WIDTH_PX, MAX_NAVIGATION_RAIL_WIDTH_PX] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "navigationRailWidthPx": width
            }))
            .unwrap();
            assert_eq!(request.navigation_rail_width_px, Some(width));
            assert_eq!(validate_update(&request), Ok(()));
        }
    }

    #[test]
    fn rejects_out_of_range_widths() {
        for width in [
            MIN_NAVIGATION_RAIL_WIDTH_PX - 1,
            MAX_NAVIGATION_RAIL_WIDTH_PX + 1,
        ] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "navigationRailWidthPx": width
            }))
            .unwrap();
            assert_eq!(validate_update(&request), Err("INVALID_REQUEST"));
        }
    }

    #[test]
    fn accepts_display_setting_boundaries() {
        for font_size_px in [MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "fontSizePx": font_size_px
            }))
            .unwrap();
            assert_eq!(request.font_size_px, Some(font_size_px));
            assert_eq!(validate_update(&request), Ok(()));
        }
        for ui_scale_percent in [MIN_UI_SCALE_PERCENT, MAX_UI_SCALE_PERCENT] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "uiScalePercent": ui_scale_percent
            }))
            .unwrap();
            assert_eq!(request.ui_scale_percent, Some(ui_scale_percent));
            assert_eq!(validate_update(&request), Ok(()));
        }
    }

    #[test]
    fn rejects_out_of_range_display_settings() {
        for font_size_px in [MIN_FONT_SIZE_PX - 1, MAX_FONT_SIZE_PX + 1] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "fontSizePx": font_size_px
            }))
            .unwrap();
            assert_eq!(validate_update(&request), Err("INVALID_REQUEST"));
        }
        for ui_scale_percent in [
            MIN_UI_SCALE_PERCENT - 1,
            MIN_UI_SCALE_PERCENT + 1,
            MAX_UI_SCALE_PERCENT + 1,
        ] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "uiScalePercent": ui_scale_percent
            }))
            .unwrap();
            assert_eq!(validate_update(&request), Err("INVALID_REQUEST"));
        }
    }

    #[tokio::test]
    async fn patches_and_gets_all_settings_fields() {
        let (_root, state) = test_state().await;
        let request: UpdateRequest = serde_json::from_str(
            r#"{"theme":"frappe","agentLaunchPathsMaxHeightPx":320,"navigationRailWidthPx":336,"fontSizePx":18,"uiScalePercent":120}"#,
        )
        .unwrap();
        let patched = response_json(update(State(state.clone()), Ok(Json(request))).await).await;
        let settings = &patched["settings"];
        assert_eq!(settings["theme"], "frappe");
        assert_eq!(settings["agentLaunchPathsMaxHeightPx"], 320);
        assert_eq!(settings["navigationRailWidthPx"], 336);
        assert_eq!(settings["fontSizePx"], 18);
        assert_eq!(settings["uiScalePercent"], 120);

        let fetched = response_json(get(State(state)).await).await;
        assert_eq!(fetched["settings"], *settings);
    }

    #[test]
    fn rejects_empty_or_null_update() {
        let request: UpdateRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(validate_update(&request), Err("EMPTY_UPDATE"));
        let request: UpdateRequest = serde_json::from_str(r#"{"fontSizePx":null}"#).unwrap();
        assert_eq!(validate_update(&request), Err("EMPTY_UPDATE"));
    }

    #[tokio::test]
    async fn baseline_has_final_settings_schema_and_seed() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();

        let column_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('app_settings') WHERE name = 'layout_mode'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(column_count, 0);
        let settings: (String, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT theme, agent_launch_paths_max_height_px, navigation_rail_width_px, font_size_px, ui_scale_percent FROM app_settings WHERE id = 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(settings, ("default".to_owned(), 286, 288, 13, 100));
        let migrations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(migrations, 4);
        let launch_configs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_launch_configs")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(launch_configs, 4);
        for statement in [
            "UPDATE app_settings SET theme = 'dark' WHERE id = 1",
            "UPDATE app_settings SET agent_launch_paths_max_height_px = 159 WHERE id = 1",
            "UPDATE app_settings SET agent_launch_paths_max_height_px = 481 WHERE id = 1",
            "UPDATE app_settings SET navigation_rail_width_px = 239 WHERE id = 1",
            "UPDATE app_settings SET navigation_rail_width_px = 481 WHERE id = 1",
            "UPDATE app_settings SET font_size_px = 11 WHERE id = 1",
            "UPDATE app_settings SET font_size_px = 21 WHERE id = 1",
            "UPDATE app_settings SET ui_scale_percent = 79 WHERE id = 1",
            "UPDATE app_settings SET ui_scale_percent = 81 WHERE id = 1",
            "UPDATE app_settings SET ui_scale_percent = 126 WHERE id = 1",
        ] {
            assert!(sqlx::query(statement).execute(&pool).await.is_err());
        }
    }

    #[tokio::test]
    async fn upgrades_existing_settings_with_display_defaults() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0001_global.sql"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE app_settings SET theme = 'mocha', agent_launch_paths_max_height_px = 320, navigation_rail_width_px = 352, created_at = 10, updated_at = 20 WHERE id = 1",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::raw_sql(include_str!("../migrations/0004_display_settings.sql"))
            .execute(&pool)
            .await
            .unwrap();
        let settings: (String, i64, i64, i64, i64, i64, i64) = sqlx::query_as(
            "SELECT theme, agent_launch_paths_max_height_px, navigation_rail_width_px, font_size_px, ui_scale_percent, created_at, updated_at FROM app_settings WHERE id = 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(settings, ("mocha".to_owned(), 320, 352, 13, 100, 10, 20));
    }

    #[test]
    fn rejects_unknown_fields() {
        assert!(
            serde_json::from_str::<UpdateRequest>(r#"{"theme":"latte","other":true}"#).is_err()
        );
        assert!(
            serde_json::from_str::<UpdateRequest>(r#"{"agent_launch_paths_max_height_px":286}"#)
                .is_err()
        );
    }
}
