use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid slug: {0}")]
    InvalidSlug(String),
    #[error("invalid repository URL: GitHub, HTTP(S), and SSH Git URLs are supported")]
    InvalidRepositoryUrl,
    #[error("manifest error at {path}: {message}")]
    Manifest { path: String, message: String },
    #[error("duplicate repository skill slug {slug}: {paths:?}")]
    DuplicateRepositorySlug { slug: String, paths: Vec<String> },
    #[error("repository skill conflict for slug {slug} at {relative_path}")]
    SkillConflict { slug: String, relative_path: String },
    #[error("repository skill {skill_id} is enabled in a profile")]
    RepositorySkillInUse { skill_id: String },
    #[error("concurrent repository sync detected for {repository_id}")]
    ConcurrentSync { repository_id: String },
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
