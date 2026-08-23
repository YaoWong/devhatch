use std::{
    path::PathBuf,
    sync::{Mutex, RwLock},
};

mod environment;
mod git;
mod handlers;
mod install;
mod manager;
mod process;

pub use handlers::{check_update, install, list, start, stop, update};

const ID: &str = "open-design";
const NAME: &str = "OpenDesign";
const VERSION: &str = "0.18.2";
const REVISION: &str = "eea8a8522dfc10951ff3e3575488c83ffcad8a33";
const MANAGED_BRANCH: &str = "devhatch";
const REPOSITORY: &str = "https://github.com/nexu-io/open-design.git";
const PORT: u16 = 17456;
const DEFAULT_PUBLIC_URL: &str = "https://work.yaowong.top:8443";

pub(crate) struct WebAppManager {
    root: PathBuf,
    progress: RwLock<Progress>,
    update: RwLock<UpdateState>,
    child: Mutex<Option<std::process::Child>>,
    operation: tokio::sync::Mutex<()>,
    install_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

#[derive(Clone)]
struct Progress {
    phase: &'static str,
    percent: u8,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    error: Option<String>,
}

#[derive(Default)]
struct UpdateState {
    checking: bool,
    available: bool,
    current_revision: Option<String>,
    remote_revision: Option<String>,
    latest_version: Option<String>,
}
