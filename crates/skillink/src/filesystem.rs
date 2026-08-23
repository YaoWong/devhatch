use crate::{Error, Result, validation::validate_relative_path};
use std::{fs, path::Path};
use uuid::Uuid;
use walkdir::WalkDir;

pub(crate) fn publish_directory(source: &Path, destination: &Path) -> Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| Error::UnsafeEntry(destination.display().to_string()))?;
    fs::create_dir_all(parent)?;
    fs::rename(source, destination)?;
    Ok(())
}

pub(crate) fn remove_managed_directory(root: &Path, category: &str, id: &str) -> Result<()> {
    Uuid::parse_str(id).map_err(|_| Error::UnsafeEntry(id.into()))?;
    let path = root.join(category).join(id);
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

pub(crate) fn copy_directory_safely(source: &Path, destination: &Path) -> Result<()> {
    if !source.is_dir() {
        return Err(Error::UnsafeEntry(source.display().to_string()));
    }
    fs::create_dir(destination)?;
    let result = (|| {
        for entry in WalkDir::new(source).follow_links(false).min_depth(1) {
            let entry = entry?;
            let relative = entry
                .path()
                .strip_prefix(source)
                .map_err(|_| Error::UnsafeEntry(entry.path().display().to_string()))?;
            validate_relative_path(relative)?;
            let target = destination.join(relative);
            let file_type = entry.file_type();
            if file_type.is_symlink() || (!file_type.is_file() && !file_type.is_dir()) {
                return Err(Error::UnsafeEntry(entry.path().display().to_string()));
            }
            if file_type.is_dir() {
                fs::create_dir(&target)?;
            } else {
                fs::copy(entry.path(), target)?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    result
}
