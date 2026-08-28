use crate::{Error, Result, validation::validate_relative_path};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read},
    path::Path,
};
use uuid::Uuid;
use walkdir::WalkDir;

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

const MAX_COPY_FILES: u64 = 10_000;
const MAX_COPY_ENTRIES: u64 = 20_000;
const MAX_COPY_DEPTH: usize = 32;
const MAX_COPY_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_COPY_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

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
    let source_metadata = fs::symlink_metadata(source)?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_dir() {
        return Err(Error::UnsafeEntry(source.display().to_string()));
    }
    fs::create_dir(destination)?;
    let result = (|| {
        let mut files = 0_u64;
        let mut entries = 0_u64;
        let mut total_bytes = 0_u64;
        for entry in WalkDir::new(source)
            .follow_links(false)
            .min_depth(1)
            .max_depth(MAX_COPY_DEPTH + 1)
        {
            let entry = entry?;
            if entry.depth() > MAX_COPY_DEPTH {
                return Err(Error::UnsafeEntry(format!(
                    "import depth budget exceeded at {}",
                    entry.path().display()
                )));
            }
            entries = entries
                .checked_add(1)
                .ok_or_else(|| Error::UnsafeEntry("import entry budget exceeded".into()))?;
            if entries > MAX_COPY_ENTRIES {
                return Err(Error::UnsafeEntry(format!(
                    "import entry budget exceeded at {}",
                    entry.path().display()
                )));
            }
            let relative = entry
                .path()
                .strip_prefix(source)
                .map_err(|_| Error::UnsafeEntry(entry.path().display().to_string()))?;
            validate_relative_path(relative)?;
            let target = destination.join(relative);
            let before = fs::symlink_metadata(entry.path())?;
            if before.file_type().is_symlink() || (!before.is_file() && !before.is_dir()) {
                return Err(Error::UnsafeEntry(entry.path().display().to_string()));
            }
            if before.is_dir() {
                fs::create_dir(&target)?;
            } else {
                account_file(&mut files, &mut total_bytes, before.len(), entry.path())?;
                copy_regular_file(entry.path(), &target, &before)?;
            }
            let after = fs::symlink_metadata(entry.path())?;
            if !same_identity(&before, &after) {
                return Err(Error::UnsafeEntry(entry.path().display().to_string()));
            }
        }
        let source_after = fs::symlink_metadata(source)?;
        if !same_identity(&source_metadata, &source_after) {
            return Err(Error::UnsafeEntry(source.display().to_string()));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    result
}

fn account_file(files: &mut u64, total_bytes: &mut u64, bytes: u64, path: &Path) -> Result<()> {
    *files = files
        .checked_add(1)
        .ok_or_else(|| Error::UnsafeEntry("import file budget exceeded".into()))?;
    *total_bytes = total_bytes
        .checked_add(bytes)
        .ok_or_else(|| Error::UnsafeEntry("import byte budget exceeded".into()))?;
    if *files > MAX_COPY_FILES || bytes > MAX_COPY_FILE_BYTES || *total_bytes > MAX_COPY_TOTAL_BYTES
    {
        return Err(Error::UnsafeEntry(format!(
            "import budget exceeded at {}",
            path.display()
        )));
    }
    Ok(())
}

fn copy_regular_file(source: &Path, destination: &Path, expected: &Metadata) -> Result<()> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW);
    let input = options.open(source)?;
    if !same_identity(expected, &input.metadata()?) {
        return Err(Error::UnsafeEntry(source.display().to_string()));
    }
    let mut output = File::create(destination)?;
    let copied = io::copy(
        &mut input.take(expected.len().saturating_add(1)),
        &mut output,
    )?;
    if copied != expected.len() {
        return Err(Error::UnsafeEntry(source.display().to_string()));
    }
    Ok(())
}

#[cfg(unix)]
fn same_identity(left: &Metadata, right: &Metadata) -> bool {
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.file_type() == right.file_type()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
}

#[cfg(not(unix))]
fn same_identity(left: &Metadata, right: &Metadata) -> bool {
    left.file_type() == right.file_type()
        && left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn copy_rejects_single_file_over_budget_and_cleans_destination() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir(&source).unwrap();
        let file = File::create(source.join("large")).unwrap();
        file.set_len(MAX_COPY_FILE_BYTES + 1).unwrap();
        assert!(copy_directory_safely(&source, &destination).is_err());
        assert!(!destination.exists());
    }

    #[test]
    fn copy_rejects_total_bytes_over_budget() {
        let mut files = 0;
        let mut total_bytes = MAX_COPY_TOTAL_BYTES - MAX_COPY_FILE_BYTES;
        account_file(
            &mut files,
            &mut total_bytes,
            MAX_COPY_FILE_BYTES,
            Path::new("first"),
        )
        .unwrap();
        assert!(account_file(&mut files, &mut total_bytes, 1, Path::new("second")).is_err());
    }

    #[test]
    fn copy_rejects_file_count_over_budget_and_cleans_destination() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir(&source).unwrap();
        for index in 0..=MAX_COPY_FILES {
            File::create(source.join(index.to_string())).unwrap();
        }
        assert!(copy_directory_safely(&source, &destination).is_err());
        assert!(!destination.exists());
    }

    #[test]
    fn copy_rejects_empty_directory_count_over_budget() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir(&source).unwrap();
        for index in 0..=MAX_COPY_ENTRIES {
            fs::create_dir(source.join(index.to_string())).unwrap();
        }
        assert!(copy_directory_safely(&source, &destination).is_err());
        assert!(!destination.exists());
    }

    #[test]
    fn copy_rejects_directory_over_depth_budget() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        let destination = temp.path().join("destination");
        fs::create_dir(&source).unwrap();
        let mut directory = source.clone();
        for index in 0..=MAX_COPY_DEPTH {
            directory = directory.join(index.to_string());
            fs::create_dir(&directory).unwrap();
        }
        assert!(copy_directory_safely(&source, &destination).is_err());
        assert!(!destination.exists());
    }
}
