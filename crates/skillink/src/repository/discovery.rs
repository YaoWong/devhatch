use crate::{
    Error, Result,
    validation::{path_to_db, validate_slug},
};
use serde::Deserialize;
use std::{collections::BTreeMap, fs, path::Path};
use walkdir::WalkDir;

const MAX_MANIFEST_SIZE: u64 = 1024 * 1024;
const ROOT_RELATIVE_PATH: &str = ".";

#[derive(Debug, Clone)]
pub(super) struct DiscoveredSkill {
    pub(super) slug: String,
    pub(super) description: String,
    pub(super) relative_path: String,
}

pub(super) fn materialize_internal_file_links(root: &Path) -> Result<()> {
    let scan_root = if root.join("SKILL.md").exists() {
        root
    } else {
        let skills = root.join("skills");
        if !skills.exists() {
            return Ok(());
        }
        if !skills.symlink_metadata()?.file_type().is_dir() {
            return Err(Error::UnsafeEntry(skills.display().to_string()));
        }
        return materialize_links_under(root, &skills);
    };
    materialize_links_under(root, scan_root)
}

fn materialize_links_under(root: &Path, scan_root: &Path) -> Result<()> {
    let canonical_root = root.canonicalize()?;
    let mut links = Vec::new();
    for entry in WalkDir::new(scan_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || entry.file_name() != ".git")
    {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            links.push(entry.path().to_owned());
        }
    }
    for link in links {
        let target = fs::read_link(&link)?;
        if target.is_absolute() {
            return Err(Error::UnsafeEntry(link.display().to_string()));
        }
        let resolved = link
            .parent()
            .ok_or_else(|| Error::UnsafeEntry(link.display().to_string()))?
            .join(target)
            .canonicalize()
            .map_err(|_| Error::UnsafeEntry(link.display().to_string()))?;
        if !resolved.starts_with(&canonical_root) || !resolved.metadata()?.file_type().is_file() {
            return Err(Error::UnsafeEntry(link.display().to_string()));
        }
        let permissions = resolved.metadata()?.permissions();
        fs::remove_file(&link)?;
        fs::copy(&resolved, &link)?;
        fs::set_permissions(&link, permissions)?;
    }
    Ok(())
}

pub(super) fn discover_repository(root: &Path) -> Result<Vec<DiscoveredSkill>> {
    let mut discovered = Vec::new();
    let root_manifest = root.join("SKILL.md");
    if root_manifest.exists() {
        if !root_manifest.symlink_metadata()?.file_type().is_file() {
            return Err(Error::UnsafeEntry(root_manifest.display().to_string()));
        }
        validate_skill_directory(root, true)?;
        let manifest = parse_manifest(&root_manifest)?;
        let slug = manifest.name.ok_or_else(|| Error::Manifest {
            path: ROOT_RELATIVE_PATH.into(),
            message: "root SKILL.md requires name".into(),
        })?;
        validate_manifest_slug(&slug, ROOT_RELATIVE_PATH)?;
        discovered.push(DiscoveredSkill {
            slug,
            description: manifest.description.unwrap_or_default(),
            relative_path: ROOT_RELATIVE_PATH.into(),
        });
    }
    let skills = root.join("skills");
    if skills.exists() {
        if !skills.symlink_metadata()?.file_type().is_dir() {
            return Err(Error::UnsafeEntry(skills.display().to_string()));
        }
        let mut skill_roots = Vec::new();
        for entry in WalkDir::new(&skills).follow_links(false).min_depth(1) {
            let entry = entry?;
            let file_type = entry.file_type();
            if file_type.is_symlink() || (!file_type.is_file() && !file_type.is_dir()) {
                return Err(Error::UnsafeEntry(entry.path().display().to_string()));
            }
            if !file_type.is_file() || entry.file_name() != "SKILL.md" {
                continue;
            }
            let directory = entry
                .path()
                .parent()
                .ok_or_else(|| Error::UnsafeEntry(entry.path().display().to_string()))?;
            skill_roots.push(directory.to_owned());
            let relative_path = path_to_db(
                directory
                    .strip_prefix(root)
                    .map_err(|_| Error::UnsafeEntry(directory.display().to_string()))?,
            )?;
            let manifest = parse_manifest(entry.path())?;
            let fallback = directory
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| Error::UnsafeEntry(directory.display().to_string()))?;
            let slug = manifest.name.unwrap_or_else(|| fallback.to_owned());
            validate_manifest_slug(&slug, &relative_path)?;
            discovered.push(DiscoveredSkill {
                slug,
                description: manifest.description.unwrap_or_default(),
                relative_path,
            });
        }
        for directory in skill_roots {
            validate_skill_directory(&directory, false)?;
        }
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

#[derive(Deserialize)]
struct Manifest {
    name: Option<String>,
    description: Option<String>,
}

fn parse_manifest(path: &Path) -> Result<Manifest> {
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

fn validate_manifest_slug(slug: &str, path: &str) -> Result<()> {
    validate_slug(slug).map_err(|_| Error::Manifest {
        path: path.to_owned(),
        message: format!("invalid slug: {slug}"),
    })
}
