use std::borrow::Cow;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

#[derive(Debug)]
pub(crate) struct ApiError {
    status: StatusCode,
    code: Cow<'static, str>,
    message: Option<Cow<'static, str>>,
}

#[derive(Serialize)]
struct ErrorBody {
    error: Cow<'static, str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<Cow<'static, str>>,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, code: impl Into<Cow<'static, str>>) -> Self {
        Self {
            status,
            code: code.into(),
            message: None,
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn with_message(
        status: StatusCode,
        code: impl Into<Cow<'static, str>>,
        message: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self {
            status,
            code: code.into(),
            message: Some(message.into()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ErrorBody {
                error: self.code,
                message: self.message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::to_bytes,
        http::{StatusCode, header},
        response::IntoResponse,
    };

    use super::ApiError;

    async fn body(response: axum::response::Response) -> String {
        String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn responds_without_message() {
        let response = ApiError::new(StatusCode::BAD_REQUEST, "INVALID_REQUEST").into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        assert_eq!(body(response).await, r#"{"error":"INVALID_REQUEST"}"#);
    }

    #[tokio::test]
    async fn responds_with_message() {
        let response = ApiError::with_message(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_REQUEST",
            "invalid value",
        )
        .into_response();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        assert_eq!(
            body(response).await,
            r#"{"error":"INVALID_REQUEST","message":"invalid value"}"#
        );
    }

    #[tokio::test]
    async fn responds_with_owned_code() {
        let response =
            ApiError::new(StatusCode::CONFLICT, String::from("DYNAMIC_ERROR")).into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json"
        );
        assert_eq!(body(response).await, r#"{"error":"DYNAMIC_ERROR"}"#);
    }
}
