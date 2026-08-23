use crate::{Error, Result};
use serde::Deserialize;
use std::{fs, path::Path};

pub(crate) const MAX_MANIFEST_SIZE: u64 = 1024 * 1024;

#[derive(Deserialize)]
pub(crate) struct Manifest {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
}

pub(crate) fn parse_strict(path: &Path) -> Result<Manifest> {
    let metadata = path.metadata()?;
    if metadata.len() > MAX_MANIFEST_SIZE {
        return Err(Error::Manifest {
            path: path.display().to_string(),
            message: format!("SKILL.md exceeds {MAX_MANIFEST_SIZE} bytes"),
        });
    }
    let content = fs::read_to_string(path).map_err(|error| Error::Manifest {
        path: path.display().to_string(),
        message: error.to_string(),
    })?;
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return Err(Error::Manifest {
            path: path.display().to_string(),
            message: "frontmatter must start with ---".into(),
        });
    }
    let mut frontmatter = Vec::new();
    let mut closed = false;
    for line in lines {
        if line == "---" {
            closed = true;
            break;
        }
        frontmatter.push(line);
    }
    if !closed {
        return Err(Error::Manifest {
            path: path.display().to_string(),
            message: "frontmatter closing --- is required".into(),
        });
    }
    serde_yaml::from_str(&frontmatter.join("\n")).map_err(|error| Error::Manifest {
        path: path.display().to_string(),
        message: format!("invalid frontmatter: {error}"),
    })
}

pub(crate) fn parse_permissive(path: &Path) -> Result<(Option<String>, Option<String>)> {
    let content = fs::read_to_string(path)?;
    let mut lines = content.lines();
    if lines.next() != Some("---") {
        return Ok((None, None));
    }
    let mut name = None;
    let mut description = None;
    for line in lines {
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(value.trim().trim_matches(['\'', '"']).to_owned());
        } else if let Some(value) = line.strip_prefix("description:") {
            description = Some(value.trim().trim_matches(['\'', '"']).to_owned());
        }
    }
    Ok((name.filter(|value| !value.is_empty()), description))
}
