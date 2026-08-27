use std::path::{Path, PathBuf};

use serde::Serialize;

use super::PORT;

pub(super) fn public_url() -> String {
    resolve_public_url(
        std::env::var("DEVHATCH_OPENDESIGN_PUBLIC_URL").ok(),
        std::env::var("DEVHATCH_OPEN_DESIGN_URL").ok(),
        std::env::var("DEVHATCH_PUBLIC_ORIGIN").ok(),
    )
}

fn resolve_public_url(
    current: Option<String>,
    legacy: Option<String>,
    origin: Option<String>,
) -> String {
    current
        .filter(|url| valid_http_url(url))
        .or_else(|| legacy.filter(|url| valid_http_url(url)))
        .or_else(|| {
            origin
                .and_then(|origin| url::Url::parse(&origin).ok())
                .filter(|origin| {
                    matches!(origin.scheme(), "http" | "https")
                        && origin.host_str().is_some()
                        && origin.username().is_empty()
                        && origin.password().is_none()
                        && origin.path() == "/"
                        && origin.query().is_none()
                        && origin.fragment().is_none()
                })
                .and_then(|mut origin| {
                    origin.set_port(Some(8443)).ok()?;
                    Some(origin.to_string().trim_end_matches('/').to_string())
                })
        })
        .unwrap_or_else(|| format!("http://127.0.0.1:{PORT}"))
}

fn valid_http_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https")
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

pub(super) fn prerequisites() -> Prerequisites {
    Prerequisites {
        git: executable_on_path("git").is_some(),
        node24: node24_path().is_some(),
        corepack: node24_path()
            .and_then(|node| sibling_executable(&node, "corepack"))
            .is_some(),
    }
}

pub(super) fn node24_path() -> Option<PathBuf> {
    let candidates = executable_candidates("node").chain([
        PathBuf::from("/home/linuxbrew/.linuxbrew/opt/node@24/bin/node"),
        PathBuf::from("/usr/local/opt/node@24/bin/node"),
        PathBuf::from("/opt/homebrew/opt/node@24/bin/node"),
    ]);
    candidates.filter(|path| path.is_file()).find(|path| {
        std::process::Command::new(path)
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .trim_start_matches('v')
                    .starts_with("24.")
            })
    })
}

pub(super) fn executable_on_path(name: &str) -> Option<PathBuf> {
    executable_candidates(name).find(|path| path.is_file())
}

fn executable_candidates(name: &str) -> impl Iterator<Item = PathBuf> + '_ {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(move |path| path.join(name))
}

pub(super) fn sibling_executable(executable: &Path, name: &str) -> Option<PathBuf> {
    executable
        .parent()
        .map(|parent| parent.join(name))
        .filter(|path| path.is_file())
}

pub(super) fn prefixed_path(node: &Path) -> std::ffi::OsString {
    let mut paths = node
        .parent()
        .into_iter()
        .map(Path::to_path_buf)
        .collect::<Vec<_>>();
    if let Some(current) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&current));
    }
    std::env::join_paths(paths).unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Prerequisites {
    pub git: bool,
    pub node24: bool,
    pub corepack: bool,
}

#[cfg(test)]
mod tests {
    use super::{prefixed_path, resolve_public_url};
    use crate::web_app::PORT;
    use std::path::Path;

    #[test]
    fn prefers_current_public_url_and_accepts_legacy_url() {
        assert_eq!(
            resolve_public_url(
                Some("https://new.example/open-design".into()),
                Some("https://legacy.example/open-design".into()),
                None,
            ),
            "https://new.example/open-design"
        );
        assert_eq!(
            resolve_public_url(
                Some("invalid".into()),
                Some("https://legacy.example/open-design".into()),
                None,
            ),
            "https://legacy.example/open-design"
        );
    }

    #[test]
    fn prefixes_node_directory_for_installer_commands() {
        let path = prefixed_path(Path::new("/opt/node24/bin/node"));
        assert!(path.to_string_lossy().starts_with("/opt/node24/bin"));
        assert_eq!(PORT, 17456);
    }
}
