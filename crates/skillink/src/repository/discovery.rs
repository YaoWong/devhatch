use crate::{
    Error, Result,
    skill::manifest::parse_strict,
    validation::{path_to_db, validate_slug},
};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

const ROOT_RELATIVE_PATH: &str = ".";

#[derive(Debug, Clone)]
pub(super) struct DiscoveredSkill {
    pub(super) slug: String,
    pub(super) description: String,
    pub(super) relative_path: String,
}

pub(super) fn discover_repository(root: &Path) -> Result<Vec<DiscoveredSkill>> {
    let skill_roots = find_skill_directories(root)?;
    let mut discovered = Vec::with_capacity(skill_roots.len());
    for directory in skill_roots {
        let manifest_path = directory.join("SKILL.md");
        if !manifest_path.symlink_metadata()?.file_type().is_file() {
            return Err(Error::UnsafeEntry(manifest_path.display().to_string()));
        }
        let is_root = directory == root;
        validate_skill_directory(&directory, is_root)?;
        let relative_path = if is_root {
            ROOT_RELATIVE_PATH.to_owned()
        } else {
            path_to_db(
                directory
                    .strip_prefix(root)
                    .map_err(|_| Error::UnsafeEntry(directory.display().to_string()))?,
            )?
        };
        let manifest = parse_strict(&directory.join("SKILL.md"))?;
        let slug = if is_root {
            manifest.name.ok_or_else(|| Error::Manifest {
                path: ROOT_RELATIVE_PATH.into(),
                message: "root SKILL.md requires name".into(),
            })?
        } else {
            let fallback = directory
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| Error::UnsafeEntry(directory.display().to_string()))?;
            manifest.name.unwrap_or_else(|| fallback.to_owned())
        };
        validate_manifest_slug(&slug, &relative_path)?;
        discovered.push(DiscoveredSkill {
            slug,
            description: manifest.description.unwrap_or_default(),
            relative_path,
        });
    }
    discovered.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let mut slugs: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for skill in &discovered {
        slugs
            .entry(skill.slug.to_ascii_lowercase())
            .or_default()
            .push(skill.relative_path.clone());
    }
    if let Some((slug, paths)) = slugs.into_iter().find(|(_, paths)| paths.len() > 1) {
        return Err(Error::DuplicateRepositorySlug { slug, paths });
    }
    Ok(discovered)
}

pub(super) fn find_skill_directories(root: &Path) -> Result<Vec<PathBuf>> {
    let mut directories = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || entry.file_name() != ".git")
    {
        let entry = entry?;
        if entry.file_name() != "SKILL.md" {
            continue;
        }
        if !entry.file_type().is_file() && !entry.file_type().is_symlink() {
            return Err(Error::UnsafeEntry(entry.path().display().to_string()));
        }
        directories.push(
            entry
                .path()
                .parent()
                .ok_or_else(|| Error::UnsafeEntry(entry.path().display().to_string()))?
                .to_owned(),
        );
    }
    directories.sort();
    Ok(directories)
}

fn validate_skill_directory(directory: &Path, root: bool) -> Result<()> {
    for entry in WalkDir::new(directory).follow_links(false) {
        let entry = entry?;
        if root && entry.depth() == 1 && matches!(entry.file_name().to_str(), Some(".git")) {
            continue;
        }
        if root
            && entry
                .path()
                .components()
                .any(|part| part.as_os_str() == ".git")
        {
            continue;
        }
        let file_type = entry.file_type();
        if file_type.is_symlink() || (!file_type.is_file() && !file_type.is_dir()) {
            return Err(Error::UnsafeEntry(entry.path().display().to_string()));
        }
    }
    Ok(())
}

fn validate_manifest_slug(slug: &str, path: &str) -> Result<()> {
    validate_slug(slug).map_err(|_| Error::Manifest {
        path: path.to_owned(),
        message: format!("invalid slug: {slug}"),
    })
}
