use crate::repository::{discovery::DiscoveredSkill, plan::build_plan, store::ExistingSkill};

#[test]
fn same_commit_reconciles_discovery_changes() {
    let existing = vec![ExistingSkill {
        id: "stable-id".into(),
        slug: "alpha".into(),
        description: String::new(),
        relative_path: "skills/alpha".into(),
    }];
    let discovered = vec![
        DiscoveredSkill {
            slug: "alpha".into(),
            description: String::new(),
            relative_path: "skills/alpha".into(),
        },
        DiscoveredSkill {
            slug: "nested".into(),
            description: String::new(),
            relative_path: "skills/engineering/nested".into(),
        },
    ];
    let commit = "1".repeat(40);
    let plan = build_plan(
        "repository",
        Some(commit.clone()),
        commit,
        &existing,
        &discovered,
    );
    assert!(!plan.noop);
    assert_eq!(plan.add.len(), 1);
    assert!(plan.update.is_empty());
    assert!(plan.remove.is_empty());
}

#[test]
fn path_move_plan_is_remove_and_add() {
    let existing = vec![ExistingSkill {
        id: "stable-id".into(),
        slug: "alpha".into(),
        description: String::new(),
        relative_path: "skills/alpha".into(),
    }];
    let discovered = vec![DiscoveredSkill {
        slug: "alpha".into(),
        description: String::new(),
        relative_path: "skills/moved".into(),
    }];
    let plan = build_plan(
        "repository",
        Some("1".repeat(40)),
        "2".repeat(40),
        &existing,
        &discovered,
    );
    assert_eq!(plan.add.len(), 1);
    assert_eq!(plan.remove.len(), 1);
    assert!(plan.update.is_empty());
}
