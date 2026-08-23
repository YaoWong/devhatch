use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "skillink", version)]
pub(crate) struct Cli {
    #[arg(long, global = true)]
    pub(crate) home: Option<PathBuf>,
    #[command(subcommand)]
    pub(crate) command: Command,
}

#[derive(Subcommand)]
pub(crate) enum Command {
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
pub(crate) enum RepoCommand {
    Add(RepoAdd),
    List,
    Sync {
        id: String,
        #[arg(long)]
        dry_run: bool,
    },
    Remove {
        id: String,
    },
}

#[derive(Args)]
pub(crate) struct RepoAdd {
    pub(crate) url: String,
    #[arg(long = "ref")]
    pub(crate) git_ref: Option<String>,
}

#[derive(Subcommand)]
pub(crate) enum SkillCommand {
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
pub(crate) enum ProfileCommand {
    Create { slug: String },
    List,
    Show { profile: String },
    Enable { profile: String, skill: String },
    Disable { profile: String, skill: String },
    Apply { profile: String },
}
