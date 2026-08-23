use crate::{Error, Result};
use std::path::{Component, Path};

pub fn validate_slug(slug: &str) -> Result<()> {
    if slug.is_empty()
        || slug.len() > 64
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || !slug.as_bytes()[0].is_ascii_alphanumeric()
        || !slug.as_bytes()[slug.len() - 1].is_ascii_alphanumeric()
        || slug.contains("--")
    {
        return Err(Error::InvalidSlug(slug.into()));
    }
    Ok(())
}

pub(crate) fn validate_description(description: &str) -> Result<()> {
    if description.is_empty() || description.len() > 1024 {
        return Err(Error::Manifest {
            path: "SKILL.md".into(),
            message: "description must be between 1 and 1024 bytes".into(),
        });
    }
    Ok(())
}

pub(crate) fn validate_relative_path(path: &Path) -> Result<()> {
    if path == Path::new(".") {
        return Ok(());
    }
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(Error::UnsafeEntry(path.display().to_string()));
    }
    Ok(())
}

pub(crate) fn path_to_db(path: &Path) -> Result<String> {
    validate_relative_path(path)?;
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| Error::UnsafeEntry(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_slugs() {
        for valid in ["a", "skill-1", "abc123"] {
            assert!(validate_slug(valid).is_ok());
        }
        for invalid in ["", "A", "-a", "a-", "a--b", "a_b"] {
            assert!(validate_slug(invalid).is_err());
        }
    }
}
