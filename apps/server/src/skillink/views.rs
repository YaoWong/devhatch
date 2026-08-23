use serde::Serialize;
use skillink::{Profile, ProfileDetail, Repository, Skill, SyncItem, SyncPlan};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RepositoryView {
    id: String,
    name: String,
    url: String,
    git_ref: Option<String>,
    commit_hash: String,
    sync_version: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SkillView {
    id: String,
    slug: String,
    description: String,
    source_type: String,
    repository_id: Option<String>,
    revision: Option<String>,
    relative_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileView {
    id: String,
    slug: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileDetailView {
    profile: ProfileView,
    skills: Vec<SkillView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncItemView {
    id: Option<String>,
    slug: String,
    relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SyncPlanView {
    repository_id: String,
    old_commit: Option<String>,
    new_commit: String,
    noop: bool,
    add: Vec<SyncItemView>,
    update: Vec<SyncItemView>,
    remove: Vec<SyncItemView>,
}

impl From<Repository> for RepositoryView {
    fn from(value: Repository) -> Self {
        Self {
            id: value.id,
            name: value.name,
            url: value.url,
            git_ref: value.git_ref,
            commit_hash: value.commit_hash,
            sync_version: value.sync_version,
        }
    }
}

impl From<Skill> for SkillView {
    fn from(value: Skill) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
            description: value.description,
            source_type: value.source_type,
            repository_id: value.repository_id,
            revision: value.revision,
            relative_path: value.relative_path,
        }
    }
}

impl From<Profile> for ProfileView {
    fn from(value: Profile) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
        }
    }
}

impl From<ProfileDetail> for ProfileDetailView {
    fn from(value: ProfileDetail) -> Self {
        Self {
            profile: value.profile.into(),
            skills: value.skills.into_iter().map(SkillView::from).collect(),
        }
    }
}

impl From<SyncItem> for SyncItemView {
    fn from(value: SyncItem) -> Self {
        Self {
            id: value.id,
            slug: value.slug,
            relative_path: value.relative_path,
        }
    }
}

impl From<SyncPlan> for SyncPlanView {
    fn from(value: SyncPlan) -> Self {
        Self {
            repository_id: value.repository_id,
            old_commit: value.old_commit,
            new_commit: value.new_commit,
            noop: value.noop,
            add: value.add.into_iter().map(SyncItemView::from).collect(),
            update: value.update.into_iter().map(SyncItemView::from).collect(),
            remove: value.remove.into_iter().map(SyncItemView::from).collect(),
        }
    }
}
