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
    http::{HeaderMap, Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{clock, state::AppState};

const COOKIE_NAME: &str = "devhatch_session";
const SESSION_LIFETIME_MS: u64 = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS: u64 = 15 * 60 * 1000;
const LOGIN_LIMIT: usize = 5;
static ARGON2_JOBS: LazyLock<Arc<tokio::sync::Semaphore>> =
    LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(2)));

pub struct AuthState {
    setup_token_hash: Option<String>,
    login_attempts: Mutex<HashMap<IpAddr, VecDeque<u64>>>,
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

struct SessionRecord {
    csrf_token: String,
}

impl AuthState {
    pub fn new(setup_token: Option<&str>, secure_cookie: bool) -> Self {
        Self {
            setup_token_hash: setup_token.map(hash_token),
            login_attempts: Mutex::new(HashMap::new()),
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
}

pub async fn status(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let initialized = initialized(state.pool()).await.unwrap_or(false);
    let session = authenticate(state.pool(), &headers).await.ok().flatten();
    Json(serde_json::json!({
        "initialized": initialized,
        "authenticated": session.is_some(),
        "csrfToken": session.map(|session| session.csrf_token)
    }))
    .into_response()
}

pub async fn setup(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SetupRequest>,
) -> Response {
    if initialized(state.pool()).await.unwrap_or(true) {
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
    ConnectInfo(address): ConnectInfo<std::net::SocketAddr>,
    Json(request): Json<LoginRequest>,
) -> Response {
    if !state.auth().reserve_login(address.ip()) {
        return error(StatusCode::TOO_MANY_REQUESTS, "LOGIN_RATE_LIMITED");
    }
    let hash =
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM admin_credentials WHERE id = 1")
            .fetch_optional(state.pool())
            .await
            .ok()
            .flatten();
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
    state.auth().clear_failures(address.ip());
    create_session_response(&state).await
}

pub async fn verify() -> StatusCode {
    StatusCode::NO_CONTENT
}

pub async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Some(token) = cookie(&headers) {
        let _ = sqlx::query("DELETE FROM auth_sessions WHERE token_hash = ?")
            .bind(hash_token(&token))
            .execute(state.pool())
            .await;
    }
    let cookie = cookie_header("", true, state.auth().secure_cookie);
    (StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response()
}

pub async fn require_auth(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let session = match authenticate(state.pool(), request.headers()).await {
        Ok(Some(session)) => session,
        _ => return error(StatusCode::UNAUTHORIZED, "AUTHENTICATION_REQUIRED"),
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
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(serde_json::json!({ "authenticated": true, "initialized": true, "csrfToken": csrf_token })),
    )
        .into_response()
}

async fn authenticate(
    pool: &SqlitePool,
    headers: &HeaderMap,
) -> Result<Option<SessionRecord>, sqlx::Error> {
    let Some(token) = cookie(headers) else {
        return Ok(None);
    };
    let now = clock::now() as i64;
    sqlx::query("DELETE FROM auth_sessions WHERE expires_at <= ?")
        .bind(now)
        .execute(pool)
        .await?;
    let csrf_token = sqlx::query_scalar::<_, String>(
        "SELECT csrf_token FROM auth_sessions WHERE token_hash = ? AND expires_at > ?",
    )
    .bind(hash_token(&token))
    .bind(now)
    .fetch_optional(pool)
    .await?;
    if csrf_token.is_some() {
        let _ = sqlx::query("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?")
            .bind(now)
            .bind(hash_token(&token))
            .execute(pool)
            .await;
    }
    Ok(csrf_token.map(|csrf_token| SessionRecord { csrf_token }))
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

fn error(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::{
        AuthState, LOGIN_LIMIT, LOGIN_WINDOW_MS, constant_time_eq, password_hash, verify_password,
    };
    use std::{net::IpAddr, sync::Arc};

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

    #[test]
    fn compares_tokens() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
    }
}
