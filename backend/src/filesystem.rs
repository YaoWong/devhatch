use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use axum::{Json, extract::Query, http::StatusCode, response::IntoResponse};
use path_clean::PathClean;
use serde::{Deserialize, Serialize};

use crate::terminal::default_cwd;

#[derive(Deserialize)]
pub struct DirectoryQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct DirectoryEntry {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    path: String,
    parent: Option<String>,
    home: String,
    resolved_home: String,
    directories: Vec<DirectoryEntry>,
}

pub async fn directories(Query(query): Query<DirectoryQuery>) -> impl IntoResponse {
    match directory_listing(query.path.as_deref()) {
        Ok(listing) => Json(listing).into_response(),
        Err(error) if error.kind() == io::ErrorKind::InvalidInput => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "NOT_A_DIRECTORY" })),
        )
            .into_response(),
        Err(error) => {
            let status = if error.kind() == io::ErrorKind::PermissionDenied {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::NOT_FOUND
            };
            let code = error
                .raw_os_error()
                .map_or_else(|| "DIRECTORY_READ_FAILED".to_string(), errno_name);
            (status, Json(serde_json::json!({ "error": code }))).into_response()
        }
    }
}

fn directory_listing(requested: Option<&str>) -> io::Result<DirectoryListing> {
    let directory = resolve_path(requested.unwrap_or(&default_cwd()))?;
    if !fs::metadata(&directory)?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a directory",
        ));
    }
    let mut directories = fs::read_dir(&directory)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name.starts_with('.') || !entry.file_type().ok()?.is_dir() {
                return None;
            }
            Some(DirectoryEntry {
                path: entry.path().to_string_lossy().into_owned(),
                name,
            })
        })
        .collect::<Vec<_>>();
    directories.sort_by_cached_key(|entry| entry.name.to_lowercase());
    let home = home_dir();
    let resolved_home = fs::canonicalize(&home)?;
    let parent = directory
        .parent()
        .filter(|parent| *parent != directory)
        .map(path_string);
    Ok(DirectoryListing {
        path: path_string(&directory),
        parent,
        home: path_string(&home),
        resolved_home: path_string(&resolved_home),
        directories,
    })
}

pub fn home_dir() -> PathBuf {
    env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from)
}

pub fn resolve_path(value: &str) -> io::Result<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() {
        Ok(path.clean())
    } else {
        Ok(env::current_dir()?.join(path).clean())
    }
}

pub fn path_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

fn errno_name(code: i32) -> String {
    match code {
        1 => "EPERM",
        2 => "ENOENT",
        13 => "EACCES",
        20 => "ENOTDIR",
        _ => "DIRECTORY_READ_FAILED",
    }
    .to_string()
}
