use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use axum::{Json, extract::Query, http::StatusCode, response::IntoResponse};
use path_clean::PathClean;
use serde::{Deserialize, Serialize};

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

pub fn default_cwd() -> String {
    env::var("DEVHATCH_CWD").unwrap_or_else(|_| path_string(home_dir()))
}

pub fn validated_directory(value: &str) -> Result<String, &'static str> {
    let path = resolve_path(value).map_err(|_| "INVALID_LAUNCH_PATH")?;
    let metadata = fs::metadata(&path).map_err(|_| "INVALID_LAUNCH_PATH")?;
    if !metadata.is_dir() {
        return Err("INVALID_LAUNCH_PATH");
    }
    fs::canonicalize(path)
        .map(path_string)
        .map_err(|_| "INVALID_LAUNCH_PATH")
}

pub fn validated_import_directory(value: &Path) -> io::Result<PathBuf> {
    let metadata = fs::symlink_metadata(value)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid import directory",
        ));
    }
    let source = fs::canonicalize(value)?;
    validate_import_source(source, &import_roots()?)
}

fn validate_import_source(source: PathBuf, roots: &[PathBuf]) -> io::Result<PathBuf> {
    if roots
        .iter()
        .any(|root| source != *root && source.starts_with(root))
    {
        Ok(source)
    } else {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "import directory is outside the authorized roots",
        ))
    }
}

fn import_roots() -> io::Result<Vec<PathBuf>> {
    let configured = env::var_os("DEVHATCH_IMPORT_ROOTS");
    let candidates = configured
        .as_ref()
        .map(|value| env::split_paths(value).collect::<Vec<_>>())
        .unwrap_or_else(|| vec![home_dir()]);
    let mut roots = Vec::new();
    for candidate in candidates {
        let root = fs::canonicalize(candidate)?;
        if root.parent().is_none() || !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid import root",
            ));
        }
        roots.push(root);
    }
    if roots.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "no import roots configured",
        ));
    }
    Ok(roots)
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

#[cfg(test)]
mod tests {
    use super::{resolve_path, validate_import_source, validated_directory};
    use tempfile::TempDir;

    #[test]
    fn resolves_relative_paths_and_rejects_invalid_directories() {
        assert!(resolve_path("relative").unwrap().is_absolute());
        assert!(validated_directory("/definitely/not/a/devhatch/path").is_err());
    }

    #[test]
    fn import_source_must_be_below_an_authorized_root() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let source = root.join("skill");
        std::fs::create_dir(&source).unwrap();
        assert_eq!(
            validate_import_source(source.clone(), std::slice::from_ref(&root)).unwrap(),
            source
        );
        assert!(validate_import_source(root.clone(), std::slice::from_ref(&root)).is_err());
        assert!(validate_import_source(temp.path().join("outside"), &[source]).is_err());
    }
}
