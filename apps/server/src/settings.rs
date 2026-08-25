use std::sync::Arc;

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};

use crate::{clock::now, state::AppState};

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
    created_at: i64,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateRequest {
    theme: Option<Theme>,
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
    let Some(theme) = request.theme else {
        return error(StatusCode::BAD_REQUEST, "EMPTY_UPDATE");
    };
    match sqlx::query_as::<_, (String, i64, i64)>(
        "UPDATE app_settings SET theme = ?, updated_at = ? WHERE id = 1 RETURNING theme, created_at, updated_at",
    )
    .bind(theme.as_str())
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
    let (theme, created_at, updated_at) = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT theme, created_at, updated_at FROM app_settings WHERE id = 1",
    )
    .fetch_one(state.pool())
    .await?;
    app_settings((theme, created_at, updated_at))
}

fn app_settings(
    (theme, created_at, updated_at): (String, i64, i64),
) -> Result<AppSettings, sqlx::Error> {
    let theme = Theme::try_from(theme).map_err(|_| sqlx::Error::RowNotFound)?;
    Ok(AppSettings {
        theme,
        created_at,
        updated_at,
    })
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{Theme, UpdateRequest};

    #[test]
    fn validates_theme_values() {
        let request: UpdateRequest = serde_json::from_str(r#"{"theme":"mocha"}"#).unwrap();
        assert_eq!(request.theme, Some(Theme::Mocha));
        assert!(serde_json::from_str::<UpdateRequest>(r#"{"theme":"dark"}"#).is_err());
    }

    #[test]
    fn rejects_unknown_fields() {
        assert!(
            serde_json::from_str::<UpdateRequest>(r#"{"theme":"latte","other":true}"#).is_err()
        );
    }
}
