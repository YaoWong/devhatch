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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum LayoutMode {
    Classic,
    Canvas,
}

impl LayoutMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::Canvas => "canvas",
        }
    }
}

impl TryFrom<String> for LayoutMode {
    type Error = ();

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "classic" => Ok(Self::Classic),
            "canvas" => Ok(Self::Canvas),
            _ => Err(()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    theme: Theme,
    layout_mode: LayoutMode,
    agent_launch_paths_max_height_px: i64,
    navigation_rail_width_px: i64,
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRequest {
    theme: Option<Theme>,
    layout_mode: Option<LayoutMode>,
    agent_launch_paths_max_height_px: Option<i64>,
    navigation_rail_width_px: Option<i64>,
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
    match sqlx::query_as::<_, (String, String, i64, i64, i64, i64)>(
        "UPDATE app_settings SET theme = COALESCE(?, theme), layout_mode = COALESCE(?, layout_mode), agent_launch_paths_max_height_px = COALESCE(?, agent_launch_paths_max_height_px), navigation_rail_width_px = COALESCE(?, navigation_rail_width_px), updated_at = ? WHERE id = 1 RETURNING theme, layout_mode, agent_launch_paths_max_height_px, navigation_rail_width_px, created_at, updated_at",
    )
    .bind(request.theme.map(Theme::as_str))
    .bind(request.layout_mode.map(LayoutMode::as_str))
    .bind(request.agent_launch_paths_max_height_px)
    .bind(request.navigation_rail_width_px)
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
    let row = sqlx::query_as::<_, (String, String, i64, i64, i64, i64)>(
        "SELECT theme, layout_mode, agent_launch_paths_max_height_px, navigation_rail_width_px, created_at, updated_at FROM app_settings WHERE id = 1",
    )
    .fetch_one(state.pool())
    .await?;
    app_settings(row)
}

fn app_settings(
    (
        theme,
        layout_mode,
        agent_launch_paths_max_height_px,
        navigation_rail_width_px,
        created_at,
        updated_at,
    ): (String, String, i64, i64, i64, i64),
) -> Result<AppSettings, sqlx::Error> {
    let theme = Theme::try_from(theme).map_err(|_| sqlx::Error::RowNotFound)?;
    let layout_mode = LayoutMode::try_from(layout_mode).map_err(|_| sqlx::Error::RowNotFound)?;
    Ok(AppSettings {
        theme,
        layout_mode,
        agent_launch_paths_max_height_px,
        navigation_rail_width_px,
        created_at,
        updated_at,
    })
}

fn validate_update(request: &UpdateRequest) -> Result<(), &'static str> {
    if request.theme.is_none()
        && request.layout_mode.is_none()
        && request.agent_launch_paths_max_height_px.is_none()
        && request.navigation_rail_width_px.is_none()
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
    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        LayoutMode, MAX_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX, MAX_NAVIGATION_RAIL_WIDTH_PX,
        MIN_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX, MIN_NAVIGATION_RAIL_WIDTH_PX, Theme, UpdateRequest,
        validate_update,
    };

    #[test]
    fn validates_theme_values() {
        let request: UpdateRequest = serde_json::from_str(r#"{"theme":"mocha"}"#).unwrap();
        assert_eq!(request.theme, Some(Theme::Mocha));
        assert!(serde_json::from_str::<UpdateRequest>(r#"{"theme":"dark"}"#).is_err());
    }

    #[test]
    fn validates_layout_values() {
        let request: UpdateRequest = serde_json::from_str(r#"{"layoutMode":"canvas"}"#).unwrap();
        assert_eq!(request.layout_mode, Some(LayoutMode::Canvas));
        assert_eq!(validate_update(&request), Ok(()));
        assert!(serde_json::from_str::<UpdateRequest>(r#"{"layoutMode":"wide"}"#).is_err());
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
    fn accepts_width_boundaries_and_three_field_patch() {
        for width in [MIN_NAVIGATION_RAIL_WIDTH_PX, MAX_NAVIGATION_RAIL_WIDTH_PX] {
            let request: UpdateRequest = serde_json::from_value(serde_json::json!({
                "navigationRailWidthPx": width
            }))
            .unwrap();
            assert_eq!(request.navigation_rail_width_px, Some(width));
            assert_eq!(validate_update(&request), Ok(()));
        }
        let request: UpdateRequest = serde_json::from_str(
            r#"{"theme":"frappe","agentLaunchPathsMaxHeightPx":320,"navigationRailWidthPx":336}"#,
        )
        .unwrap();
        assert_eq!(request.theme, Some(Theme::Frappe));
        assert_eq!(request.agent_launch_paths_max_height_px, Some(320));
        assert_eq!(request.navigation_rail_width_px, Some(336));
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
    fn rejects_empty_update() {
        let request: UpdateRequest = serde_json::from_str("{}").unwrap();
        assert_eq!(validate_update(&request), Err("EMPTY_UPDATE"));
    }

    #[tokio::test]
    async fn migration_adds_default_and_enforces_height_bounds() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let (layout_mode, height, width): (String, i64, i64) = sqlx::query_as(
            "SELECT layout_mode, agent_launch_paths_max_height_px, navigation_rail_width_px FROM app_settings WHERE id = 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(layout_mode, "canvas");
        assert_eq!(height, 286);
        assert_eq!(width, 288);
        assert!(
            sqlx::query("UPDATE app_settings SET layout_mode = 'wide' WHERE id = 1")
                .execute(&pool)
                .await
                .is_err()
        );
        for value in [159, 481] {
            assert!(
                sqlx::query(
                    "UPDATE app_settings SET agent_launch_paths_max_height_px = ? WHERE id = 1"
                )
                .bind(value)
                .execute(&pool)
                .await
                .is_err()
            );
        }
        for value in [239, 481] {
            assert!(
                sqlx::query("UPDATE app_settings SET navigation_rail_width_px = ? WHERE id = 1")
                    .bind(value)
                    .execute(&pool)
                    .await
                    .is_err()
            );
        }
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
