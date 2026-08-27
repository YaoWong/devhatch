use std::{
    path::PathBuf,
    sync::{
        Mutex, RwLock,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
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

pub(crate) struct WebAppManager {
    root: PathBuf,
    progress: RwLock<Progress>,
    update: RwLock<UpdateState>,
    child: Mutex<Option<std::process::Child>>,
    child_identity: Mutex<Option<manager::PidRecord>>,
    operation_lock: tokio::sync::Mutex<()>,
    operation: AtomicU8,
    operation_complete: tokio::sync::Notify,
    shutdown_started: tokio::sync::Notify,
    shutting_down: AtomicBool,
    install_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

const OPERATION_CONFLICT: &str = "WEB_APP_OPERATION_IN_PROGRESS";

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Operation {
    Install = 1,
    Update = 2,
    Check = 3,
    Start = 4,
    Stop = 5,
}

impl Operation {
    fn name(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Update => "update",
            Self::Check => "check",
            Self::Start => "start",
            Self::Stop => "stop",
        }
    }
}

struct OperationGuard {
    manager: std::sync::Arc<WebAppManager>,
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.manager.operation.store(0, Ordering::Release);
        self.manager.operation_complete.notify_waiters();
    }
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
