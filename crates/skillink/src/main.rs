use clap::{Args, Parser, Subcommand};
use skillink::{ProfileDetail, Skillink};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "skillink", version)]
struct Cli {
    #[arg(long, global = true)]
    home: Option<PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Repo {
        #[command(subcommand)]
        command: RepoCommand,
    },
    Skill {
        #[command(subcommand)]
        command: SkillCommand,
    },
    Profile {
        #[command(subcommand)]
        command: ProfileCommand,
    },
    Doctor,
}

#[derive(Subcommand)]
enum RepoCommand {
    Add(RepoAdd),
    List,
    Sync { id: String },
    Remove { id: String },
}

#[derive(Args)]
struct RepoAdd {
    url: String,
    #[arg(long = "ref")]
    git_ref: Option<String>,
}

#[derive(Subcommand)]
enum SkillCommand {
    Create {
        slug: String,
        #[arg(long, default_value = "")]
        description: String,
    },
    Import {
        path: PathBuf,
        #[arg(long)]
        slug: Option<String>,
    },
    List,
    Remove {
        skill: String,
    },
}

#[derive(Subcommand)]
enum ProfileCommand {
    Create { slug: String },
    List,
    Show { profile: String },
    Enable { profile: String, skill: String },
    Disable { profile: String, skill: String },
    Apply { profile: String },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> skillink::Result<()> {
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
            RepoCommand::Sync { id } => {
                let repository = app.sync_repository(&id).await?;
                println!(
                    "{} {} {}",
                    repository.id, repository.commit_hash, repository.url
                );
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
                println!("{}", app.apply_profile(&profile).await?.display());
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

fn print_profile(detail: ProfileDetail) {
    println!("{} {}", detail.profile.id, detail.profile.slug);
    for skill in detail.skills {
        println!("  {} {}", skill.id, skill.slug);
    }
}
