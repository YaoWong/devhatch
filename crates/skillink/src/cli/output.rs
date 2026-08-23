use skillink::{ProfileDetail, SyncPlan};

pub(crate) fn print_sync(plan: &SyncPlan) {
    println!(
        "{} {} -> {}{}",
        plan.repository_id,
        plan.old_commit.as_deref().unwrap_or("none"),
        plan.new_commit,
        if plan.noop { " noop" } else { "" }
    );
    for (operation, items) in [
        ("add", &plan.add),
        ("update", &plan.update),
        ("remove", &plan.remove),
    ] {
        for item in items {
            println!("  {operation} {} {}", item.slug, item.relative_path);
        }
    }
}

pub(crate) fn print_profile(detail: ProfileDetail) {
    println!("{} {}", detail.profile.id, detail.profile.slug);
    for skill in detail.skills {
        println!("  {} {}", skill.id, skill.slug);
    }
}
