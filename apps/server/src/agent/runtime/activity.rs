use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::Shutdown,
    os::{
        fd::AsRawFd,
        unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    },
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::{
    io::AsyncReadExt,
    net::{UnixListener, UnixStream},
    sync::{Semaphore, broadcast, mpsc},
    task::JoinSet,
};
use uuid::Uuid;

use crate::{
    agent::{CODEX_ID, OPENCODE_ID, PI_ID, TRAECLI_ID},
    session::{AgentActivityPhase, AgentActivityStatus, Session, SessionEvent},
    state::AppState,
};

const PROTOCOL_VERSION: u8 = 1;
const MAX_DESCRIPTOR_BYTES: usize = 4096;
const MAX_HOOK_STDIN_BYTES: usize = 64 * 1024;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_DETAIL_CHARS: usize = 512;
const MAX_REPORTS: usize = 2;
const QUEUE_CAPACITY: usize = 64;
const CONNECTION_LIMIT: usize = 16;

const CODEX_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "SessionEnd",
];

const TRAE_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "Stop",
    "SessionEnd",
    "Interrupt",
    "Notification",
];

#[derive(Clone)]
pub(in crate::agent) enum IdentitySource {
    Codex {
        home: PathBuf,
    },
    OpenCode,
    Pi,
    Trae {
        homes: crate::history::trae::TraeHomes,
    },
}

pub(in crate::agent) struct ActivityBridge {
    listener: UnixListener,
    descriptor: Descriptor,
    descriptor_path: PathBuf,
    socket_path: PathBuf,
    source: IdentitySource,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    version: u8,
    socket_path: PathBuf,
    token: String,
    session_id: String,
    agent_id: String,
    instance: String,
    hook_instance: String,
    hook_sequence_path: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Envelope {
    version: u8,
    token: String,
    session_id: String,
    agent_id: String,
    instance: String,
    sequence: u64,
    reports: Vec<Report>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Report {
    Activity {
        upstream_id: String,
        status: ReportStatus,
        phase: ReportPhase,
        detail: Option<String>,
    },
    Identity {
        upstream_id: String,
        cwd: Option<PathBuf>,
        file: Option<PathBuf>,
    },
    RuntimeReady {
        port: u16,
    },
    HistoryReady,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum ReportStatus {
    Idle,
    Busy,
    Retry,
    Waiting,
    Error,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum ReportPhase {
    Idle,
    Thinking,
    Tool,
    Permission,
    Question,
    Retry,
    Error,
}

impl From<ReportStatus> for AgentActivityStatus {
    fn from(value: ReportStatus) -> Self {
        match value {
            ReportStatus::Idle => Self::Idle,
            ReportStatus::Busy => Self::Busy,
            ReportStatus::Retry => Self::Retry,
            ReportStatus::Waiting => Self::Waiting,
            ReportStatus::Error => Self::Error,
        }
    }
}

impl From<ReportPhase> for AgentActivityPhase {
    fn from(value: ReportPhase) -> Self {
        match value {
            ReportPhase::Idle => Self::Idle,
            ReportPhase::Thinking => Self::Thinking,
            ReportPhase::Tool => Self::Tool,
            ReportPhase::Permission => Self::Permission,
            ReportPhase::Question => Self::Question,
            ReportPhase::Retry => Self::Retry,
            ReportPhase::Error => Self::Error,
        }
    }
}

impl ActivityBridge {
    pub(in crate::agent) fn prepare(
        run_dir: &Path,
        session_id: &str,
        agent_id: &str,
        source: IdentitySource,
    ) -> std::io::Result<Self> {
        if Uuid::parse_str(session_id).is_err() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid session id",
            ));
        }
        let socket_path = run_dir.join("a.sock");
        let listener = UnixListener::bind(&socket_path)?;
        std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;
        let descriptor_path = run_dir.join("activity.json");
        let hook_sequence_path = run_dir.join("activity-sequence");
        write_private_file(&hook_sequence_path, b"0")?;
        let mut token = [0_u8; 32];
        getrandom::fill(&mut token).map_err(std::io::Error::other)?;
        let descriptor = Descriptor {
            version: PROTOCOL_VERSION,
            socket_path: socket_path.clone(),
            token: encode_hex(&token),
            session_id: session_id.to_string(),
            agent_id: agent_id.to_string(),
            instance: Uuid::new_v4().to_string(),
            hook_instance: Uuid::new_v4().to_string(),
            hook_sequence_path,
        };
        let bytes = serde_json::to_vec(&descriptor).map_err(std::io::Error::other)?;
        if bytes.len() > MAX_DESCRIPTOR_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "activity descriptor is too large",
            ));
        }
        write_private_file(&descriptor_path, &bytes)?;
        Ok(Self {
            listener,
            descriptor,
            descriptor_path,
            socket_path,
            source,
        })
    }

    pub(in crate::agent) fn descriptor_path(&self) -> &Path {
        &self.descriptor_path
    }

    pub(in crate::agent) fn start(self, session: &Arc<Session>, state: Arc<AppState>) {
        let mut events = session.subscribe();
        let process_id = session.process_id();
        let weak = Arc::downgrade(session);
        tokio::spawn(async move {
            let (sender, receiver) = mpsc::channel(QUEUE_CAPACITY);
            let processor = tokio::spawn(process_messages(
                receiver,
                weak,
                state,
                self.source,
                self.descriptor,
            ));
            let semaphore = Arc::new(Semaphore::new(CONNECTION_LIMIT));
            let mut readers = JoinSet::new();
            loop {
                tokio::select! {
                    event = events.recv() => {
                        if session_stopped(event) {
                            break;
                        }
                    }
                    accepted = self.listener.accept() => {
                        let Ok((stream, _)) = accepted else {
                            break;
                        };
                        if !peer_belongs_to_process(&stream, process_id) {
                            drop(stream);
                            continue;
                        }
                        let Ok(permit) = semaphore.clone().try_acquire_owned() else {
                            drop(stream);
                            continue;
                        };
                        let sender = sender.clone();
                        readers.spawn(async move {
                            let _permit = permit;
                            let mut stream = stream;
                            let Some(bytes) = read_message(&mut stream).await else {
                                return;
                            };
                            queue_message(&sender, bytes);
                        });
                    }
                    _ = readers.join_next(), if !readers.is_empty() => {}
                }
            }
            drop(sender);
            readers.abort_all();
            processor.abort();
            let _ = std::fs::remove_file(&self.socket_path);
        });
    }
}

fn queue_message(sender: &mpsc::Sender<Vec<u8>>, bytes: Vec<u8>) {
    let _ = sender.try_send(bytes);
}

fn session_stopped(event: Result<SessionEvent, broadcast::error::RecvError>) -> bool {
    matches!(
        event,
        Ok(SessionEvent::Exit(_) | SessionEvent::Removed(_) | SessionEvent::Terminate)
            | Err(broadcast::error::RecvError::Closed)
    )
}

fn peer_belongs_to_process(stream: &UnixStream, process_id: u32) -> bool {
    let Ok(credentials) = stream.peer_cred() else {
        return false;
    };
    if credentials.uid() != unsafe { libc::geteuid() } {
        return false;
    }
    credentials
        .pid()
        .and_then(|pid| u32::try_from(pid).ok())
        .is_some_and(|pid| crate::process::process_is_or_descends_from(pid, process_id))
}

async fn read_message(stream: &mut UnixStream) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        stream
            .take((MAX_MESSAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes),
    )
    .await
    .ok()?
    .ok()?;
    if result > MAX_MESSAGE_BYTES || bytes.len() > MAX_MESSAGE_BYTES {
        return None;
    }
    Some(bytes)
}

async fn process_messages(
    mut receiver: mpsc::Receiver<Vec<u8>>,
    session: std::sync::Weak<Session>,
    state: Arc<AppState>,
    source: IdentitySource,
    descriptor: Descriptor,
) {
    let mut sequences = HashMap::new();
    let mut identity_aliases = HashMap::new();
    while let Some(bytes) = receiver.recv().await {
        let Some(envelope) = validate_envelope(&bytes, &descriptor, &mut sequences) else {
            continue;
        };
        let Some(session) = session.upgrade() else {
            return;
        };
        if session.is_deleting() || !state.contains_session(&session) {
            return;
        }
        for report in envelope.reports {
            match report {
                Report::Activity {
                    upstream_id,
                    status,
                    phase,
                    detail,
                } => {
                    let accepted_id = identity_aliases.get(&upstream_id).unwrap_or(&upstream_id);
                    if session.upstream_session_id().as_deref() == Some(accepted_id) {
                        session.publish_agent_activity(status.into(), phase.into(), detail);
                    }
                }
                Report::Identity {
                    upstream_id,
                    cwd,
                    file,
                } => {
                    if identity_aliases
                        .get(&upstream_id)
                        .is_some_and(|accepted_id| {
                            session.upstream_session_id().as_deref() == Some(accepted_id)
                        })
                    {
                        continue;
                    }
                    if let Some(accepted_id) =
                        apply_identity(&session, &state, &source, upstream_id.clone(), cwd, file)
                            .await
                    {
                        identity_aliases.clear();
                        identity_aliases.insert(upstream_id, accepted_id);
                    }
                }
                Report::RuntimeReady { port } => session.update_pi_port(port),
                Report::HistoryReady => {
                    if matches!(source, IdentitySource::OpenCode) {
                        let _ = crate::history::opencode::initialize_lineage(&state).await;
                    }
                }
            }
        }
    }
}

fn validate_envelope(
    bytes: &[u8],
    descriptor: &Descriptor,
    sequences: &mut HashMap<String, u64>,
) -> Option<Envelope> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE_BYTES {
        return None;
    }
    let envelope: Envelope = serde_json::from_slice(bytes).ok()?;
    if envelope.version != PROTOCOL_VERSION
        || descriptor.version != PROTOCOL_VERSION
        || !constant_time_eq(envelope.token.as_bytes(), descriptor.token.as_bytes())
        || envelope.session_id != descriptor.session_id
        || envelope.agent_id != descriptor.agent_id
        || !matches!(
            envelope.instance.as_str(),
            instance if instance == descriptor.instance || instance == descriptor.hook_instance
        )
        || envelope.sequence == 0
        || envelope.reports.is_empty()
        || envelope.reports.len() > MAX_REPORTS
        || !envelope.reports.iter().all(valid_report)
    {
        return None;
    }
    let sequence = sequences.entry(envelope.instance.clone()).or_default();
    if envelope.sequence <= *sequence {
        return None;
    }
    *sequence = envelope.sequence;
    Some(envelope)
}

fn valid_report(report: &Report) -> bool {
    match report {
        Report::Activity {
            upstream_id,
            detail,
            ..
        } => {
            valid_short_string(upstream_id, 256)
                && detail
                    .as_deref()
                    .is_none_or(|detail| valid_detail(detail) && !detail.is_empty())
        }
        Report::Identity {
            upstream_id,
            cwd,
            file,
        } => {
            valid_short_string(upstream_id, 256)
                && cwd.as_ref().is_none_or(|path| valid_path(path))
                && file.as_ref().is_none_or(|path| valid_path(path))
        }
        Report::RuntimeReady { .. } | Report::HistoryReady => true,
    }
}

fn valid_short_string(value: &str, maximum: usize) -> bool {
    !value.is_empty() && value.len() <= maximum && !value.contains(['\0', '\r', '\n'])
}

fn valid_path(path: &Path) -> bool {
    path.is_absolute()
        && path.as_os_str().as_encoded_bytes().len() <= 4096
        && !path.as_os_str().as_encoded_bytes().contains(&0)
}

fn valid_detail(value: &str) -> bool {
    value.chars().count() <= MAX_DETAIL_CHARS && !value.chars().any(char::is_control)
}

pub(super) async fn apply_opencode_identity(
    session: &Arc<Session>,
    state: &AppState,
    upstream_id: String,
    cwd: String,
) -> bool {
    apply_identity(
        session,
        state,
        &IdentitySource::OpenCode,
        upstream_id,
        Some(PathBuf::from(cwd)),
        None,
    )
    .await
    .is_some()
}

async fn apply_identity(
    session: &Arc<Session>,
    state: &AppState,
    source: &IdentitySource,
    upstream_id: String,
    cwd: Option<PathBuf>,
    file: Option<PathBuf>,
) -> Option<String> {
    let _reconciliation = state.history_reconciliation().lock().await;
    if !claim_available(session, state, &upstream_id) {
        return None;
    }
    match source {
        IdentitySource::Codex { home } => {
            let record = crate::history::codex::lookup(home.clone(), upstream_id)
                .await
                .ok()?;
            if !claim_available(session, state, &record.id)
                || !cwd_matches_session(session, &record.cwd)
            {
                return None;
            }
            let id = record.id.clone();
            session.update_runtime_identity(record.id, Some(record.path), Some(record.cwd));
            Some(id)
        }
        IdentitySource::Trae { homes } => {
            let record =
                match crate::history::trae::lookup(homes.clone(), upstream_id.clone()).await {
                    Ok(record) => record,
                    Err(_) => crate::history::trae::lookup_thread_name(homes.clone(), upstream_id)
                        .await
                        .ok()?,
                };
            if !claim_available(session, state, &record.id)
                || !cwd_matches_session(session, &record.cwd)
            {
                return None;
            }
            let id = record.id.clone();
            session.update_runtime_identity(record.id, Some(record.path), Some(record.cwd));
            Some(id)
        }
        IdentitySource::Pi => {
            if !crate::history::pi::valid_session_id(&upstream_id) {
                return None;
            }
            let cwd = cwd.as_deref().and_then(safe_runtime_cwd)?;
            if !cwd_matches_session(session, &cwd) {
                return None;
            }
            let file = match file.as_deref() {
                Some(path) => Some(safe_runtime_file(path)?),
                None => None,
            };
            session.update_runtime_identity(upstream_id.clone(), file, Some(cwd));
            Some(upstream_id)
        }
        IdentitySource::OpenCode => {
            if !crate::history::opencode::valid_session_id(&upstream_id) {
                return None;
            }
            let _ = crate::history::opencode::initialize_lineage_locked(state).await;
            let cwd = cwd.as_deref().and_then(safe_runtime_cwd)?;
            if !cwd_matches_session(session, &cwd) || !claim_available(session, state, &upstream_id)
            {
                return None;
            }
            session.update_runtime_identity(upstream_id.clone(), None, Some(cwd));
            Some(upstream_id)
        }
    }
}

fn claim_available(session: &Arc<Session>, state: &AppState, id: &str) -> bool {
    if session.is_deleting()
        || !state.contains_session(session)
        || state.history_deletion_pending(session.agent_id().unwrap_or_default(), id)
    {
        return false;
    }
    session.upstream_session_id().as_deref() == Some(id)
        || !state
            .active_upstream_session_ids_for(session.agent_id().unwrap_or_default())
            .contains(id)
}

fn cwd_matches_session(session: &Session, cwd: &Path) -> bool {
    safe_runtime_cwd(Path::new(&session.correlation_details().0)).as_deref() == Some(cwd)
}

fn safe_runtime_cwd(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    std::fs::canonicalize(path).ok()
}

fn safe_runtime_file(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return None;
    }
    if path.exists() {
        let metadata = std::fs::symlink_metadata(path).ok()?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return None;
        }
        return std::fs::canonicalize(path).ok();
    }
    let parent = std::fs::canonicalize(path.parent()?).ok()?;
    Some(parent.join(path.file_name()?))
}

pub(crate) fn run_hook(descriptor_path: &Path, event: &str) {
    let Some(descriptor) = read_descriptor_from_path(descriptor_path) else {
        return;
    };
    let mut bytes = Vec::new();
    if std::io::stdin()
        .take((MAX_HOOK_STDIN_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .is_err()
        || bytes.len() > MAX_HOOK_STDIN_BYTES
    {
        return;
    }
    let Ok(payload) = serde_json::from_slice::<Value>(&bytes) else {
        return;
    };
    let Some(reports) = reports_for_hook(&descriptor.agent_id, event, &payload) else {
        return;
    };
    let Some((_sequence_lock, sequence)) = lock_next_hook_sequence(&descriptor.hook_sequence_path)
    else {
        return;
    };
    let envelope = Envelope {
        version: PROTOCOL_VERSION,
        token: descriptor.token,
        session_id: descriptor.session_id,
        agent_id: descriptor.agent_id,
        instance: descriptor.hook_instance,
        sequence,
        reports,
    };
    let Ok(message) = serde_json::to_vec(&envelope) else {
        return;
    };
    if message.len() > MAX_MESSAGE_BYTES {
        return;
    }
    send_hook_message(&descriptor.socket_path, &message);
}

fn send_hook_message(socket_path: &Path, message: &[u8]) {
    if let Ok(mut stream) = std::os::unix::net::UnixStream::connect(socket_path) {
        let _ = stream.set_write_timeout(Some(Duration::from_millis(100)));
        if stream.write_all(message).is_ok() {
            let _ = stream.shutdown(Shutdown::Write);
        }
    }
}

fn reports_for_hook(agent_id: &str, event: &str, payload: &Value) -> Option<Vec<Report>> {
    let allowed = match agent_id {
        CODEX_ID => CODEX_EVENTS,
        TRAECLI_ID => TRAE_EVENTS,
        _ => return None,
    };
    if !allowed.contains(&event) {
        return None;
    }
    let upstream_id = string_at(payload, &["session_id", "sessionId"])?;
    let activity = |status, phase, detail| Report::Activity {
        upstream_id: upstream_id.clone(),
        status,
        phase,
        detail,
    };
    let mut reports = match event {
        "SessionStart" => vec![
            Report::Identity {
                upstream_id: upstream_id.clone(),
                cwd: None,
                file: None,
            },
            activity(ReportStatus::Idle, ReportPhase::Idle, None),
        ],
        "UserPromptSubmit" => vec![activity(ReportStatus::Busy, ReportPhase::Thinking, None)],
        "PreToolUse" | "SubagentStart" => vec![activity(
            ReportStatus::Busy,
            ReportPhase::Tool,
            detail_from(
                payload,
                &[
                    "tool_name",
                    "toolName",
                    "tool",
                    "name",
                    "agent_type",
                    "agentType",
                ],
            )
            .map(|detail| format!("Running {detail}")),
        )],
        "PermissionRequest" => vec![activity(
            ReportStatus::Waiting,
            ReportPhase::Permission,
            Some("Waiting for permission".to_string()),
        )],
        "PostToolUse" | "PostCompact" | "SubagentStop" => {
            vec![activity(ReportStatus::Busy, ReportPhase::Thinking, None)]
        }
        "PreCompact" => vec![activity(
            ReportStatus::Busy,
            ReportPhase::Thinking,
            Some("Compacting context".to_string()),
        )],
        "Stop" | "SessionEnd" | "Interrupt" => {
            vec![activity(ReportStatus::Idle, ReportPhase::Idle, None)]
        }
        "PostToolUseFailure" if agent_id == TRAECLI_ID => vec![activity(
            ReportStatus::Error,
            ReportPhase::Error,
            error_detail(payload),
        )],
        "Notification" if agent_id == TRAECLI_ID => {
            match string_at(payload, &["notification_type", "notificationType"])?.as_str() {
                "permission_prompt" => vec![activity(
                    ReportStatus::Waiting,
                    ReportPhase::Permission,
                    Some("Waiting for permission".to_string()),
                )],
                "idle_prompt" => vec![activity(
                    ReportStatus::Waiting,
                    ReportPhase::Question,
                    Some("Waiting for answer".to_string()),
                )],
                _ => return None,
            }
        }
        _ => return None,
    };
    let cwd = string_at(payload, &["cwd"]).map(PathBuf::from);
    let file = string_at(payload, &["transcript_path", "transcriptPath"]).map(PathBuf::from);
    if let Some(Report::Identity {
        cwd: identity_cwd,
        file: identity_file,
        ..
    }) = reports.first_mut()
    {
        *identity_cwd = cwd;
        *identity_file = file;
    } else {
        reports.insert(
            0,
            Report::Identity {
                upstream_id,
                cwd,
                file,
            },
        );
    }
    Some(reports)
}

fn string_at(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .and_then(|value| sanitize_string(value, 256))
}

fn detail_from(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(key).and_then(Value::as_str))
        .and_then(|value| sanitize_string(value, MAX_DETAIL_CHARS.saturating_sub(8)))
}

fn error_detail(value: &Value) -> Option<String> {
    detail_from(
        value,
        &["error_message", "errorMessage", "message", "error"],
    )
    .or_else(|| {
        value
            .get("error")
            .and_then(|error| detail_from(error, &["message", "name"]))
    })
}

fn sanitize_string(value: &str, maximum: usize) -> Option<String> {
    let value = value
        .chars()
        .filter(|character| !character.is_control())
        .take(maximum)
        .collect::<String>();
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn read_descriptor_from_path(path: &Path) -> Option<Descriptor> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
        || metadata.len() > MAX_DESCRIPTOR_BYTES as u64
    {
        return None;
    }
    let mut bytes = Vec::new();
    file.take((MAX_DESCRIPTOR_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_DESCRIPTOR_BYTES {
        return None;
    }
    let descriptor: Descriptor = serde_json::from_slice(&bytes).ok()?;
    (descriptor.version == PROTOCOL_VERSION
        && canonical_uuid(&descriptor.session_id)
        && canonical_uuid(&descriptor.instance)
        && canonical_uuid(&descriptor.hook_instance)
        && descriptor.token.len() == 64
        && descriptor
            .token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        && descriptor.socket_path.is_absolute()
        && descriptor.hook_sequence_path.is_absolute()
        && matches!(
            descriptor.agent_id.as_str(),
            CODEX_ID | OPENCODE_ID | PI_ID | TRAECLI_ID
        ))
    .then_some(descriptor)
}

fn lock_next_hook_sequence(path: &Path) -> Option<(File, u64)> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut file = options.open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
        || metadata.len() > 32
    {
        return None;
    }
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return None;
    }
    let sequence = read_sequence(&mut file)?.checked_add(1)?;
    file.set_len(0).ok()?;
    file.seek(SeekFrom::Start(0)).ok()?;
    write!(file, "{sequence}").ok()?;
    file.sync_data().ok()?;
    Some((file, sequence))
}

#[cfg(test)]
fn next_hook_sequence(path: &Path) -> Option<u64> {
    lock_next_hook_sequence(path).map(|(_, sequence)| sequence)
}

fn read_sequence(file: &mut File) -> Option<u64> {
    let mut value = String::new();
    file.take(33).read_to_string(&mut value).ok()?;
    value.parse().ok()
}

fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

fn canonical_uuid(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|uuid| uuid.hyphenated().to_string() == value)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub(in crate::agent) fn supports_hooks(agent_id: &str, version: &str) -> bool {
    match agent_id {
        CODEX_ID => super::super::launch::version_at_least(version, [0, 149, 1]),
        TRAECLI_ID => super::super::launch::version_at_least(version, [0, 207, 1]),
        _ => false,
    }
}

pub(in crate::agent) fn hook_override(
    agent_id: &str,
    server: &Path,
    descriptor: &Path,
) -> Option<String> {
    let events = match agent_id {
        CODEX_ID => CODEX_EVENTS,
        TRAECLI_ID => TRAE_EVENTS,
        _ => return None,
    };
    let server = server.to_str()?;
    let descriptor = descriptor.to_str()?;
    let mut event_entries = Vec::new();
    let mut state_entries = Vec::new();
    for event in events {
        let handler = HookHandler {
            r#async: true,
            command: format!(
                "{} --agent-hook {} {}",
                shell_quote(server),
                shell_quote(descriptor),
                shell_quote(event)
            ),
            timeout: 1,
            kind: "command",
        };
        let handler_toml = format!(
            "{{async={},command={},timeout=1,type=\"command\"}}",
            handler.r#async,
            toml_string(&handler.command)
        );
        event_entries.push(format!("{event}=[{{hooks=[{handler_toml}]}}]"));
        let snake = snake_event(event);
        let key = format!("/<session-flags>/config.toml:{snake}:0:0");
        state_entries.push(format!(
            "{}={{trusted_hash={}}}",
            toml_string(&key),
            toml_string(&trust_hash(snake, &handler))
        ));
    }
    event_entries.push(format!("state={{{}}}", state_entries.join(",")));
    Some(format!("hooks={{{}}}", event_entries.join(",")))
}

#[derive(Serialize)]
struct HookHandler<'a> {
    r#async: bool,
    command: String,
    timeout: u64,
    #[serde(rename = "type")]
    kind: &'a str,
}

fn trust_hash(event_name: &str, handler: &HookHandler<'_>) -> String {
    let value = serde_json::json!({
        "event_name": event_name,
        "hooks": [handler],
    });
    let canonical = canonical_json(value);
    let bytes = serde_json::to_vec(&canonical).expect("canonical hook JSON must serialize");
    format!("sha256:{}", encode_hex(&Sha256::digest(bytes)))
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(canonical_json).collect()),
        Value::Object(values) => {
            let mut entries = values.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key, canonical_json(value)))
                    .collect(),
            )
        }
        value => value,
    }
}

fn snake_event(event: &str) -> &'static str {
    match event {
        "SessionStart" => "session_start",
        "UserPromptSubmit" => "user_prompt_submit",
        "PreToolUse" => "pre_tool_use",
        "PermissionRequest" => "permission_request",
        "PostToolUse" => "post_tool_use",
        "PostToolUseFailure" => "post_tool_use_failure",
        "PreCompact" => "pre_compact",
        "PostCompact" => "post_compact",
        "SubagentStart" => "subagent_start",
        "SubagentStop" => "subagent_stop",
        "Stop" => "stop",
        "SessionEnd" => "session_end",
        "Interrupt" => "interrupt",
        "Notification" => "notification",
        _ => "unknown",
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn toml_string(value: &str) -> String {
    serde_json::to_string(value).expect("TOML string must serialize")
}

pub(crate) fn append_opencode_plugin(
    file_url: &str,
    config_key: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let content = std::env::var("OPENCODE_CONFIG_CONTENT").unwrap_or_default();
    append_opencode_plugin_content(&content, file_url, config_key)
}

fn append_opencode_plugin_content(
    content: &str,
    file_url: &str,
    config_key: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    if !matches!(config_key, "plugin" | "plugins") {
        return Err("invalid OpenCode plugin config key".into());
    }
    let url = url::Url::parse(file_url)?;
    if url.scheme() != "file" {
        return Err("plugin URL must use the file scheme".into());
    }
    let content = if content.trim().is_empty() {
        "{}"
    } else {
        content
    };
    let mut value: Value = json5::from_str(content)?;
    let object = value
        .as_object_mut()
        .ok_or("OpenCode config content must be an object")?;
    let plugins = object
        .entry(config_key)
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or("OpenCode plugin config must be an array")?;
    if !plugins.iter().any(|plugin| {
        plugin.as_str() == Some(file_url)
            || plugin
                .as_array()
                .and_then(|entry| entry.first())
                .and_then(Value::as_str)
                == Some(file_url)
    }) {
        plugins.push(Value::String(file_url.to_string()));
    }
    Ok(serde_json::to_string(&value)?)
}

pub(in crate::agent) fn remove_opencode_plugin(
    content: &str,
    file_url: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    if content.trim().is_empty() {
        return Ok(String::new());
    }
    let mut value: Value = json5::from_str(content)?;
    let object = value
        .as_object_mut()
        .ok_or("OpenCode config content must be an object")?;
    for key in ["plugin", "plugins"] {
        let Some(plugins) = object.get_mut(key) else {
            continue;
        };
        let plugins = plugins
            .as_array_mut()
            .ok_or("OpenCode plugin config must be an array")?;
        plugins.retain(|plugin| {
            plugin.as_str() != Some(file_url)
                && plugin
                    .as_array()
                    .and_then(|entry| entry.first())
                    .and_then(Value::as_str)
                    != Some(file_url)
        });
    }
    Ok(serde_json::to_string(&value)?)
}

pub(in crate::agent) fn write_opencode_plugin(
    run_dir: &Path,
    v2: bool,
) -> std::io::Result<PathBuf> {
    if v2 {
        let directory = run_dir.join("devhatch-opencode-plugin");
        std::fs::create_dir(&directory)?;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
        let source = format!("{OPENCODE_PLUGIN}{OPENCODE_PLUGIN_V2_ENTRYPOINT}");
        write_private_file(&directory.join("server.mjs"), source.as_bytes())?;
        return Ok(directory);
    }
    let path = run_dir.join("devhatch-opencode-plugin.mjs");
    let source = format!("{OPENCODE_PLUGIN}{OPENCODE_PLUGIN_V1_ENTRYPOINT}");
    write_private_file(&path, source.as_bytes())?;
    Ok(path)
}

pub(in crate::agent) const JS_REPORTER: &str = r#"
let devhatchBridge
let devhatchSequence = Date.now() * 1000
const devhatchQueue = []
let devhatchSending = false
try {
  devhatchBridge = JSON.parse(readFileSync(process.env.DEVHATCH_ACTIVITY_DESCRIPTOR, "utf8"))
} catch {}
function devhatchText(value, limit = 512) {
  if (typeof value !== "string") return undefined
  const text = Array.from(value).filter((character) => character >= " " && character !== "\u007f").slice(0, limit).join("").trim()
  return text || undefined
}
function devhatchReport(reports) {
  if (!devhatchBridge || !Array.isArray(reports) || reports.length === 0) return
  const message = JSON.stringify({
    version: 1,
    token: devhatchBridge.token,
    sessionId: devhatchBridge.sessionId,
    agentId: devhatchBridge.agentId,
    instance: devhatchBridge.instance,
    sequence: ++devhatchSequence,
    reports,
  })
  if (Buffer.byteLength(message) > 16 * 1024) return
  if (devhatchQueue.length >= 64) devhatchQueue[63] = message
  else devhatchQueue.push(message)
  devhatchFlush()
}
function devhatchFlush() {
  if (devhatchSending) return
  const message = devhatchQueue.shift()
  if (!message) return
  devhatchSending = true
  let completed = false
  const complete = () => {
    if (completed) return
    completed = true
    devhatchSending = false
    devhatchFlush()
  }
  try {
    const socket = createConnection(devhatchBridge.socketPath)
    socket.unref()
    socket.setTimeout(2000, () => socket.destroy())
    socket.once("connect", () => socket.end(message))
    socket.once("error", complete)
    socket.once("close", complete)
  } catch {
    complete()
  }
}
"#;

const OPENCODE_PLUGIN: &str = r#"import { readFileSync } from "node:fs"
import { createConnection } from "node:net"

let devhatchBridge
let devhatchSequence = Date.now() * 1000
const devhatchQueue = []
let devhatchSending = false
try {
  devhatchBridge = JSON.parse(readFileSync(process.env.DEVHATCH_ACTIVITY_DESCRIPTOR, "utf8"))
} catch {}
function text(value, limit = 512) {
  if (typeof value !== "string") return undefined
  const result = Array.from(value).filter((character) => character >= " " && character !== "\u007f").slice(0, limit).join("").trim()
  return result || undefined
}
function report(reports) {
  if (!devhatchBridge || !Array.isArray(reports) || reports.length === 0) return
  const message = JSON.stringify({ version: 1, token: devhatchBridge.token, sessionId: devhatchBridge.sessionId, agentId: devhatchBridge.agentId, instance: devhatchBridge.instance, sequence: ++devhatchSequence, reports })
  if (Buffer.byteLength(message) > 16 * 1024) return
  if (devhatchQueue.length >= 64) devhatchQueue[63] = message
  else devhatchQueue.push(message)
  devhatchFlush()
}
function devhatchFlush() {
  if (devhatchSending) return
  const message = devhatchQueue.shift()
  if (!message) return
  devhatchSending = true
  let completed = false
  const complete = () => {
    if (completed) return
    completed = true
    devhatchSending = false
    devhatchFlush()
  }
  try {
    const socket = createConnection(devhatchBridge.socketPath)
    socket.unref()
    socket.setTimeout(2000, () => socket.destroy())
    socket.once("connect", () => socket.end(message))
    socket.once("error", complete)
    socket.once("close", complete)
  } catch {
    complete()
  }
}
function sessionID(properties) {
  return properties?.sessionID ?? properties?.sessionId ?? properties?.info?.id ?? properties?.info?.sessionID ?? properties?.info?.sessionId ?? properties?.part?.sessionID ?? properties?.part?.sessionId ?? properties?.form?.sessionID ?? properties?.form?.sessionId
}
function detail(properties, keys) {
  for (const key of keys) {
    const value = text(properties?.[key])
    if (value) return value
  }
  return undefined
}
function errorDetail(value) {
  const error = value?.error ?? value
  return text(error?.message) ?? text(error?.data?.message) ?? text(error?.name)
}
function activity(upstreamId, status, phase, detailValue) {
  return { kind: "activity", upstreamId, status, phase, ...(detailValue ? { detail: text(detailValue) } : {}) }
}
function identity(upstreamId, cwd) {
  return [
    { kind: "identity", upstreamId, cwd },
    activity(upstreamId, "idle", "idle"),
  ]
}
let currentSessionId
let currentDirectory
function handleEvent(event, directory) {
  try {
    const value = event?.payload ?? event
    const type = value?.type
    const properties = value?.data ?? value?.properties ?? {}
    const eventDirectory = text(value?.location?.directory ?? properties?.location?.directory ?? properties?.info?.directory ?? directory ?? currentDirectory, 4096)
    if (eventDirectory) currentDirectory = eventDirectory
    if (type === "session.created") {
      const info = properties.info ?? properties
      if (info.parentID != null) return
      const id = text(sessionID(properties), 256)
      const cwd = text(info.directory ?? info.location?.directory ?? eventDirectory, 4096)
      if (id && cwd) {
        currentSessionId = id
        report(identity(id, cwd))
      }
      return
    }
    if (type === "session.forked") {
      const id = text(sessionID(properties), 256)
      const cwd = eventDirectory
      if (id && cwd) {
        currentSessionId = id
        report(identity(id, cwd))
      }
      return
    }
    if (type === "tui.session.select") {
      const id = text(sessionID(properties), 256)
      const cwd = eventDirectory
      if (id && cwd) {
        currentSessionId = id
        report(identity(id, cwd))
      }
      return
    }
    const id = text(sessionID(properties), 256) ?? (["session.error", "session.execution.failed"].includes(type) ? currentSessionId : undefined)
    if (!id || id !== currentSessionId) return
    let update
    if (type === "session.status") {
      if (properties.status?.type === "busy") update = activity(id, "busy", "thinking")
      if (properties.status?.type === "idle") update = activity(id, "idle", "idle")
      if (properties.status?.type === "retry") update = activity(id, "retry", "retry", properties.status?.message)
    } else if (["session.idle", "session.execution.succeeded", "session.execution.interrupted"].includes(type)) update = activity(id, "idle", "idle")
    else if (type === "permission.asked" || type === "permission.v2.asked") update = activity(id, "waiting", "permission", "Waiting for permission")
    else if (["question.asked", "question.v2.asked", "form.created"].includes(type)) update = activity(id, "waiting", "question", properties.form?.title ?? "Waiting for answer")
    else if (["permission.replied", "permission.v2.replied", "question.replied", "question.v2.replied", "question.rejected", "question.v2.rejected", "form.replied", "form.cancelled"].includes(type)) update = activity(id, "busy", "thinking")
    else if (["session.error", "session.next.step.failed", "session.execution.failed", "session.step.failed", "session.compaction.failed"].includes(type)) update = activity(id, "error", "error", errorDetail(properties))
    else if (["session.next.retried", "session.retry.scheduled"].includes(type)) update = activity(id, "retry", "retry", errorDetail(properties.error ?? properties))
    else if (["session.next.tool.input.started", "session.next.tool.called", "session.tool.input.started", "session.tool.called"].includes(type)) update = activity(id, "busy", "tool", `Running ${detail(properties, ["tool", "name"]) ?? "tool"}`)
    else if (["session.next.shell.started", "session.shell.started"].includes(type)) update = activity(id, "busy", "tool", "Running shell")
    else if (["session.next.tool.success", "session.next.shell.ended", "session.tool.success", "session.shell.ended"].includes(type)) update = activity(id, "busy", "thinking")
    else if (["session.next.tool.failed", "session.tool.failed"].includes(type)) update = activity(id, "error", "error", errorDetail(properties.error ?? properties))
    else if (["session.next.compaction.started", "session.compaction.started"].includes(type)) update = activity(id, "busy", "thinking", "Compacting context")
    else if (["session.next.compaction.ended", "session.compacted", "session.compaction.ended"].includes(type)) update = activity(id, "busy", "thinking")
    else if (["session.next.prompted", "session.next.step.started", "session.next.step.ended", "session.next.text.started", "session.next.text.ended", "session.next.reasoning.started", "session.next.reasoning.ended", "session.execution.started", "session.step.started", "session.step.ended", "session.text.started", "session.text.ended", "session.reasoning.started", "session.reasoning.ended"].includes(type)) update = activity(id, "busy", "thinking")
    else if (type === "message.part.updated") {
      const part = properties.part
      if (part?.type === "tool") {
        const status = part.state?.status
        if (status === "pending" || status === "running") update = activity(id, "busy", "tool", `Running ${detail(part, ["title", "tool", "name", "description"]) ?? "tool"}`)
        else if (status === "completed") update = activity(id, "busy", "thinking")
        else if (status === "error") update = activity(id, "error", "error", text(part.state?.error))
      } else if (part?.type === "retry") update = activity(id, "retry", "retry", errorDetail(part))
      else if (part?.type === "compaction") update = activity(id, "busy", "thinking", "Compacting context")
    }
    if (update) report(eventDirectory ? [{ kind: "identity", upstreamId: id, cwd: eventDirectory }, update] : [update])
  } catch {}
}
"#;

const OPENCODE_PLUGIN_V1_ENTRYPOINT: &str = r#"
export default async function ({ directory }) {
  return {
    event: async ({ event }) => handleEvent(event, directory),
  }
}
"#;

const OPENCODE_PLUGIN_V2_ENTRYPOINT: &str = r#"
export default {
  id: "devhatch.activity",
  async setup(context) {
    currentDirectory = text(context?.location?.directory, 4096) ?? currentDirectory
    try {
      await context.session.hook("prompt", (event) => {
        try {
          const id = text(event?.sessionID, 256)
          const cwd = text(context?.location?.directory ?? currentDirectory, 4096)
          if (id && cwd) {
            currentSessionId = id
            currentDirectory = cwd
            report(identity(id, cwd))
          }
        } catch {}
      })
    } catch {}
    report([{ kind: "history-ready" }])
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of context.event.subscribe({ signal: controller.signal })) {
          handleEvent(event, context?.location?.directory)
        }
      } catch {}
    })()
    return () => controller.abort()
  },
}
"#;

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor() -> Descriptor {
        Descriptor {
            version: 1,
            socket_path: PathBuf::from("/tmp/activity.sock"),
            token: "ab".repeat(32),
            session_id: Uuid::nil().to_string(),
            agent_id: CODEX_ID.to_string(),
            instance: Uuid::new_v4().to_string(),
            hook_instance: Uuid::new_v4().to_string(),
            hook_sequence_path: PathBuf::from("/tmp/activity-sequence"),
        }
    }

    fn envelope(descriptor: &Descriptor, sequence: u64, detail: Option<String>) -> Vec<u8> {
        serde_json::to_vec(&Envelope {
            version: 1,
            token: descriptor.token.clone(),
            session_id: descriptor.session_id.clone(),
            agent_id: descriptor.agent_id.clone(),
            instance: descriptor.instance.clone(),
            sequence,
            reports: vec![Report::Activity {
                upstream_id: Uuid::new_v4().to_string(),
                status: ReportStatus::Busy,
                phase: ReportPhase::Thinking,
                detail,
            }],
        })
        .unwrap()
    }

    #[test]
    fn validates_authentication_size_detail_and_sequence() {
        let expected = descriptor();
        let encoded = envelope(&expected, 1, None);
        let encoded_text = String::from_utf8(encoded.clone()).unwrap();
        assert!(encoded_text.contains("\"upstreamId\""));
        assert!(!encoded_text.contains("\"upstream_id\""));
        let mut sequences = HashMap::new();
        assert!(validate_envelope(&encoded, &expected, &mut sequences).is_some());
        assert!(
            validate_envelope(&envelope(&expected, 1, None), &expected, &mut sequences).is_none()
        );
        assert!(
            validate_envelope(&envelope(&expected, 0, None), &expected, &mut sequences).is_none()
        );
        assert!(
            validate_envelope(
                &envelope(&expected, 2, Some("x".repeat(513))),
                &expected,
                &mut sequences
            )
            .is_none()
        );
        assert!(
            validate_envelope(
                &vec![b'x'; MAX_MESSAGE_BYTES + 1],
                &expected,
                &mut sequences
            )
            .is_none()
        );
        let mut ordered = HashMap::new();
        assert!(
            validate_envelope(&envelope(&expected, 1, None), &expected, &mut ordered).is_some()
        );
        assert!(
            validate_envelope(&envelope(&expected, 1, None), &expected, &mut ordered).is_none()
        );
        assert!(
            validate_envelope(&envelope(&expected, 2, None), &expected, &mut ordered).is_some()
        );
        assert!(
            validate_envelope(&envelope(&expected, 1, None), &expected, &mut ordered).is_none()
        );
        let mut wrong = descriptor();
        wrong.token = "cd".repeat(32);
        assert!(validate_envelope(&envelope(&wrong, 2, None), &expected, &mut sequences).is_none());
    }

    #[tokio::test]
    async fn creates_private_descriptor_socket_and_sequence() {
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let bridge = ActivityBridge::prepare(
            root.path(),
            &Uuid::new_v4().to_string(),
            CODEX_ID,
            IdentitySource::Codex {
                home: root.path().to_path_buf(),
            },
        )
        .unwrap();
        assert_eq!(
            std::fs::metadata(bridge.descriptor_path())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(&bridge.socket_path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        let descriptor = read_descriptor_from_path(bridge.descriptor_path()).unwrap();
        assert_eq!(next_hook_sequence(&descriptor.hook_sequence_path), Some(1));
        assert_eq!(next_hook_sequence(&descriptor.hook_sequence_path), Some(2));
    }

    #[tokio::test]
    async fn full_telemetry_queue_drops_without_waiting_for_a_consumer() {
        let (sender, mut receiver) = mpsc::channel(1);
        queue_message(&sender, vec![1]);
        queue_message(&sender, vec![2]);
        assert_eq!(receiver.recv().await, Some(vec![1]));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn hook_sender_does_not_wait_for_a_server_acknowledgement() {
        let root = tempfile::tempdir().unwrap();
        let socket_path = root.path().join("hook.sock");
        let listener = std::os::unix::net::UnixListener::bind(&socket_path).unwrap();
        let (received, received_waiter) = std::sync::mpsc::channel();
        let (release, release_waiter) = std::sync::mpsc::channel();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes).unwrap();
            received.send(bytes).unwrap();
            release_waiter.recv().unwrap();
        });

        let (completed, completed_waiter) = std::sync::mpsc::channel();
        let sender = std::thread::spawn(move || {
            send_hook_message(&socket_path, b"telemetry");
            completed.send(()).unwrap();
        });
        let bytes = received_waiter
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        let completed_without_ack = completed_waiter
            .recv_timeout(Duration::from_secs(1))
            .is_ok();
        release.send(()).unwrap();
        sender.join().unwrap();
        server.join().unwrap();
        assert_eq!(bytes, b"telemetry");
        assert!(completed_without_ack);
    }

    #[test]
    fn maps_codex_and_trae_hooks() {
        let id = Uuid::new_v4().to_string();
        let start = reports_for_hook(
            CODEX_ID,
            "SessionStart",
            &serde_json::json!({"session_id": id}),
        )
        .unwrap();
        assert!(matches!(
            start.as_slice(),
            [
                Report::Identity { .. },
                Report::Activity {
                    status: ReportStatus::Idle,
                    ..
                }
            ]
        ));
        let tool = reports_for_hook(
            CODEX_ID,
            "PreToolUse",
            &serde_json::json!({"session_id": id, "tool_name": "bash"}),
        )
        .unwrap();
        assert!(
            matches!(tool.as_slice(), [Report::Identity { .. }, Report::Activity { phase: ReportPhase::Tool, detail: Some(detail), .. }] if detail == "Running bash")
        );
        assert!(
            reports_for_hook(
                CODEX_ID,
                "PostToolUseFailure",
                &serde_json::json!({"session_id": id})
            )
            .is_none()
        );
        let notification = reports_for_hook(
            TRAECLI_ID,
            "Notification",
            &serde_json::json!({"session_id": id, "notification_type": "idle_prompt"}),
        )
        .unwrap();
        assert!(matches!(
            notification.as_slice(),
            [
                Report::Identity { .. },
                Report::Activity {
                    phase: ReportPhase::Question,
                    ..
                }
            ]
        ));
    }

    #[test]
    fn builds_ordered_escaped_hook_override_and_stable_hash() {
        let override_value = hook_override(
            CODEX_ID,
            Path::new("/opt/dev'hatch"),
            Path::new("/tmp/run/activity.json"),
        )
        .unwrap();
        assert!(override_value.starts_with("hooks={SessionStart="));
        assert!(override_value.contains("PermissionRequest"));
        assert!(override_value.contains("async=true"));
        assert!(override_value.contains("dev'\\\"'\\\"'hatch"));
        let handler = HookHandler {
            r#async: true,
            command: "'/opt/devhatch' --agent-hook '/tmp/activity.json' 'SessionStart'".to_string(),
            timeout: 1,
            kind: "command",
        };
        assert_eq!(
            trust_hash("session_start", &handler),
            "sha256:d5c769bc3af31243e5706580523c277fbddb31e54fce83d3abcd0e4e3c7b4f0f"
        );
    }

    #[test]
    fn hook_versions_are_gated() {
        assert!(!supports_hooks(CODEX_ID, "0.149.0"));
        assert!(supports_hooks(CODEX_ID, "0.149.1"));
        assert!(!supports_hooks(TRAECLI_ID, "0.207.0"));
        assert!(supports_hooks(TRAECLI_ID, "0.207.1(internal edition)"));
    }

    #[test]
    fn removes_only_the_inherited_devhatch_opencode_plugin() {
        let inherited = "file:///tmp/old-devhatch-plugin.mjs";
        let content = format!(
            "{{plugin: ['npm:user-plugin', ['{inherited}', {{enabled: true}}]], plugins: ['file:///tmp/user-plugin.mjs', '{inherited}']}}"
        );
        let sanitized = remove_opencode_plugin(&content, inherited).unwrap();
        let value: Value = serde_json::from_str(&sanitized).unwrap();
        assert_eq!(value["plugin"], serde_json::json!(["npm:user-plugin"]));
        assert_eq!(
            value["plugins"],
            serde_json::json!(["file:///tmp/user-plugin.mjs"])
        );
    }

    #[test]
    fn appends_opencode_plugin_without_discarding_existing_entries() {
        let url = "file:///tmp/devhatch-plugin.mjs";
        let appended = append_opencode_plugin_content("", url, "plugins").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&appended).unwrap()["plugins"][0],
            url
        );
        let preserved = append_opencode_plugin_content(
            "{ plugin: [['file:///tmp/devhatch-plugin.mjs', { enabled: true }], 'npm:test'] }",
            url,
            "plugin",
        )
        .unwrap();
        let value = serde_json::from_str::<Value>(&preserved).unwrap();
        assert_eq!(value["plugin"].as_array().unwrap().len(), 2);
        assert_eq!(value["plugin"][0][0], url);
        assert!(
            append_opencode_plugin_content("{}", "https://example.com/plugin", "plugins").is_err()
        );
        assert!(append_opencode_plugin_content("{}", url, "unknown").is_err());
    }

    #[test]
    fn generated_opencode_plugin_is_private_and_event_driven() {
        let root = tempfile::tempdir().unwrap();
        let path = write_opencode_plugin(root.path(), false).unwrap();
        let source = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(source.contains("export default async function"));
        assert!(source.contains("value?.data ?? value?.properties"));
        assert!(source.contains("session.execution.started"));
        assert!(source.contains("form.created"));
        assert!(source.contains("session.created"));
        assert!(source.contains("session.forked"));
        assert!(source.contains("tui.session.select"));
        assert!(source.contains("properties?.info?.sessionID"));
        assert!(source.contains("properties?.part?.sessionID"));
        assert!(source.contains("session.execution.failed\"].includes(type) ? currentSessionId"));
        assert!(source.contains("id !== currentSessionId"));
        assert!(source.contains("report(eventDirectory ? [{ kind: \"identity\""));
        assert!(source.contains("session.next.retried"));
        assert!(source.contains("createConnection"));
        assert!(source.contains("devhatchQueue.length >= 64"));
        assert!(source.contains("socket.unref()"));
        assert!(!source.contains("console."));
        assert!(!source.contains("setInterval"));
    }

    #[test]
    fn generated_opencode_v2_plugin_uses_setup_and_event_subscription() {
        let root = tempfile::tempdir().unwrap();
        let directory = write_opencode_plugin(root.path(), true).unwrap();
        assert!(directory.is_dir());
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let path = directory.join("server.mjs");
        let source = std::fs::read_to_string(path).unwrap();
        assert!(source.contains("export default {"));
        assert!(source.contains("id: \"devhatch.activity\""));
        assert!(source.contains("setup(context)"));
        assert!(source.contains("await context.session.hook(\"prompt\""));
        assert!(source.contains("const id = text(event?.sessionID"));
        assert!(!source.contains("event.prompt ="));
        assert!(source.contains("context.event.subscribe"));
        assert!(source.contains("history-ready"));
        assert!(source.contains("controller.abort()"));
        assert!(!source.contains("export default async function"));
        assert!(!source.contains("setInterval"));
    }

    #[test]
    fn canonical_hook_vector_matches_installed_format() {
        let handler = HookHandler {
            r#async: false,
            command: "/opt/devhatch/bin/devhatch-agent-hook".to_string(),
            timeout: 86400,
            kind: "command",
        };
        let value = serde_json::json!({
            "event_name": "permission_request",
            "hooks": [handler],
            "matcher": "*",
        });
        let hash = encode_hex(&Sha256::digest(
            serde_json::to_vec(&canonical_json(value)).unwrap(),
        ));
        assert_eq!(
            hash,
            "54839dd50bfe66a959865cf31ae02f7271f93c91b2a9e476658a149c6d32f8bf"
        );
    }
}
