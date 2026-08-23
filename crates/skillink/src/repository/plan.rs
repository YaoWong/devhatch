use super::{discovery::DiscoveredSkill, store::ExistingSkill};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SyncItem {
    pub id: Option<String>,
    pub slug: String,
    pub relative_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SyncPlan {
    pub repository_id: String,
    pub old_commit: Option<String>,
    pub new_commit: String,
    pub noop: bool,
    pub add: Vec<SyncItem>,
    pub update: Vec<SyncItem>,
    pub remove: Vec<SyncItem>,
}

pub(super) fn build_plan(
    repository_id: &str,
    old_commit: Option<String>,
    new_commit: String,
    existing: &[ExistingSkill],
    discovered: &[DiscoveredSkill],
) -> SyncPlan {
    let same_commit = old_commit.as_deref() == Some(new_commit.as_str());
    let old: BTreeMap<&str, &ExistingSkill> = existing
        .iter()
        .map(|skill| (skill.relative_path.as_str(), skill))
        .collect();
    let new: BTreeMap<&str, &DiscoveredSkill> = discovered
        .iter()
        .map(|skill| (skill.relative_path.as_str(), skill))
        .collect();
    let add: Vec<SyncItem> = new
        .iter()
        .filter(|(path, _)| !old.contains_key(*path))
        .map(|(_, skill)| sync_item(None, &skill.slug, &skill.relative_path))
        .collect();
    let update: Vec<SyncItem> = new
        .iter()
        .filter_map(|(path, skill)| {
            old.get(path).and_then(|old| {
                let metadata_changed =
                    old.slug != skill.slug || old.description != skill.description;
                (!same_commit || metadata_changed)
                    .then(|| sync_item(Some(old.id.clone()), &skill.slug, &skill.relative_path))
            })
        })
        .collect();
    let remove: Vec<SyncItem> = old
        .iter()
        .filter(|(path, _)| !new.contains_key(*path))
        .map(|(_, skill)| sync_item(Some(skill.id.clone()), &skill.slug, &skill.relative_path))
        .collect();
    SyncPlan {
        repository_id: repository_id.to_owned(),
        old_commit,
        new_commit,
        noop: same_commit && add.is_empty() && update.is_empty() && remove.is_empty(),
        add,
        update,
        remove,
    }
}

fn sync_item(id: Option<String>, slug: &str, relative_path: &str) -> SyncItem {
    SyncItem {
        id,
        slug: slug.to_owned(),
        relative_path: relative_path.to_owned(),
    }
}
