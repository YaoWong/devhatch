use std::{
    collections::HashSet,
    env,
    fs::{self, File, Metadata},
    io::{BufRead, BufReader, Read},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use serde_json::Value;
use uuid::Uuid;

use super::{DeleteError, HistoryError, HistoryItem, PreparedLaunch, Presence};
use crate::{
    agent::PI_ID,
    filesystem::{home_dir, path_string},
    state::AppState,
};

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_LINE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct SessionRecord {
    pub(crate) id: String,
    pub(crate) path: PathBuf,
    pub(crate) cwd: PathBuf,
    title: String,
    created_at: i64,
    updated_at: i64,
    identity: FileIdentity,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
}

#[derive(Clone, Copy)]
enum Layout {
    Direct,
    Nested,
}

struct SessionRoot {
    path: PathBuf,
    layout: Layout,
}

enum SettingsPath {
    Missing,
    Valid(PathBuf),
    Invalid,
}

pub(crate) async fn list(
    workspaces: Vec<PathBuf>,
    active_ids: HashSet<String>,
    active_files: HashSet<PathBuf>,
) -> Result<Vec<HistoryItem>, &'static str> {
    tokio::task::spawn_blocking(move || {
        let roots = resolve_roots(&workspaces).map_err(|_| "PI_HISTORY_DIRECTORY_NOT_FOUND")?;
        let mut records = records_in_roots(&roots);
        records.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.cmp(&right.id))
                .then_with(|| left.path.cmp(&right.path))
        });
        Ok(records
            .into_iter()
            .map(|record| HistoryItem {
                presence: if active_files.contains(&record.path) || active_ids.contains(&record.id)
                {
                    Presence::ActiveHere
                } else {
                    Presence::Inactive
                },
                id: record.id,
                title: record.title,
                directory: path_string(record.cwd),
                project_id: None,
                project_name: None,
                project_worktree: None,
                time_created: record.created_at,
                time_updated: record.updated_at,
            })
            .collect())
    })
    .await
    .map_err(|_| "PI_HISTORY_UNAVAILABLE")?
}

pub(crate) async fn prepare(
    workspaces: Vec<PathBuf>,
    requested_id: Option<&str>,
) -> Result<PreparedLaunch, HistoryError> {
    let Some(id) = requested_id else {
        return Ok(PreparedLaunch::PiNew {
            id: Uuid::new_v4().to_string(),
        });
    };
    let record = lookup(workspaces, id.to_string(), true).await?;
    Ok(PreparedLaunch::PiResume {
        id: record.id,
        path: record.path,
        cwd: record.cwd,
    })
}

pub(crate) async fn lookup(
    workspaces: Vec<PathBuf>,
    id: String,
    require_cwd: bool,
) -> Result<SessionRecord, HistoryError> {
    if !valid_session_id(&id) {
        return Err(HistoryError::InvalidId);
    }
    tokio::task::spawn_blocking(move || {
        let roots = resolve_roots(&workspaces)?;
        lookup_in_roots(&roots, &id, require_cwd)
    })
    .await
    .map_err(|_| HistoryError::Unavailable)?
}

pub(crate) async fn delete(
    state: &AppState,
    workspaces: Vec<PathBuf>,
    id: String,
) -> Result<(), DeleteError> {
    if !valid_session_id(&id) {
        return Err(DeleteError::History(HistoryError::InvalidId));
    }
    let record = lookup(workspaces.clone(), id.clone(), false)
        .await
        .map_err(DeleteError::History)?;
    if pi_delete_active(
        &state.active_upstream_session_ids_for(PI_ID),
        &state.active_upstream_session_files_for(PI_ID),
        &id,
        &record.path,
    ) {
        return Err(DeleteError::History(HistoryError::Active));
    }
    tokio::task::spawn_blocking(move || {
        let roots = resolve_roots(&workspaces).map_err(DeleteError::History)?;
        let root = roots
            .iter()
            .find(|root| record.path.starts_with(&root.path))
            .ok_or_else(delete_failed)?;
        delete_record(root, &record, &id)
    })
    .await
    .map_err(|_| delete_failed())?
}

fn pi_delete_active(
    active_ids: &HashSet<String>,
    active_files: &HashSet<PathBuf>,
    requested_id: &str,
    requested_path: &Path,
) -> bool {
    active_ids.contains(requested_id) || active_file_matches(active_files, requested_path)
}

fn active_file_matches(active_files: &HashSet<PathBuf>, requested: &Path) -> bool {
    let requested_canonical = fs::canonicalize(requested).ok();
    active_files.iter().any(|active| {
        active == requested
            || matches!(
                (&requested_canonical, fs::canonicalize(active)),
                (Some(requested), Ok(active)) if requested == &active
            )
    })
}

fn delete_record(root: &SessionRoot, record: &SessionRecord, id: &str) -> Result<(), DeleteError> {
    let canonical = trusted_file(root, &record.path).ok_or_else(delete_failed)?;
    if canonical != record.path {
        return Err(delete_failed());
    }
    let metadata = trusted_regular_metadata(&record.path)
        .filter(|metadata| FileIdentity::from(metadata) == record.identity)
        .ok_or_else(delete_failed)?;
    if metadata.len() > MAX_FILE_BYTES
        || parse_session(&record.path)
            .is_none_or(|current| current.id != id || current.identity != record.identity)
    {
        return Err(delete_failed());
    }
    fs::remove_file(&record.path).map_err(|_| delete_failed())
}

fn delete_failed() -> DeleteError {
    DeleteError::Failed {
        status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
        code: "PI_SESSION_DELETE_FAILED",
        message: None,
    }
}

fn lookup_in_roots(
    roots: &[SessionRoot],
    id: &str,
    require_cwd: bool,
) -> Result<SessionRecord, HistoryError> {
    let mut matches = records_in_roots(roots)
        .into_iter()
        .filter(|record| record.id == id);
    let Some(record) = matches.next() else {
        return Err(HistoryError::NotFound);
    };
    if matches.next().is_some() {
        return Err(HistoryError::Ambiguous);
    }
    let root = roots
        .iter()
        .find(|root| record.path.starts_with(&root.path))
        .ok_or(HistoryError::NotFound)?;
    let path = trusted_file(root, &record.path).ok_or(HistoryError::NotFound)?;
    let mut current = parse_session(&path)
        .filter(|current| current.id == id && current.identity == record.identity)
        .ok_or(HistoryError::NotFound)?;
    current.path = path;
    if require_cwd {
        current.cwd = canonical_cwd(&current.cwd).ok_or(HistoryError::InvalidCwd)?;
    }
    Ok(current)
}

fn canonical_cwd(path: &Path) -> Option<PathBuf> {
    if path.as_os_str().is_empty() || !path.is_absolute() {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    fs::canonicalize(path).ok().filter(|path| path.is_dir())
}

fn resolve_roots(workspaces: &[PathBuf]) -> Result<Vec<SessionRoot>, HistoryError> {
    let server_cwd = env::current_dir().map_err(|_| HistoryError::Unavailable)?;
    let mut candidates = Vec::with_capacity(workspaces.len() + 1);
    candidates.push(server_cwd);
    candidates.extend(workspaces.iter().cloned());
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    for cwd in candidates {
        let Ok(cwd) = fs::canonicalize(cwd) else {
            continue;
        };
        let Ok(root) = resolve_root_for(&cwd) else {
            continue;
        };
        if seen.insert(root.path.clone()) {
            roots.push(root);
        }
    }
    (!roots.is_empty())
        .then_some(roots)
        .ok_or(HistoryError::Unavailable)
}

fn resolve_root_for(cwd: &Path) -> Result<SessionRoot, HistoryError> {
    resolve_root_from(
        env::var_os("PI_CODING_AGENT_SESSION_DIR"),
        env::var_os("PI_CODING_AGENT_DIR"),
        &home_dir(),
        cwd,
    )
}

fn resolve_root_from(
    session_env: Option<std::ffi::OsString>,
    agent_env: Option<std::ffi::OsString>,
    home: &Path,
    cwd: &Path,
) -> Result<SessionRoot, HistoryError> {
    if let Some(path) = session_env {
        return canonical_root(expand_path(Path::new(&path), home, cwd), Layout::Direct);
    }
    let agent_dir = agent_env
        .map(PathBuf::from)
        .map(|path| expand_path(&path, home, cwd))
        .unwrap_or_else(|| home.join(".pi/agent"));
    let global_settings = settings_session_dir(&agent_dir.join("settings.json"), home, cwd);
    let project_settings = settings_session_dir(&cwd.join(".pi/settings.json"), home, cwd);
    match (project_settings, global_settings) {
        (SettingsPath::Invalid, _) | (_, SettingsPath::Invalid) => Err(HistoryError::Unavailable),
        (SettingsPath::Valid(path), _) | (SettingsPath::Missing, SettingsPath::Valid(path)) => {
            canonical_root(path, Layout::Direct)
        }
        (SettingsPath::Missing, SettingsPath::Missing) => {
            canonical_root(agent_dir.join("sessions"), Layout::Nested)
        }
    }
}

fn settings_session_dir(settings: &Path, home: &Path, cwd: &Path) -> SettingsPath {
    let file = match File::open(settings) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return SettingsPath::Missing,
        Err(_) => return SettingsPath::Invalid,
    };
    let value: Value = match serde_json::from_reader(file) {
        Ok(value) => value,
        Err(_) => return SettingsPath::Invalid,
    };
    match value.get("sessionDir") {
        None | Some(Value::Null) => SettingsPath::Missing,
        Some(Value::String(value)) if !value.is_empty() && !value.contains('\0') => {
            SettingsPath::Valid(expand_path(Path::new(value), home, cwd))
        }
        Some(_) => SettingsPath::Invalid,
    }
}

fn expand_path(path: &Path, home: &Path, cwd: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if value == "~" {
        home.to_path_buf()
    } else if let Some(rest) = value.strip_prefix("~/") {
        home.join(rest)
    } else if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

fn canonical_root(path: PathBuf, layout: Layout) -> Result<SessionRoot, HistoryError> {
    let metadata = fs::symlink_metadata(&path).map_err(|_| HistoryError::Unavailable)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(HistoryError::Unavailable);
    }
    let path = fs::canonicalize(path).map_err(|_| HistoryError::Unavailable)?;
    if fs::read_dir(&path).is_err() {
        return Err(HistoryError::Unavailable);
    }
    Ok(SessionRoot { path, layout })
}

fn records_in_roots(roots: &[SessionRoot]) -> Vec<SessionRecord> {
    let mut seen = HashSet::new();
    roots
        .iter()
        .flat_map(records)
        .filter(|record| seen.insert(record.path.clone()))
        .collect()
}

fn records(root: &SessionRoot) -> Vec<SessionRecord> {
    candidate_files(root)
        .into_iter()
        .filter_map(|path| parse_session(&path))
        .collect()
}

fn candidate_files(root: &SessionRoot) -> Vec<PathBuf> {
    let mut files = files_in(&root.path, &root.path);
    if matches!(root.layout, Layout::Nested)
        && let Ok(entries) = fs::read_dir(&root.path)
    {
        for entry in entries.flatten() {
            if files.len() >= MAX_FILES {
                break;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() || !file_type.is_dir() {
                continue;
            }
            let Ok(directory) = fs::canonicalize(entry.path()) else {
                continue;
            };
            if !directory.starts_with(&root.path) {
                continue;
            }
            files.extend(files_in(&root.path, &directory));
            files.truncate(MAX_FILES);
        }
    }
    files.truncate(MAX_FILES);
    files
}

fn files_in(root: &Path, directory: &Path) -> Vec<PathBuf> {
    fs::read_dir(directory)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .take(MAX_FILES)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            (!file_type.is_symlink() && file_type.is_file())
                .then(|| trusted_file_path(root, &entry.path()))
                .flatten()
        })
        .collect()
}

fn trusted_file(root: &SessionRoot, path: &Path) -> Option<PathBuf> {
    trusted_file_path(&root.path, path)
}

fn trusted_file_path(root: &Path, path: &Path) -> Option<PathBuf> {
    if path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return None;
    }
    trusted_regular_metadata(path)?;
    let canonical = fs::canonicalize(path).ok()?;
    canonical.starts_with(root).then_some(canonical)
}

fn trusted_regular_metadata(path: &Path) -> Option<Metadata> {
    let metadata = fs::symlink_metadata(path).ok()?;
    (!metadata.file_type().is_symlink() && metadata.is_file()).then_some(metadata)
}

impl From<&Metadata> for FileIdentity {
    fn from(metadata: &Metadata) -> Self {
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
        }
    }
}

fn parse_session(path: &Path) -> Option<SessionRecord> {
    let file = File::open(path).ok()?;
    let metadata = file.metadata().ok()?;
    if metadata.len() > MAX_FILE_BYTES {
        return None;
    }
    let identity = FileIdentity::from(&metadata);
    let fallback_mtime = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default();
    let mut reader = BufReader::new(file);
    let header = next_json(&mut reader)?;
    if header.get("type")?.as_str()? != "session" {
        return None;
    }
    let id = header.get("id")?.as_str()?.to_string();
    if !valid_session_id(&id) {
        return None;
    }
    let cwd = header
        .get("cwd")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_default();
    let created_at = value_timestamp(header.get("timestamp")).unwrap_or(fallback_mtime);
    let mut latest_name = None;
    let mut first_user_text = None;
    let mut updated_at = None;
    while let Some(entry) = next_json(&mut reader) {
        if entry.get("type").and_then(Value::as_str) == Some("session_info") {
            latest_name = Some(
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
            );
        }
        let Some(message) = entry.get("message") else {
            continue;
        };
        let Some(role) = message.get("role").and_then(Value::as_str) else {
            continue;
        };
        if !matches!(role, "user" | "assistant") {
            continue;
        }
        let timestamp = numeric_timestamp(message.get("timestamp"))
            .or_else(|| value_timestamp(entry.get("timestamp")));
        if let Some(timestamp) = timestamp {
            updated_at = Some(updated_at.map_or(timestamp, |current: i64| current.max(timestamp)));
        }
        if role == "user" && first_user_text.is_none() {
            first_user_text = message.get("content").and_then(content_text);
        }
    }
    let title = latest_name
        .filter(|name| !name.is_empty())
        .or(first_user_text)
        .unwrap_or_else(|| "(no messages)".to_string());
    Some(SessionRecord {
        id,
        path: path.to_path_buf(),
        cwd,
        title,
        created_at,
        updated_at: updated_at.unwrap_or(created_at).max(0),
        identity,
    })
}

fn next_json(reader: &mut BufReader<File>) -> Option<Value> {
    loop {
        let mut bytes = Vec::new();
        let read = reader
            .by_ref()
            .take(MAX_LINE_BYTES + 1)
            .read_until(b'\n', &mut bytes)
            .ok()?;
        if read == 0 || read as u64 > MAX_LINE_BYTES {
            return None;
        }
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes)
            && !bytes.iter().all(u8::is_ascii_whitespace)
        {
            return Some(value);
        }
    }
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return nonempty(text);
    }
    let blocks = content.as_array()?;
    let text = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    nonempty(&text)
}

fn nonempty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn value_timestamp_string(value: Option<&Value>) -> Option<i64> {
    let value = value?.as_str()?;
    let (date, time) = value.split_once('T')?;
    let mut date = date.split('-').map(|part| part.parse::<i64>().ok());
    let year = date.next()??;
    let month = date.next()??;
    let day = date.next()??;
    if date.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (clock, offset_seconds) = if let Some(clock) = time.strip_suffix('Z') {
        (clock, 0)
    } else {
        let index = time.rfind(['+', '-'])?;
        let (clock, offset) = time.split_at(index);
        let sign = if offset.starts_with('+') { 1 } else { -1 };
        let (hours, minutes) = offset[1..].split_once(':')?;
        let offset = hours.parse::<i64>().ok()?.checked_mul(3600)?
            + minutes.parse::<i64>().ok()?.checked_mul(60)?;
        (clock, sign * offset)
    };
    let mut clock = clock.split(':');
    let hour = clock.next()?.parse::<i64>().ok()?;
    let minute = clock.next()?.parse::<i64>().ok()?;
    let second = clock.next()?;
    if clock.next().is_some() || hour > 23 || minute > 59 {
        return None;
    }
    let (second, fraction) = second.split_once('.').unwrap_or((second, ""));
    let second = second.parse::<i64>().ok()?;
    if second > 60 || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let padded_fraction = format!("{fraction:0<3}");
    let millis = padded_fraction[..3].parse::<i64>().unwrap_or_default();
    let days = days_from_civil(year, month, day)?;
    Some(
        (days.checked_mul(86_400)? + hour.checked_mul(3600)? + minute.checked_mul(60)? + second
            - offset_seconds)
            .checked_mul(1000)?
            + millis,
    )
}

fn days_from_civil(year: i64, month: i64, day: i64) -> Option<i64> {
    let year = year - i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}

fn value_timestamp(value: Option<&Value>) -> Option<i64> {
    value_timestamp_string(value).or_else(|| numeric_timestamp(value))
}

fn numeric_timestamp(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    if let Some(number) = value.as_i64() {
        return Some(if number.abs() < 100_000_000_000 {
            number.saturating_mul(1000)
        } else {
            number
        });
    }
    let number = value.as_f64()?;
    number.is_finite().then(|| {
        if number.abs() < 100_000_000_000.0 {
            (number * 1000.0) as i64
        } else {
            number as i64
        }
    })
}

pub(crate) fn valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root() -> PathBuf {
        let root = env::temp_dir().join(format!("devhatch-pi-history-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        root
    }

    fn write_session(path: &Path, id: &str, cwd: Option<&str>, entries: &str) {
        let cwd = cwd
            .map(|cwd| format!(",\"cwd\":\"{cwd}\""))
            .unwrap_or_default();
        fs::write(path, format!("{{\"type\":\"session\",\"version\":3,\"id\":\"{id}\",\"timestamp\":\"2025-01-01T00:00:00Z\"{cwd}}}\n{entries}")).unwrap();
    }

    #[test]
    fn pi_activity_is_scoped_to_requested_id_or_canonical_file() {
        let root = temporary_root();
        let path = root.join("session.jsonl");
        fs::write(&path, "{}\n").unwrap();
        let alias = root.join("alias.jsonl");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(!pi_delete_active(
            &HashSet::from(["different".into()]),
            &HashSet::new(),
            "requested",
            &path,
        ));
        assert!(pi_delete_active(
            &HashSet::from(["requested".into()]),
            &HashSet::new(),
            "requested",
            &path,
        ));
        assert!(pi_delete_active(
            &HashSet::new(),
            &HashSet::from([alias]),
            "requested",
            &path,
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_exact_pi_id_grammar_without_length_limit() {
        assert!(valid_session_id("abc-DEF_123.json"));
        assert!(valid_session_id(&"a".repeat(1024)));
        assert!(!valid_session_id("-abc"));
        assert!(!valid_session_id("abc-"));
        assert!(!valid_session_id("a/b"));
    }

    #[test]
    fn parses_current_legacy_headers_and_skips_bad_prefix_lines() {
        let root = temporary_root();
        let current = root.join("current.jsonl");
        fs::write(&current, "\nnot-json\n{\"type\":\"session\",\"id\":\"current\",\"timestamp\":\"2025-01-01T00:00:00Z\",\"cwd\":\"/tmp\"}\n").unwrap();
        let legacy = root.join("legacy.jsonl");
        write_session(&legacy, "legacy", None, "");
        assert_eq!(parse_session(&current).unwrap().id, "current");
        assert_eq!(parse_session(&legacy).unwrap().cwd, PathBuf::new());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_pi_title_and_timestamp_fallbacks() {
        let root = temporary_root();
        let path = root.join("session.jsonl");
        write_session(
            &path,
            "session-1",
            Some("/tmp"),
            "{\"type\":\"message\",\"timestamp\":\"2025-01-02T00:00:00Z\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"First prompt\"}]}}\n{\"type\":\"session_info\",\"name\":\"Named\"}\n{\"type\":\"session_info\",\"name\":\"\"}\n{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":\"ok\",\"timestamp\":1735862400000}}\n",
        );
        let record = parse_session(&path).unwrap();
        assert_eq!(record.title, "First prompt");
        assert_eq!(record.created_at, 1_735_689_600_000);
        assert_eq!(record.updated_at, 1_735_862_400_000);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn nested_layout_includes_direct_and_every_immediate_child_but_not_symlinks() {
        let root = temporary_root();
        let outside = temporary_root();
        fs::create_dir(root.join("arbitrary-child")).unwrap();
        write_session(&root.join("direct.jsonl"), "direct", Some("/tmp"), "");
        write_session(
            &root.join("arbitrary-child/nested.jsonl"),
            "nested",
            Some("/tmp"),
            "",
        );
        write_session(&outside.join("outside.jsonl"), "outside", Some("/tmp"), "");
        std::os::unix::fs::symlink(&outside, root.join("escaped")).unwrap();
        std::os::unix::fs::symlink(outside.join("outside.jsonl"), root.join("linked.jsonl"))
            .unwrap();
        let session_root = SessionRoot {
            path: fs::canonicalize(&root).unwrap(),
            layout: Layout::Nested,
        };
        let ids = records(&session_root)
            .into_iter()
            .map(|record| record.id)
            .collect::<HashSet<_>>();
        assert_eq!(ids, HashSet::from(["direct".into(), "nested".into()]));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn duplicate_ids_list_but_lookup_is_ambiguous() {
        let root = temporary_root();
        fs::create_dir(root.join("a")).unwrap();
        fs::create_dir(root.join("b")).unwrap();
        write_session(&root.join("a/a.jsonl"), "duplicate", Some("/tmp"), "");
        write_session(&root.join("b/b.jsonl"), "duplicate", Some("/tmp"), "");
        let session_root = SessionRoot {
            path: fs::canonicalize(&root).unwrap(),
            layout: Layout::Nested,
        };
        assert_eq!(records(&session_root).len(), 2);
        assert_eq!(
            lookup_in_roots(&[session_root], "duplicate", false).unwrap_err(),
            HistoryError::Ambiguous
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn root_precedence_merges_project_settings_and_resolves_relative_paths() {
        let root = temporary_root();
        let home = root.join("home");
        let cwd = root.join("cwd");
        let agent = root.join("agent");
        let configured = cwd.join("relative-sessions");
        let explicit = root.join("explicit");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(&agent).unwrap();
        fs::create_dir_all(&configured).unwrap();
        fs::create_dir_all(&explicit).unwrap();
        fs::write(
            agent.join("settings.json"),
            format!("{{\"sessionDir\":{:?}}}", configured.to_string_lossy()),
        )
        .unwrap();
        let from_settings =
            resolve_root_from(None, Some(agent.clone().into_os_string()), &home, &cwd).unwrap();
        assert_eq!(from_settings.path, fs::canonicalize(&configured).unwrap());
        let from_env = resolve_root_from(
            Some(explicit.clone().into_os_string()),
            Some(agent.into_os_string()),
            &home,
            &cwd,
        )
        .unwrap();
        assert_eq!(from_env.path, fs::canonicalize(&explicit).unwrap());
        fs::write(
            root.join("agent/settings.json"),
            "{\"sessionDir\":\"relative-sessions\"}",
        )
        .unwrap();
        let relative =
            resolve_root_from(None, Some(root.join("agent").into_os_string()), &home, &cwd)
                .unwrap();
        assert_eq!(relative.path, fs::canonicalize(&configured).unwrap());
        fs::create_dir_all(cwd.join("project-sessions")).unwrap();
        fs::create_dir_all(cwd.join(".pi")).unwrap();
        fs::write(
            cwd.join(".pi/settings.json"),
            "{\"sessionDir\":\"project-sessions\"}",
        )
        .unwrap();
        let project =
            resolve_root_from(None, Some(root.join("agent").into_os_string()), &home, &cwd)
                .unwrap();
        assert_eq!(
            project.path,
            fs::canonicalize(cwd.join("project-sessions")).unwrap()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_settings_do_not_fall_back() {
        let root = temporary_root();
        fs::write(root.join("settings.json"), "{bad").unwrap();
        assert!(matches!(
            settings_session_dir(&root.join("settings.json"), &root, &root),
            SettingsPath::Invalid
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resume_rejects_legacy_missing_cwd() {
        let root = temporary_root();
        write_session(&root.join("legacy.jsonl"), "legacy", None, "");
        let session_root = SessionRoot {
            path: fs::canonicalize(&root).unwrap(),
            layout: Layout::Direct,
        };
        assert_eq!(
            lookup_in_roots(&[session_root], "legacy", true).unwrap_err(),
            HistoryError::InvalidCwd
        );
        fs::remove_dir_all(root).unwrap();
    }
}
