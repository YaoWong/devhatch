use crate::{Error, Result, repository::discovery::find_skill_directories};
use std::{fs, path::Path};
use walkdir::WalkDir;

pub(super) fn materialize_internal_file_links(root: &Path) -> Result<()> {
    for directory in find_skill_directories(root)? {
        materialize_links_under(root, &directory)?;
    }
    Ok(())
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
