use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{api::ApiError, clock, state::AppState};

const COOKIE_NAME: &str = "devhatch_session";
const SESSION_LIFETIME_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS: u64 = 15 * 60 * 1000;
const LOGIN_LIMIT: usize = 5;
static ARGON2_JOBS: LazyLock<Arc<tokio::sync::Semaphore>> =
    LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(2)));

pub struct AuthState {
    setup_token_hash: Option<String>,
    login_attempts: Mutex<HashMap<IpAddr, VecDeque<u64>>>,
    session_lifecycle: tokio::sync::RwLock<()>,
    secure_cookie: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupRequest {
    setup_token: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginRequest {
    password: String,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthIdentity {
    session_id: String,
    csrf_token: String,
}

impl AuthState {
    pub fn new(setup_token: Option<&str>, secure_cookie: bool) -> Self {
        Self {
            setup_token_hash: setup_token.map(hash_token),
            login_attempts: Mutex::new(HashMap::new()),
            session_lifecycle: tokio::sync::RwLock::new(()),
            secure_cookie,
        }
    }

    fn reserve_login(&self, ip: IpAddr) -> bool {
        self.reserve_login_at(ip, clock::now())
    }

    fn reserve_login_at(&self, ip: IpAddr, now: u64) -> bool {
        let mut attempts = self
            .login_attempts
            .lock()
            .expect("login attempts lock poisoned");
        let attempts = attempts.entry(ip).or_default();
        while attempts
            .front()
            .is_some_and(|time| now.saturating_sub(*time) > LOGIN_WINDOW_MS)
        {
            attempts.pop_front();
        }
        if attempts.len() >= LOGIN_LIMIT {
            return false;
        }
        attempts.push_back(now);
        true
    }

    fn clear_failures(&self, ip: IpAddr) {
        self.login_attempts
            .lock()
            .expect("login attempts lock poisoned")
            .remove(&ip);
    }

    pub(crate) fn session_lifecycle(&self) -> &tokio::sync::RwLock<()> {
        &self.session_lifecycle
    }
}

pub async fn status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    status_response(state.pool(), &headers).await
}

async fn status_response(pool: &SqlitePool, headers: &HeaderMap) -> Response {
    let initialized = match initialized(pool).await {
        Ok(initialized) => initialized,
        Err(_) => return database_error(),
    };
    let session = match authenticate(pool, headers).await {
        Ok(session) => session,
        Err(_) => return database_error(),
    };
    with_no_store(
        Json(serde_json::json!({
            "initialized": initialized,
            "authenticated": session.is_some(),
            "csrfToken": session.map(|session| session.csrf_token)
        }))
        .into_response(),
    )
}

pub async fn setup(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetupRequest>,
) -> Response {
    let result = match initialized(state.pool()).await {
        Ok(initialized) => initialized,
        Err(_) => return database_error(),
    };
    if result {
        return error(StatusCode::CONFLICT, "ALREADY_INITIALIZED");
    }
    let valid_token = state
        .auth()
        .setup_token_hash
        .as_ref()
        .is_some_and(|expected| {
            constant_time_eq(
                expected.as_bytes(),
                hash_token(&request.setup_token).as_bytes(),
            )
        });
    if !valid_token {
        return error(StatusCode::FORBIDDEN, "INVALID_SETUP_TOKEN");
    }
    let password = request.password;
    let permit = match ARGON2_JOBS.clone().acquire_owned().await {
        Ok(permit) => permit,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "PASSWORD_HASH_FAILED"),
    };
    let password_hash = match tokio::task::spawn_blocking(move || {
        let _permit = permit;
        password_hash(&password)
    })
    .await
    {
        Ok(Some(hash)) => hash,
        Ok(None) => return error(StatusCode::BAD_REQUEST, "INVALID_PASSWORD"),
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "PASSWORD_HASH_FAILED"),
    };
    let now = clock::now() as i64;
    let result = sqlx::query(
        "INSERT INTO admin_credentials (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)",
    )
    .bind(password_hash)
    .bind(now)
    .bind(now)
    .execute(state.pool())
    .await;
    if result.is_err() {
        return error(StatusCode::CONFLICT, "ALREADY_INITIALIZED");
    }
    create_session_response(&state).await
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(address): ConnectInfo<crate::server::ClientAddr>,
    Json(request): Json<LoginRequest>,
) -> Response {
    if !state.auth().reserve_login(address.0.ip()) {
        return error(StatusCode::TOO_MANY_REQUESTS, "LOGIN_RATE_LIMITED");
    }
    let hash = match sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM admin_credentials WHERE id = 1",
    )
    .fetch_optional(state.pool())
    .await
    {
        Ok(hash) => hash,
        Err(_) => return database_error(),
    };
    let valid = if let Some(hash) = hash {
        let password = request.password;
        match ARGON2_JOBS.clone().acquire_owned().await {
            Ok(permit) => match tokio::task::spawn_blocking(move || {
                let _permit = permit;
                verify_password(&hash, &password)
            })
            .await
            {
                Ok(valid) => valid,
                Err(_) => {
                    return error(StatusCode::INTERNAL_SERVER_ERROR, "PASSWORD_VERIFY_FAILED");
                }
            },
            Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "PASSWORD_VERIFY_FAILED"),
        }
    } else {
        false
    };
    if !valid {
        tokio::time::sleep(Duration::from_millis(350)).await;
        return error(StatusCode::UNAUTHORIZED, "INVALID_CREDENTIALS");
    }
    state.auth().clear_failures(address.0.ip());
    create_session_response(&state).await
}

pub async fn verify() -> Response {
    with_no_store(StatusCode::NO_CONTENT.into_response())
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    axum::extract::Extension(identity): axum::extract::Extension<AuthIdentity>,
) -> Response {
    logout_response(state.pool(), state.auth(), &identity).await
}

async fn logout_response(pool: &SqlitePool, auth: &AuthState, identity: &AuthIdentity) -> Response {
    let _lifecycle = auth.session_lifecycle.write().await;
    if revoke_identity(pool, identity).await.is_err() {
        return database_error();
    }
    let cookie = cookie_header("", true, auth.secure_cookie);
    with_no_store((StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response())
}

async fn revoke_identity(pool: &SqlitePool, identity: &AuthIdentity) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM auth_sessions WHERE id = ?")
        .bind(&identity.session_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    let session = match authenticate(state.pool(), request.headers()).await {
        Ok(Some(session)) => session,
        Ok(None) => return error(StatusCode::UNAUTHORIZED, "AUTHENTICATION_REQUIRED"),
        Err(_) => return database_error(),
    };
    if request.method() != Method::GET
        && request.method() != Method::HEAD
        && request.method() != Method::OPTIONS
    {
        let valid = request
            .headers()
            .get("x-csrf-token")
            .and_then(|value| value.to_str().ok())
            .is_some_and(|token| constant_time_eq(token.as_bytes(), session.csrf_token.as_bytes()));
        if !valid {
            return error(StatusCode::FORBIDDEN, "INVALID_CSRF_TOKEN");
        }
    }
    request.extensions_mut().insert(session);
    next.run(request).await
}

async fn initialized(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT EXISTS(SELECT 1 FROM admin_credentials WHERE id = 1)")
            .fetch_one(pool)
            .await?
            != 0,
    )
}

async fn create_session_response(state: &AppState) -> Response {
    let token = random_token();
    let csrf_token = random_token();
    let now = clock::now();
    let expires_at = now + SESSION_LIFETIME_MS;
    let inserted = sqlx::query(
        "INSERT INTO auth_sessions (id, token_hash, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(hash_token(&token))
    .bind(&csrf_token)
    .bind(now as i64)
    .bind(expires_at as i64)
    .bind(now as i64)
    .execute(state.pool())
    .await;
    if inserted.is_err() {
        return error(StatusCode::INTERNAL_SERVER_ERROR, "SESSION_CREATE_FAILED");
    }
    let cookie = cookie_header(&token, false, state.auth().secure_cookie);
    with_no_store(
        (
            StatusCode::OK,
            [(header::SET_COOKIE, cookie)],
            Json(serde_json::json!({ "authenticated": true, "initialized": true, "csrfToken": csrf_token })),
        )
            .into_response(),
    )
}

async fn authenticate(
    pool: &SqlitePool,
    headers: &HeaderMap,
) -> Result<Option<AuthIdentity>, sqlx::Error> {
    let Some(token) = cookie(headers) else {
        return Ok(None);
    };
    let now = clock::now() as i64;
    sqlx::query_as::<_, (String, String)>(
        "SELECT id, csrf_token FROM auth_sessions WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(hash_token(&token))
    .bind(now)
    .fetch_optional(pool)
    .await
    .map(|session| {
        session.map(|(session_id, csrf_token)| AuthIdentity {
            session_id,
            csrf_token,
        })
    })
}

pub(crate) async fn validate_identity(
    pool: &SqlitePool,
    identity: &AuthIdentity,
) -> Result<bool, sqlx::Error> {
    let now = clock::now() as i64;
    sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(SELECT 1 FROM auth_sessions WHERE id = ? AND expires_at > ?)",
    )
    .bind(&identity.session_id)
    .bind(now)
    .fetch_one(pool)
    .await
    .map(|valid| valid != 0)
}

fn password_hash(password: &str) -> Option<String> {
    if password.len() < 12 || password.len() > 1024 {
        return None;
    }
    Argon2::default()
        .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
        .ok()
        .map(|hash| hash.to_string())
}

fn verify_password(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash).ok().is_some_and(|hash| {
        Argon2::default()
            .verify_password(password.as_bytes(), &hash)
            .is_ok()
    })
}

fn random_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn hash_token(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

fn cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|cookie| {
            cookie
                .strip_prefix(&format!("{COOKIE_NAME}="))
                .map(str::to_string)
        })
}

fn cookie_header(token: &str, clear: bool, secure: bool) -> String {
    let secure = if secure { "; Secure" } else { "" };
    let age = if clear { 0 } else { SESSION_LIFETIME_MS / 1000 };
    format!("{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}")
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn error(status: StatusCode, code: &'static str) -> Response {
    with_no_store(ApiError::new(status, code).into_response())
}

fn database_error() -> Response {
    error(StatusCode::INTERNAL_SERVER_ERROR, "DATABASE_ERROR")
}

pub(crate) fn with_no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[cfg(test)]
mod tests {
    use super::{
        AuthIdentity, AuthState, LOGIN_LIMIT, LOGIN_WINDOW_MS, authenticate, constant_time_eq,
        hash_token, logout_response, password_hash, status_response, validate_identity,
        verify_password,
    };
    use axum::{
        body::to_bytes,
        http::{HeaderMap, HeaderValue, StatusCode, header},
    };
    use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
    use std::{net::IpAddr, sync::Arc};

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        pool
    }

    async fn response_body(response: axum::response::Response) -> String {
        String::from_utf8(
            to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap()
    }

    async fn insert_session(pool: &SqlitePool, id: &str, token: &str, expires_at: i64) {
        sqlx::query(
            "INSERT INTO auth_sessions (id, token_hash, csrf_token, created_at, expires_at, last_seen_at) VALUES (?, ?, 'csrf', 0, ?, 0)",
        )
        .bind(id)
        .bind(hash_token(token))
        .bind(expires_at)
        .execute(pool)
        .await
        .unwrap();
    }

    #[test]
    fn hashes_and_verifies_passwords() {
        let hash = password_hash("a sufficiently long password").unwrap();
        assert!(verify_password(&hash, "a sufficiently long password"));
        assert!(!verify_password(&hash, "a different password"));
    }

    #[test]
    fn reserves_attempts_atomically_at_the_limit() {
        let state = Arc::new(AuthState::new(None, false));
        let ip = IpAddr::from([127, 0, 0, 1]);
        let threads = (0..LOGIN_LIMIT * 2)
            .map(|_| {
                let state = state.clone();
                std::thread::spawn(move || state.reserve_login_at(ip, 1))
            })
            .collect::<Vec<_>>();
        assert_eq!(
            threads
                .into_iter()
                .map(|thread| thread.join().unwrap())
                .filter(|allowed| *allowed)
                .count(),
            LOGIN_LIMIT
        );
        assert!(!state.reserve_login_at(ip, 1));
        assert!(state.reserve_login_at(ip, LOGIN_WINDOW_MS + 2));
    }

    #[test]
    fn successful_login_clears_reserved_attempts() {
        let state = AuthState::new(None, false);
        let ip = IpAddr::from([127, 0, 0, 1]);
        for _ in 0..LOGIN_LIMIT {
            assert!(state.reserve_login_at(ip, 1));
        }
        assert!(!state.reserve_login_at(ip, 1));
        state.clear_failures(ip);
        assert!(state.reserve_login_at(ip, 1));
    }

    #[tokio::test]
    async fn status_reports_database_errors_without_auth_fallback() {
        let pool = pool().await;
        pool.close().await;
        let response = status_response(&pool, &HeaderMap::new()).await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            response_body(response).await,
            r#"{"error":"DATABASE_ERROR"}"#
        );
    }

    #[tokio::test]
    async fn logout_failure_does_not_clear_cookie() {
        let pool = pool().await;
        pool.close().await;
        let identity = AuthIdentity {
            session_id: "session-1".into(),
            csrf_token: "csrf".into(),
        };
        let auth = AuthState::new(None, false);
        let response = logout_response(&pool, &auth, &identity).await;
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(response.headers().get(header::SET_COOKIE).is_none());
        assert_eq!(
            response_body(response).await,
            r#"{"error":"DATABASE_ERROR"}"#
        );
    }

    #[tokio::test]
    async fn authenticated_identity_tracks_session_revocation_and_expiry() {
        let pool = pool().await;
        let now = crate::clock::now() as i64;
        insert_session(&pool, "active", "token", now + 60_000).await;
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("devhatch_session=token"),
        );
        let identity = authenticate(&pool, &headers).await.unwrap().unwrap();
        assert_eq!(identity.session_id, "active");
        assert!(validate_identity(&pool, &identity).await.unwrap());
        sqlx::query("DELETE FROM auth_sessions WHERE id = 'active'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!validate_identity(&pool, &identity).await.unwrap());

        insert_session(&pool, "expired", "expired-token", now - 1).await;
        let expired = AuthIdentity {
            session_id: "expired".into(),
            csrf_token: "csrf".into(),
        };
        assert!(!validate_identity(&pool, &expired).await.unwrap());
    }

    #[test]
    fn compares_tokens() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
    }
}
