use serde::Serialize;
use sqlx::{
    FromRow, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    process::Stdio,
    str::FromStr,
    time::Duration,
};
use thiserror::Error;
use tokio::process::Command;
use url::Url;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid slug: {0}")]
    InvalidSlug(String),
    #[error("invalid repository URL: only public HTTPS URLs are supported")]
    InvalidRepositoryUrl,
    #[error("not found: {0}")]
    NotFound(String),
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("unsafe filesystem entry: {0}")]
    UnsafeEntry(String),
    #[error("SKILL.md is required at the skill root")]
    MissingManifest,
    #[error("git failed: {0}")]
    Git(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Migration(#[from] sqlx::migrate::MigrateError),
    #[error(transparent)]
    Url(#[from] url::ParseError),
    #[error(transparent)]
    Walk(#[from] walkdir::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Repository {
    pub id: String,
    pub url: String,
    pub git_ref: Option<String>,
    pub commit_hash: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Skill {
    pub id: String,
    pub slug: String,
    pub description: String,
    pub source_type: String,
    pub repository_id: Option<String>,
    pub revision: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Profile {
    pub id: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileDetail {
    pub profile: Profile,
    pub skills: Vec<Skill>,
}

#[derive(Clone)]
pub struct Skillink {
    root: PathBuf,
    pool: SqlitePool,
}

impl Skillink {
    pub async fn open(home: Option<PathBuf>) -> Result<Self> {
        let root = match home {
            Some(path) => path,
            None => default_home()?,
        };
        fs::create_dir_all(&root)?;
        for directory in ["repositories", "custom", "profiles", "staging"] {
            fs::create_dir_all(root.join(directory))?;
        }
        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite://{}",
            root.join("skillink.sqlite3").display()
        ))?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;
        sqlx::migrate!().run(&pool).await?;
        Ok(Self { root, pool })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub async fn add_repository(&self, url: &str, git_ref: Option<&str>) -> Result<Repository> {
        validate_repository_url(url)?;
        let id = Uuid::new_v4().to_string();
        let (commit, checkout) = self.clone_repository(url, git_ref).await?;
        let revision = self.repository_revision(&id, &commit);
        publish_directory(&checkout, &revision)?;
        let result = sqlx::query(
            "INSERT INTO repositories (id, url, git_ref, commit_hash) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(url)
        .bind(git_ref)
        .bind(&commit)
        .execute(&self.pool)
        .await;
        if let Err(error) = result {
            let _ = fs::remove_dir_all(self.root.join("repositories").join(&id));
            return Err(error.into());
        }
        if let Err(error) = self.discover_repository_skills(&id, &commit).await {
            let _ = sqlx::query("DELETE FROM skills WHERE repository_id = ?")
                .bind(&id)
                .execute(&self.pool)
                .await;
            let _ = sqlx::query("DELETE FROM repositories WHERE id = ?")
                .bind(&id)
                .execute(&self.pool)
                .await;
            let _ = fs::remove_dir_all(self.root.join("repositories").join(&id));
            return Err(error);
        }
        self.get_repository(&id).await
    }

    pub async fn list_repositories(&self) -> Result<Vec<Repository>> {
        Ok(sqlx::query_as::<_, Repository>(
            "SELECT id, url, git_ref, commit_hash FROM repositories ORDER BY url",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn sync_repository(&self, id: &str) -> Result<Repository> {
        let repository = self.get_repository(id).await?;
        let (commit, checkout) = self
            .clone_repository(&repository.url, repository.git_ref.as_deref())
            .await?;
        let revision = self.repository_revision(&repository.id, &commit);
        if revision.exists() {
            fs::remove_dir_all(checkout)?;
        } else {
            publish_directory(&checkout, &revision)?;
        }
        self.discover_repository_skills(&repository.id, &commit)
            .await?;
        sqlx::query(
            "UPDATE repositories SET commit_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(&commit)
        .bind(&repository.id)
        .execute(&self.pool)
        .await?;
        self.get_repository(&repository.id).await
    }

    pub async fn remove_repository(&self, id: &str) -> Result<()> {
        self.get_repository(id).await?;
        let references: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM profile_skills ps JOIN skills s ON s.id = ps.skill_id WHERE s.repository_id = ?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        if references != 0 {
            return Err(Error::Conflict(
                "repository skills are enabled in a profile".into(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM skills WHERE repository_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM repositories WHERE id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        remove_managed_directory(&self.root, "repositories", id)
    }

    pub async fn create_skill(&self, slug: &str, description: &str) -> Result<Skill> {
        validate_slug(slug)?;
        let id = Uuid::new_v4().to_string();
        let staging = self.staging_path();
        fs::create_dir(&staging)?;
        fs::write(
            staging.join("SKILL.md"),
            format!("---\nname: {slug}\ndescription: {description}\n---\n"),
        )?;
        let destination = self.root.join("custom").join(&id);
        publish_directory(&staging, &destination)?;
        if let Err(error) = self.insert_custom_skill(&id, slug, description).await {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        self.get_skill(&id).await
    }

    pub async fn import_skill(&self, source: &Path, slug: Option<&str>) -> Result<Skill> {
        if !source.join("SKILL.md").is_file() {
            return Err(Error::MissingManifest);
        }
        let metadata = parse_frontmatter(&source.join("SKILL.md"))?;
        let slug = slug
            .map(str::to_owned)
            .or(metadata.0)
            .or_else(|| {
                source
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(str::to_owned)
            })
            .ok_or_else(|| Error::InvalidSlug(source.display().to_string()))?;
        validate_slug(&slug)?;
        let description = metadata.1.unwrap_or_default();
        let id = Uuid::new_v4().to_string();
        let staging = self.staging_path();
        copy_directory_safely(source, &staging)?;
        let destination = self.root.join("custom").join(&id);
        publish_directory(&staging, &destination)?;
        if let Err(error) = self.insert_custom_skill(&id, &slug, &description).await {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        self.get_skill(&id).await
    }

    pub async fn list_skills(&self) -> Result<Vec<Skill>> {
        Ok(sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills ORDER BY slug",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn remove_skill(&self, identifier: &str) -> Result<()> {
        let skill = self.resolve_skill(identifier).await?;
        let references: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM profile_skills WHERE skill_id = ?")
                .bind(&skill.id)
                .fetch_one(&self.pool)
                .await?;
        if references != 0 {
            return Err(Error::Conflict("skill is enabled in a profile".into()));
        }
        sqlx::query("DELETE FROM skills WHERE id = ?")
            .bind(&skill.id)
            .execute(&self.pool)
            .await?;
        if skill.source_type == "custom" {
            remove_managed_directory(&self.root, "custom", &skill.id)?;
        }
        Ok(())
    }

    pub async fn create_profile(&self, slug: &str) -> Result<Profile> {
        validate_slug(slug)?;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO profiles (id, slug) VALUES (?, ?)")
            .bind(&id)
            .bind(slug)
            .execute(&self.pool)
            .await?;
        fs::create_dir_all(self.root.join("profiles").join(&id).join("generations"))?;
        self.resolve_profile(&id).await
    }

    pub async fn list_profiles(&self) -> Result<Vec<Profile>> {
        Ok(
            sqlx::query_as::<_, Profile>("SELECT id, slug FROM profiles ORDER BY slug")
                .fetch_all(&self.pool)
                .await?,
        )
    }

    pub async fn show_profile(&self, identifier: &str) -> Result<ProfileDetail> {
        let profile = self.resolve_profile(identifier).await?;
        let skills = sqlx::query_as::<_, Skill>(
            "SELECT s.id, s.slug, s.description, s.source_type, s.repository_id, s.revision, s.relative_path FROM skills s JOIN profile_skills ps ON ps.skill_id = s.id WHERE ps.profile_id = ? ORDER BY s.slug",
        )
        .bind(&profile.id)
        .fetch_all(&self.pool)
        .await?;
        Ok(ProfileDetail { profile, skills })
    }

    pub async fn enable_skill(&self, profile: &str, skill: &str) -> Result<()> {
        let profile = self.resolve_profile(profile).await?;
        let skill = self.resolve_skill(skill).await?;
        sqlx::query("INSERT OR IGNORE INTO profile_skills (profile_id, skill_id) VALUES (?, ?)")
            .bind(profile.id)
            .bind(skill.id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn disable_skill(&self, profile: &str, skill: &str) -> Result<()> {
        let profile = self.resolve_profile(profile).await?;
        let skill = self.resolve_skill(skill).await?;
        sqlx::query("DELETE FROM profile_skills WHERE profile_id = ? AND skill_id = ?")
            .bind(profile.id)
            .bind(skill.id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    #[cfg(unix)]
    pub async fn apply_profile(&self, identifier: &str) -> Result<PathBuf> {
        use std::os::unix::fs::symlink;

        let detail = self.show_profile(identifier).await?;
        let profile_root = self.root.join("profiles").join(&detail.profile.id);
        let generation_id = Uuid::new_v4().to_string();
        let generation = profile_root.join("generations").join(&generation_id);
        fs::create_dir(&generation)?;
        let canonical_root = fs::canonicalize(&self.root)?;
        for skill in detail.skills {
            let target = self.skill_path(&skill)?;
            let canonical_target = fs::canonicalize(&target)
                .map_err(|_| Error::NotFound(format!("skill content for {}", skill.slug)))?;
            if !canonical_target.starts_with(&canonical_root) {
                let _ = fs::remove_dir_all(&generation);
                return Err(Error::UnsafeEntry(target.display().to_string()));
            }
            symlink(&canonical_target, generation.join(&skill.slug))?;
        }
        let temporary = profile_root.join(format!(".current-{}", Uuid::new_v4()));
        symlink(Path::new("generations").join(&generation_id), &temporary)?;
        fs::rename(&temporary, profile_root.join("current"))?;
        Ok(generation)
    }

    #[cfg(not(unix))]
    pub async fn apply_profile(&self, _identifier: &str) -> Result<PathBuf> {
        Err(Error::Unsupported(
            "profile apply requires Unix symlinks".into(),
        ))
    }

    pub async fn doctor(&self) -> Result<Vec<String>> {
        let mut results = vec![
            format!("home: {}", self.root.display()),
            "database: ok".into(),
        ];
        let git = Command::new("git")
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await;
        match git {
            Ok(output) if output.status.success() => {
                results.push(String::from_utf8_lossy(&output.stdout).trim().to_owned())
            }
            _ => results.push("git: unavailable".into()),
        }
        Ok(results)
    }

    async fn get_repository(&self, id: &str) -> Result<Repository> {
        sqlx::query_as::<_, Repository>(
            "SELECT id, url, git_ref, commit_hash FROM repositories WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound(format!("repository {id}")))
    }

    async fn get_skill(&self, id: &str) -> Result<Skill> {
        sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound(format!("skill {id}")))
    }

    async fn resolve_skill(&self, identifier: &str) -> Result<Skill> {
        sqlx::query_as::<_, Skill>(
            "SELECT id, slug, description, source_type, repository_id, revision, relative_path FROM skills WHERE id = ? OR slug = ? COLLATE NOCASE",
        )
        .bind(identifier)
        .bind(identifier)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound(format!("skill {identifier}")))
    }

    async fn resolve_profile(&self, identifier: &str) -> Result<Profile> {
        sqlx::query_as::<_, Profile>(
            "SELECT id, slug FROM profiles WHERE id = ? OR slug = ? COLLATE NOCASE",
        )
        .bind(identifier)
        .bind(identifier)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| Error::NotFound(format!("profile {identifier}")))
    }

    async fn insert_custom_skill(&self, id: &str, slug: &str, description: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO skills (id, slug, description, source_type) VALUES (?, ?, ?, 'custom')",
        )
        .bind(id)
        .bind(slug)
        .bind(description)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn clone_repository(
        &self,
        url: &str,
        git_ref: Option<&str>,
    ) -> Result<(String, PathBuf)> {
        let checkout = self.staging_path();
        let mut command = Command::new("git");
        command
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", "")
            .env("GIT_ALLOW_PROTOCOL", "https")
            .env("GIT_LFS_SKIP_SMUDGE", "1")
            .args([
                "-c",
                "protocol.allow=never",
                "-c",
                "protocol.https.allow=always",
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "filter.lfs.smudge=",
                "-c",
                "filter.lfs.required=false",
                "clone",
                "--no-tags",
            ]);
        if let Some(git_ref) = git_ref {
            command.args(["--branch", git_ref]);
        }
        command.arg("--").arg(url).arg(&checkout);
        let output = command.output().await?;
        if !output.status.success() {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let output = Command::new("git")
            .env("GIT_TERMINAL_PROMPT", "0")
            .args(["-C"])
            .arg(&checkout)
            .args(["rev-parse", "HEAD"])
            .output()
            .await?;
        if !output.status.success() {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        let commit = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if commit.len() != 40 || !commit.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            let _ = fs::remove_dir_all(&checkout);
            return Err(Error::Git("git returned an invalid commit hash".into()));
        }
        Ok((commit, checkout))
    }

    async fn discover_repository_skills(&self, repository_id: &str, commit: &str) -> Result<()> {
        let revision = self.repository_revision(repository_id, commit);
        let mut discovered = Vec::new();
        for entry in WalkDir::new(&revision).follow_links(false) {
            let entry = entry?;
            if entry.file_type().is_file() && entry.file_name() == "SKILL.md" {
                let directory = entry
                    .path()
                    .parent()
                    .ok_or_else(|| Error::UnsafeEntry(entry.path().display().to_string()))?;
                validate_skill_directory(directory)?;
                let metadata = parse_frontmatter(entry.path())?;
                let candidate = metadata.0.or_else(|| {
                    directory
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(str::to_owned)
                });
                let Some(slug) = candidate else { continue };
                if validate_slug(&slug).is_err() {
                    continue;
                }
                let relative = directory
                    .strip_prefix(&revision)
                    .map_err(|_| Error::UnsafeEntry(directory.display().to_string()))?;
                validate_relative_path(relative)?;
                discovered.push((slug, metadata.1.unwrap_or_default(), path_to_db(relative)?));
            }
        }
        let mut transaction = self.pool.begin().await?;
        for (slug, description, relative) in discovered {
            let existing: Option<(String, Option<String>)> = sqlx::query_as(
                "SELECT id, repository_id FROM skills WHERE slug = ? COLLATE NOCASE",
            )
            .bind(&slug)
            .fetch_optional(&mut *transaction)
            .await?;
            match existing {
                Some((_, Some(owner))) if owner == repository_id => {
                    sqlx::query("UPDATE skills SET description = ?, revision = ?, relative_path = ?, updated_at = CURRENT_TIMESTAMP WHERE slug = ? COLLATE NOCASE")
                        .bind(description)
                        .bind(commit)
                        .bind(relative)
                        .bind(slug)
                        .execute(&mut *transaction)
                        .await?;
                }
                Some(_) => {
                    return Err(Error::Conflict(format!(
                        "skill slug already exists: {slug}"
                    )));
                }
                None => {
                    sqlx::query("INSERT INTO skills (id, slug, description, source_type, repository_id, revision, relative_path) VALUES (?, ?, ?, 'repository', ?, ?, ?)")
                        .bind(Uuid::new_v4().to_string())
                        .bind(slug)
                        .bind(description)
                        .bind(repository_id)
                        .bind(commit)
                        .bind(relative)
                        .execute(&mut *transaction)
                        .await?;
                }
            }
        }
        let stale_references: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM profile_skills ps JOIN skills s ON s.id = ps.skill_id WHERE s.repository_id = ? AND s.revision != ?",
        )
        .bind(repository_id)
        .bind(commit)
        .fetch_one(&mut *transaction)
        .await?;
        if stale_references != 0 {
            return Err(Error::Conflict(
                "removed repository skills are enabled in a profile; disable them before syncing"
                    .into(),
            ));
        }
        sqlx::query("DELETE FROM skills WHERE repository_id = ? AND revision != ?")
            .bind(repository_id)
            .bind(commit)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    fn repository_revision(&self, repository_id: &str, commit: &str) -> PathBuf {
        self.root
            .join("repositories")
            .join(repository_id)
            .join("revisions")
            .join(commit)
    }

    fn staging_path(&self) -> PathBuf {
        self.root.join("staging").join(Uuid::new_v4().to_string())
    }

    fn skill_path(&self, skill: &Skill) -> Result<PathBuf> {
        if skill.source_type == "custom" {
            return Ok(self.root.join("custom").join(&skill.id));
        }
        let repository_id = skill
            .repository_id
            .as_deref()
            .ok_or_else(|| Error::UnsafeEntry(skill.id.clone()))?;
        let revision = skill
            .revision
            .as_deref()
            .ok_or_else(|| Error::UnsafeEntry(skill.id.clone()))?;
        let relative = skill
            .relative_path
            .as_deref()
            .ok_or_else(|| Error::UnsafeEntry(skill.id.clone()))?;
        validate_relative_path(Path::new(relative))?;
        Ok(self
            .repository_revision(repository_id, revision)
            .join(relative))
    }
}

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

fn default_home() -> Result<PathBuf> {
    if let Some(path) = env::var_os("SKILLINK_HOME") {
        return Ok(PathBuf::from(path));
    }
    dirs::data_dir()
        .map(|path| path.join("skillink"))
        .ok_or_else(|| Error::Unsupported("unable to determine the user data directory".into()))
}

fn validate_repository_url(value: &str) -> Result<()> {
    let url = Url::parse(value).map_err(|_| Error::InvalidRepositoryUrl)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::InvalidRepositoryUrl);
    }
    Ok(())
}

fn publish_directory(source: &Path, destination: &Path) -> Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| Error::UnsafeEntry(destination.display().to_string()))?;
    fs::create_dir_all(parent)?;
    fs::rename(source, destination)?;
    Ok(())
}

fn remove_managed_directory(root: &Path, category: &str, id: &str) -> Result<()> {
    Uuid::parse_str(id).map_err(|_| Error::UnsafeEntry(id.into()))?;
    let path = root.join(category).join(id);
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    Ok(())
}

fn copy_directory_safely(source: &Path, destination: &Path) -> Result<()> {
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

fn validate_skill_directory(directory: &Path) -> Result<()> {
    for entry in WalkDir::new(directory).follow_links(false) {
        let entry = entry?;
        let file_type = entry.file_type();
        if file_type.is_symlink() || (!file_type.is_file() && !file_type.is_dir()) {
            return Err(Error::UnsafeEntry(entry.path().display().to_string()));
        }
    }
    Ok(())
}

fn validate_relative_path(path: &Path) -> Result<()> {
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(Error::UnsafeEntry(path.display().to_string()));
    }
    Ok(())
}

fn path_to_db(path: &Path) -> Result<String> {
    validate_relative_path(path)?;
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| Error::UnsafeEntry(path.display().to_string()))
}

fn parse_frontmatter(path: &Path) -> Result<(Option<String>, Option<String>)> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn validates_slugs() {
        for valid in ["a", "skill-1", "abc123"] {
            assert!(validate_slug(valid).is_ok());
        }
        for invalid in ["", "A", "-a", "a-", "a--b", "a_b"] {
            assert!(validate_slug(invalid).is_err());
        }
    }

    #[tokio::test]
    async fn creates_custom_skill_and_enforces_unique_slug() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let skill = app.create_skill("my-skill", "Useful").await.unwrap();
        assert!(
            temp.path()
                .join("custom")
                .join(&skill.id)
                .join("SKILL.md")
                .is_file()
        );
        assert!(app.create_skill("MY-SKILL", "Duplicate").await.is_err());
        assert_eq!(app.list_skills().await.unwrap().len(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn import_rejects_symlink() {
        use std::os::unix::fs::symlink;

        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("SKILL.md"), "---\nname: imported\n---\n").unwrap();
        symlink("SKILL.md", source.join("escape")).unwrap();
        let app = Skillink::open(Some(temp.path().join("home")))
            .await
            .unwrap();
        assert!(matches!(
            app.import_skill(&source, None).await,
            Err(Error::UnsafeEntry(_))
        ));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn applies_profile_with_current_links() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let skill = app.create_skill("linked", "").await.unwrap();
        let profile = app.create_profile("default").await.unwrap();
        app.enable_skill(&profile.id, &skill.id).await.unwrap();
        let generation = app.apply_profile(&profile.id).await.unwrap();
        assert!(generation.join("linked").is_dir());
        let current = temp
            .path()
            .join("profiles")
            .join(&profile.id)
            .join("current");
        assert!(current.is_symlink());
        assert_eq!(
            fs::canonicalize(current).unwrap(),
            fs::canonicalize(generation).unwrap()
        );
        assert!(matches!(
            app.remove_skill(&skill.id).await,
            Err(Error::Conflict(_))
        ));
    }

    #[tokio::test]
    async fn repository_discovery_removes_stale_skills() {
        let temp = TempDir::new().unwrap();
        let app = Skillink::open(Some(temp.path().to_owned())).await.unwrap();
        let repository_id = Uuid::new_v4().to_string();
        let first_commit = "1".repeat(40);
        let second_commit = "2".repeat(40);
        sqlx::query(
            "INSERT INTO repositories (id, url, commit_hash) VALUES (?, 'https://example.com/skills.git', ?)",
        )
        .bind(&repository_id)
        .bind(&first_commit)
        .execute(&app.pool)
        .await
        .unwrap();
        let first_revision = app.repository_revision(&repository_id, &first_commit);
        fs::create_dir_all(first_revision.join("review")).unwrap();
        fs::write(
            first_revision.join("review/SKILL.md"),
            "---\nname: review\ndescription: Review code\n---\n",
        )
        .unwrap();
        app.discover_repository_skills(&repository_id, &first_commit)
            .await
            .unwrap();
        assert_eq!(app.list_skills().await.unwrap().len(), 1);
        fs::create_dir_all(app.repository_revision(&repository_id, &second_commit)).unwrap();
        app.discover_repository_skills(&repository_id, &second_commit)
            .await
            .unwrap();
        assert!(app.list_skills().await.unwrap().is_empty());
    }
}
