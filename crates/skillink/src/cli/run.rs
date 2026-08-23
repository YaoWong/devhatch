use super::{
    args::{Cli, Command, ProfileCommand, RepoCommand, SkillCommand},
    output::{print_profile, print_sync},
};
use clap::Parser;
use skillink::Skillink;

pub(crate) async fn run() -> skillink::Result<()> {
    let cli = Cli::parse();
    let app = Skillink::open(cli.home).await?;
    match cli.command {
        Command::Repo { command } => match command {
            RepoCommand::Add(arguments) => {
                let repository = app
                    .add_repository(&arguments.url, arguments.git_ref.as_deref())
                    .await?;
                println!(
                    "{} {} {}",
                    repository.id, repository.commit_hash, repository.url
                );
            }
            RepoCommand::List => {
                for repository in app.list_repositories().await? {
                    println!(
                        "{} {} {}",
                        repository.id, repository.commit_hash, repository.url
                    );
                }
            }
            RepoCommand::Sync { id, dry_run } => {
                let result = if dry_run {
                    app.preview_repository_sync(&id).await?
                } else {
                    app.sync_repository(&id).await?
                };
                print_sync(&result);
            }
            RepoCommand::Remove { id } => {
                app.remove_repository(&id).await?;
                println!("removed {id}");
            }
        },
        Command::Skill { command } => match command {
            SkillCommand::Create { slug, description } => {
                let skill = app.create_skill(&slug, &description).await?;
                println!("{} {}", skill.id, skill.slug);
            }
            SkillCommand::Import { path, slug } => {
                let skill = app.import_skill(&path, slug.as_deref()).await?;
                println!("{} {}", skill.id, skill.slug);
            }
            SkillCommand::List => {
                for skill in app.list_skills().await? {
                    println!("{} {} {}", skill.id, skill.slug, skill.source_type);
                }
            }
            SkillCommand::Remove { skill } => {
                app.remove_skill(&skill).await?;
                println!("removed {skill}");
            }
        },
        Command::Profile { command } => match command {
            ProfileCommand::Create { slug } => {
                let profile = app.create_profile(&slug).await?;
                println!("{} {}", profile.id, profile.slug);
            }
            ProfileCommand::List => {
                for profile in app.list_profiles().await? {
                    println!("{} {}", profile.id, profile.slug);
                }
            }
            ProfileCommand::Show { profile } => print_profile(app.show_profile(&profile).await?),
            ProfileCommand::Enable { profile, skill } => {
                app.enable_skill(&profile, &skill).await?;
                println!("enabled {skill} in {profile}");
            }
            ProfileCommand::Disable { profile, skill } => {
                app.disable_skill(&profile, &skill).await?;
                println!("disabled {skill} in {profile}");
            }
            ProfileCommand::Apply { profile } => {
                println!("{}", app.apply_profile(&profile).await?.display())
            }
        },
        Command::Doctor => {
            for result in app.doctor().await? {
                println!("{result}");
            }
        }
    }
    Ok(())
}
