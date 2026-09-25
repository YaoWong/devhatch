use super::write_skill;
use crate::repository::links::materialize_internal_file_links;
use crate::{Error, repository::discovery::discover_repository};
use std::fs;
use tempfile::TempDir;

#[test]
fn discovers_skill_directories_across_repository() {
    let temp = TempDir::new().unwrap();
    write_skill(
        temp.path(),
        ".",
        "---\nname: root-skill\ndescription: Root\n---\n",
    );
    write_skill(temp.path(), "skills/alpha", "---\ndescription: A\n---\n");
    write_skill(
        temp.path(),
        "skills/engineering/nested",
        "---\nname: nested\ndescription: Nested\n---\n",
    );
    write_skill(temp.path(), "other", "---\nname: other\n---\n");
    write_skill(
        temp.path(),
        "packages/app/.agents/skills/review",
        "---\nname: review\n---\n",
    );
    let discovered = discover_repository(temp.path()).unwrap();
    assert_eq!(
        discovered
            .iter()
            .map(|skill| (skill.slug.as_str(), skill.relative_path.as_str()))
            .collect::<Vec<_>>(),
        [
            ("root-skill", "."),
            ("other", "other"),
            ("review", "packages/app/.agents/skills/review"),
            ("alpha", "skills/alpha"),
            ("nested", "skills/engineering/nested")
        ]
    );
}

#[cfg(unix)]
#[test]
fn discovers_hidden_skill_directories_and_ignores_unrelated_links() {
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let repository = temp.path().join("repository");
    write_skill(&repository, "skills/alpha", "---\nname: alpha\n---\n");
    write_skill(
        &repository,
        ".agents/skills/skill-creator",
        "---\nname: skill-creator\n---\n",
    );
    fs::create_dir_all(repository.join(".claude/skills")).unwrap();
    symlink(
        "../../.agents/skills/skill-creator",
        repository.join(".claude/skills/skill-creator"),
    )
    .unwrap();
    materialize_internal_file_links(&repository).unwrap();
    assert!(
        repository
            .join(".claude/skills/skill-creator")
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(
        discover_repository(&repository)
            .unwrap()
            .iter()
            .map(|skill| skill.relative_path.as_str())
            .collect::<Vec<_>>(),
        [".agents/skills/skill-creator", "skills/alpha"]
    );
}

#[cfg(unix)]
#[test]
fn materializes_only_internal_file_links() {
    use std::os::unix::fs::symlink;
    let temp = TempDir::new().unwrap();
    let repository = temp.path().join("repository");
    let outside = temp.path().join("outside.md");
    write_skill(
        &repository,
        "packages/consumer",
        "---\nname: consumer\n---\n",
    );
    fs::create_dir_all(repository.join("packages/source/references")).unwrap();
    fs::create_dir_all(repository.join("packages/consumer/references")).unwrap();
    fs::write(
        repository.join("packages/source/references/invocation.md"),
        "shared",
    )
    .unwrap();
    symlink(
        "../../source/references/invocation.md",
        repository.join("packages/consumer/references/invocation.md"),
    )
    .unwrap();
    materialize_internal_file_links(&repository).unwrap();
    let materialized = repository.join("packages/consumer/references/invocation.md");
    assert!(
        materialized
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_file()
    );
    assert_eq!(fs::read_to_string(materialized).unwrap(), "shared");
    fs::write(&outside, "private").unwrap();
    symlink(
        &outside,
        repository.join("packages/consumer/references/unsafe.md"),
    )
    .unwrap();
    assert!(
        matches!(materialize_internal_file_links(&repository), Err(Error::UnsafeEntry(path)) if path.ends_with("packages/consumer/references/unsafe.md"))
    );
}

#[test]
fn discovers_yaml_block_description() {
    let temp = TempDir::new().unwrap();
    write_skill(
        temp.path(),
        "skills/bytedance-merlin",
        "---\nname: bytedance-merlin\ndescription: |\n  Merlin 平台用于训练、部署 LLM 模型。\n\n  触发词：Merlin、训练任务、GPU。\n---\n\n# Merlin\n",
    );
    let discovered = discover_repository(temp.path()).unwrap();
    assert_eq!(discovered.len(), 1);
    assert_eq!(discovered[0].slug, "bytedance-merlin");
    assert_eq!(
        discovered[0].description,
        "Merlin 平台用于训练、部署 LLM 模型。\n\n触发词：Merlin、训练任务、GPU。"
    );
}

#[test]
fn rejects_duplicate_slug_and_invalid_manifests() {
    let temp = TempDir::new().unwrap();
    write_skill(temp.path(), "skills/a", "---\nname: duplicate\n---\n");
    write_skill(temp.path(), "skills/b", "---\nname: duplicate\n---\n");
    assert!(
        matches!(discover_repository(temp.path()), Err(Error::DuplicateRepositorySlug { slug, paths }) if slug == "duplicate" && paths == ["skills/a", "skills/b"])
    );
    fs::remove_dir_all(temp.path().join("skills/b")).unwrap();
    fs::write(
        temp.path().join("skills/a/SKILL.md"),
        "---\nname: Invalid_Name\n---\n",
    )
    .unwrap();
    assert!(matches!(
        discover_repository(temp.path()),
        Err(Error::Manifest { .. })
    ));
    fs::write(temp.path().join("skills/a/SKILL.md"), "---\nname: valid").unwrap();
    assert!(matches!(
        discover_repository(temp.path()),
        Err(Error::Manifest { .. })
    ));
}
