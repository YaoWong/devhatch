use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct Repository {
    pub id: String,
    pub url: String,
    pub git_ref: Option<String>,
    pub commit_hash: String,
    pub sync_version: i64,
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
