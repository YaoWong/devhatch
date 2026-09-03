use std::{collections::HashSet, path::PathBuf};

use axum::http::StatusCode;
use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum HistoryBackend {
    Codex,
    OpenCode,
    Pi,
    Trae,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PreparedLaunch {
    CodexNew {
        home: PathBuf,
        baseline: HashSet<String>,
    },
    CodexResume {
        home: PathBuf,
        id: String,
        path: PathBuf,
        cwd: PathBuf,
    },
    OpenCodeNew {
        baseline: HashSet<String>,
    },
    OpenCodeResume {
        id: String,
        cwd: String,
    },
    PiNew {
        id: String,
    },
    PiResume {
        id: String,
        path: PathBuf,
        cwd: PathBuf,
    },
    TraeNew {
        thread_name: String,
    },
    TraeResume {
        id: String,
        path: PathBuf,
        cwd: PathBuf,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum HistoryError {
    InvalidId,
    Unavailable,
    NotFound,
    Ambiguous,
    InvalidCwd,
    Active,
    ExternalActive,
}

#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Presence {
    ActiveHere,
    PossiblyActiveElsewhere,
    Inactive,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryItem {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) directory: String,
    pub(crate) project_id: Option<String>,
    pub(crate) project_name: Option<String>,
    pub(crate) project_worktree: Option<String>,
    pub(crate) time_created: i64,
    pub(crate) time_updated: i64,
    pub(crate) presence: Presence,
}

#[derive(Debug)]
pub(crate) enum DeleteError {
    History(HistoryError),
    Failed {
        status: StatusCode,
        code: &'static str,
        message: Option<String>,
    },
}
