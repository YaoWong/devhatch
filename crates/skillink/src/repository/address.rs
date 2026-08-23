use crate::{Error, Result};
use url::Url;

pub(super) struct RepositoryAddress {
    pub(super) clone_url: String,
    pub(super) name: String,
}

pub(super) fn parse_repository_address(value: &str) -> Result<RepositoryAddress> {
    let value = value.trim();
    if value.is_empty() || value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(Error::InvalidRepositoryUrl);
    }
    if let Ok(mut url) = Url::parse(value) {
        return match url.scheme() {
            "http" | "https" => {
                if url.host_str().is_none()
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    return Err(Error::InvalidRepositoryUrl);
                }
                url.set_query(None);
                url.set_fragment(None);
                if url.host_str() == Some("github.com") {
                    let parts = path_parts(url.path());
                    if parts.len() < 2 {
                        return Err(Error::InvalidRepositoryUrl);
                    }
                    let repository = strip_git_suffix(parts[1]);
                    if repository.is_empty() {
                        return Err(Error::InvalidRepositoryUrl);
                    }
                    return Ok(RepositoryAddress {
                        clone_url: format!("https://github.com/{}/{}.git", parts[0], repository),
                        name: repository.into(),
                    });
                }
                normalize_url(url)
            }
            "ssh" => {
                if url.host_str().is_none() || url.password().is_some() {
                    return Err(Error::InvalidRepositoryUrl);
                }
                url.set_query(None);
                url.set_fragment(None);
                normalize_url(url)
            }
            _ => Err(Error::InvalidRepositoryUrl),
        };
    }
    parse_scp_address(value)
}

pub fn repository_name(value: &str) -> String {
    parse_repository_address(value)
        .map(|address| address.name)
        .unwrap_or_else(|_| value.to_owned())
}

fn normalize_url(mut url: Url) -> Result<RepositoryAddress> {
    let name = path_parts(url.path())
        .last()
        .map(|part| strip_git_suffix(part).to_owned())
        .filter(|name| !name.is_empty())
        .ok_or(Error::InvalidRepositoryUrl)?;
    let path = url.path().trim_end_matches('/').to_owned();
    url.set_path(&path);
    Ok(RepositoryAddress {
        clone_url: url.to_string(),
        name,
    })
}

fn parse_scp_address(value: &str) -> Result<RepositoryAddress> {
    let (authority, path) = value.split_once(':').ok_or(Error::InvalidRepositoryUrl)?;
    let (user, host) = authority
        .split_once('@')
        .ok_or(Error::InvalidRepositoryUrl)?;
    if user.is_empty()
        || host.is_empty()
        || path.is_empty()
        || path.starts_with('/')
        || authority.bytes().any(|byte| byte.is_ascii_whitespace())
        || path.bytes().any(|byte| byte.is_ascii_whitespace())
    {
        return Err(Error::InvalidRepositoryUrl);
    }
    let name = path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .map(strip_git_suffix)
        .filter(|name| !name.is_empty())
        .ok_or(Error::InvalidRepositoryUrl)?;
    Ok(RepositoryAddress {
        clone_url: value.trim_end_matches('/').into(),
        name: name.into(),
    })
}

fn path_parts(path: &str) -> Vec<&str> {
    path.split('/').filter(|part| !part.is_empty()).collect()
}

fn strip_git_suffix(value: &str) -> &str {
    value.strip_suffix(".git").unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_repository_addresses() {
        for (input, clone_url, name) in [
            (
                "https://github.com/acme/tools/tree/main/skills/demo",
                "https://github.com/acme/tools.git",
                "tools",
            ),
            (
                "http://git.example.com/acme/tools.git",
                "http://git.example.com/acme/tools.git",
                "tools",
            ),
            (
                "ssh://git@git.example.com/acme/tools.git",
                "ssh://git@git.example.com/acme/tools.git",
                "tools",
            ),
            (
                "git@git.example.com:acme/tools.git",
                "git@git.example.com:acme/tools.git",
                "tools",
            ),
        ] {
            let address = parse_repository_address(input).unwrap();
            assert_eq!(address.clone_url, clone_url);
            assert_eq!(address.name, name);
        }
    }

    #[test]
    fn rejects_unsupported_repository_addresses() {
        for input in [
            "",
            "file:///tmp/repo",
            "https://user@example.com/repo",
            "git@example.com:",
        ] {
            assert!(parse_repository_address(input).is_err());
        }
    }
}
