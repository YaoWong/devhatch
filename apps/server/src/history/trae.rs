use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    fs,
    io::Read,
    os::unix::fs::FileTypeExt,
    path::{Path, PathBuf},
    time::Duration,
};

use axum::http::StatusCode;
use serde::Deserialize;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use uuid::Uuid;

use super::{DeleteError, HistoryError, HistoryItem, PreparedLaunch, Presence};
use crate::{agent::TRAECLI_ID, filesystem::home_dir, state::AppState};

const MAX_PEER_BYTES: u64 = 20 * 1024;
const START_TIME_TOLERANCE_MS: u64 = 5_000;
const REQUIRED_COLUMNS: &[&str] = &[
    "id",
    "rollout_path",
    "created_at",
    "updated_at",
    "cwd",
    "title",
    "archived",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TraeHomes {
    pub(crate) trae_home: PathBuf,
    pub(crate) cli_home: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionRecord {
    pub(crate) id: String,
    pub(crate) path: PathBuf,
    pub(crate) cwd: PathBuf,
}

#[derive(Clone, Copy, Debug)]
struct Schema {
    created_at_ms: bool,
    updated_at_ms: bool,
    first_user_message: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPeer {
    protocol_version: u64,
    pid: u32,
    started_at_ms: u64,
    thread_id: String,
    socket_path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PeerEvidence {
    protocol_version: u64,
    valid_thread_id: bool,
    process_live: bool,
    start_time_matches: bool,
    executable_matches: bool,
    socket_is_unix: bool,
    process_owns_socket: bool,
    thread_exists: bool,
}

fn verified_external_peer(evidence: &PeerEvidence) -> bool {
    evidence.protocol_version == 1
        && evidence.valid_thread_id
        && evidence.process_live
        && evidence.start_time_matches
        && evidence.executable_matches
        && evidence.socket_is_unix
        && evidence.process_owns_socket
        && evidence.thread_exists
}

pub(crate) fn resolve_homes() -> TraeHomes {
    resolve_homes_from(
        env::var_os("TRAECLI_HOME"),
        env::var_os("TRAE_HOME"),
        &home_dir(),
        &env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
    )
}

fn resolve_homes_from(
    cli_home: Option<OsString>,
    trae_home: Option<OsString>,
    home: &Path,
    current_dir: &Path,
) -> TraeHomes {
    let absolute = |path: PathBuf| {
        if path.is_absolute() {
            path
        } else {
            current_dir.join(path)
        }
    };
    let trae_home = absolute(
        trae_home
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".trae")),
    );
    let cli_home = absolute(
        cli_home
            .map(PathBuf::from)
            .unwrap_or_else(|| trae_home.join("cli")),
    );
    TraeHomes {
        trae_home,
        cli_home,
    }
}

pub(crate) async fn list(state: &AppState) -> Result<Vec<HistoryItem>, &'static str> {
    list_from(
        resolve_homes(),
        state.active_upstream_session_ids_for(TRAECLI_ID),
        state.active_upstream_session_files_for(TRAECLI_ID),
    )
    .await
}

async fn list_from(
    homes: TraeHomes,
    active_ids: HashSet<String>,
    active_files: HashSet<PathBuf>,
) -> Result<Vec<HistoryItem>, &'static str> {
    let pool = open_pool(&homes)
        .await
        .map_err(|_| "TRAE_HISTORY_DATABASE_NOT_FOUND")?;
    let schema = validate_schema(&pool).await?;
    let created = if schema.created_at_ms {
        "COALESCE(created_at_ms, created_at * 1000, 0)"
    } else {
        "COALESCE(created_at * 1000, 0)"
    };
    let updated = if schema.updated_at_ms {
        "COALESCE(updated_at_ms, updated_at * 1000, 0)"
    } else {
        "COALESCE(updated_at * 1000, 0)"
    };
    let first_user_message = if schema.first_user_message {
        "NULLIF(TRIM(first_user_message), '')"
    } else {
        "NULL"
    };
    let query = format!(
        "SELECT id, cwd, rollout_path, COALESCE(NULLIF(TRIM(title), ''), {first_user_message}, '(no messages)') AS display_title, {created} AS time_created, {updated} AS time_updated FROM threads WHERE COALESCE(archived, 0) = 0 ORDER BY time_updated DESC, id ASC"
    );
    let rows = sqlx::query(&query)
        .fetch_all(&pool)
        .await
        .map_err(|_| "TRAE_HISTORY_QUERY_FAILED")?;
    let history_ids = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("id").ok())
        .collect::<HashSet<_>>();
    let external_ids = tokio::task::spawn_blocking({
        let homes = homes.clone();
        move || external_session_ids(&homes, &history_ids)
    })
    .await
    .map_err(|_| "TRAE_HISTORY_UNAVAILABLE")?
    .map_err(|_| "TRAE_HISTORY_PEERS_UNAVAILABLE")?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let id = row.try_get::<String, _>("id").ok()?;
            if !valid_session_id(&id) {
                return None;
            }
            let path = row
                .try_get::<Option<String>, _>("rollout_path")
                .ok()
                .flatten()
                .map(PathBuf::from);
            let presence = if active_ids.contains(&id)
                || path
                    .as_ref()
                    .is_some_and(|path| active_files.contains(path))
            {
                Presence::ActiveHere
            } else if external_ids.contains(&id) {
                Presence::PossiblyActiveElsewhere
            } else {
                Presence::Inactive
            };
            Some(HistoryItem {
                id,
                title: row.try_get("display_title").ok()?,
                directory: row.try_get("cwd").unwrap_or_default(),
                project_id: None,
                project_name: None,
                project_worktree: None,
                time_created: row.try_get("time_created").unwrap_or_default(),
                time_updated: row.try_get("time_updated").unwrap_or_default(),
                presence,
            })
        })
        .collect())
}

pub(crate) async fn prepare(requested_id: Option<&str>) -> Result<PreparedLaunch, HistoryError> {
    prepare_from(resolve_homes(), requested_id).await
}

async fn prepare_from(
    homes: TraeHomes,
    requested_id: Option<&str>,
) -> Result<PreparedLaunch, HistoryError> {
    let Some(id) = requested_id else {
        return Ok(PreparedLaunch::TraeNew {
            id: Uuid::new_v4().to_string(),
        });
    };
    let record = lookup(homes, id.to_string()).await?;
    Ok(PreparedLaunch::TraeResume {
        id: record.id,
        path: record.path,
        cwd: record.cwd,
    })
}

pub(crate) async fn lookup(homes: TraeHomes, id: String) -> Result<SessionRecord, HistoryError> {
    if !valid_session_id(&id) {
        return Err(HistoryError::InvalidId);
    }
    let pool = open_pool(&homes)
        .await
        .map_err(|_| HistoryError::Unavailable)?;
    validate_schema(&pool)
        .await
        .map_err(|_| HistoryError::Unavailable)?;
    let row = sqlx::query(
        "SELECT id, rollout_path, cwd FROM threads WHERE id = ? AND COALESCE(archived, 0) = 0",
    )
    .bind(&id)
    .fetch_optional(&pool)
    .await
    .map_err(|_| HistoryError::Unavailable)?
    .ok_or(HistoryError::NotFound)?;
    let cwd = trusted_cwd(Path::new(
        &row.try_get::<String, _>("cwd")
            .map_err(|_| HistoryError::InvalidCwd)?,
    ))
    .ok_or(HistoryError::InvalidCwd)?;
    let rollout = row
        .try_get::<String, _>("rollout_path")
        .map_err(|_| HistoryError::NotFound)?;
    let path = trusted_rollout(&homes, Path::new(&rollout)).ok_or(HistoryError::NotFound)?;
    Ok(SessionRecord { id, path, cwd })
}

pub(crate) async fn delete(state: &AppState, id: String) -> Result<(), DeleteError> {
    if !valid_session_id(&id) {
        return Err(DeleteError::History(HistoryError::InvalidId));
    }
    let homes = resolve_homes();
    if state
        .active_upstream_session_ids_for(TRAECLI_ID)
        .contains(&id)
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let record = lookup(homes.clone(), id.clone())
        .await
        .map_err(DeleteError::History)?;
    if state
        .active_upstream_session_ids_for(TRAECLI_ID)
        .contains(&id)
        || state
            .active_upstream_session_files_for(TRAECLI_ID)
            .contains(&record.path)
    {
        return Err(DeleteError::History(HistoryError::Active));
    }
    let externally_active = tokio::task::spawn_blocking({
        let homes = homes.clone();
        let id = id.clone();
        move || {
            external_session_ids(&homes, &HashSet::from([id.clone()])).map(|ids| ids.contains(&id))
        }
    })
    .await
    .map_err(|_| DeleteError::History(HistoryError::Unavailable))?
    .map_err(|_| DeleteError::History(HistoryError::Unavailable))?;
    if externally_active {
        return Err(DeleteError::History(HistoryError::ExternalActive));
    }
    let result = tokio::process::Command::new("traecli")
        .args(delete_args(&id))
        .env("TRAE_HOME", &homes.trae_home)
        .env("TRAECLI_HOME", &homes.cli_home)
        .kill_on_drop(true)
        .output()
        .await;
    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(DeleteError::Failed {
            status: StatusCode::BAD_GATEWAY,
            code: "TRAE_SESSION_DELETE_FAILED",
            message: Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        }),
        Err(_) => Err(DeleteError::Failed {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "TRAECLI_UNAVAILABLE",
            message: None,
        }),
    }
}

fn external_session_ids(
    homes: &TraeHomes,
    history_ids: &HashSet<String>,
) -> Result<HashSet<String>, ()> {
    let Ok(entries) = fs::read_dir(homes.cli_home.join("session-peers")) else {
        return Ok(HashSet::new());
    };
    let mut external = HashSet::new();
    let mut count = 0;
    for entry in entries.flatten() {
        count += 1;
        if count > 20_000 {
            return Err(());
        }
        if let Some(id) = verified_peer_file(&entry.path(), history_ids) {
            external.insert(id);
        }
    }
    Ok(external)
}

fn verified_peer_file(path: &Path, history_ids: &HashSet<String>) -> Option<String> {
    if path.extension().and_then(|value| value.to_str()) != Some("json") {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_PEER_BYTES {
        return None;
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .ok()?
        .take(MAX_PEER_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_PEER_BYTES {
        return None;
    }
    let peer: SessionPeer = serde_json::from_slice(&bytes).ok()?;
    let evidence = peer_evidence(&peer, history_ids);
    verified_external_peer(&evidence).then_some(peer.thread_id)
}

fn peer_evidence(peer: &SessionPeer, history_ids: &HashSet<String>) -> PeerEvidence {
    let proc = PathBuf::from(format!("/proc/{}", peer.pid));
    let process_live = proc.is_dir();
    let socket_is_unix = fs::symlink_metadata(&peer.socket_path)
        .is_ok_and(|metadata| metadata.file_type().is_socket());
    let socket_inodes = if socket_is_unix {
        unix_socket_inodes(&peer.socket_path)
    } else {
        HashSet::new()
    };
    PeerEvidence {
        protocol_version: peer.protocol_version,
        valid_thread_id: valid_session_id(&peer.thread_id),
        process_live,
        start_time_matches: process_live
            && process_start_epoch_ms(&proc).is_some_and(|started| {
                started.abs_diff(peer.started_at_ms) <= START_TIME_TOLERANCE_MS
            }),
        executable_matches: process_live && trusted_trae_executable(&proc),
        socket_is_unix,
        process_owns_socket: process_owns_any_socket(&proc, &socket_inodes),
        thread_exists: history_ids.contains(&peer.thread_id),
    }
}

fn process_start_epoch_ms(proc: &Path) -> Option<u64> {
    let stat = fs::read_to_string(proc.join("stat")).ok()?;
    let mut fields = stat.get(stat.rfind(')')? + 1..)?.split_whitespace();
    let start_ticks = fields.nth(19)?.parse::<u64>().ok()?;
    let ticks_per_second = clock_ticks_per_second()?;
    let boot_seconds = fs::read_to_string("/proc/stat")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("btime "))?
        .parse::<u64>()
        .ok()?;
    boot_seconds
        .checked_mul(1000)?
        .checked_add(start_ticks.checked_mul(1000)? / ticks_per_second)
}

fn clock_ticks_per_second() -> Option<u64> {
    let bytes = fs::read("/proc/self/auxv").ok()?;
    let width = std::mem::size_of::<usize>();
    for pair in bytes.chunks_exact(width * 2) {
        let key = usize::from_ne_bytes(pair[..width].try_into().ok()?);
        let value = usize::from_ne_bytes(pair[width..].try_into().ok()?);
        if key == 17 {
            return (value > 0).then_some(value as u64);
        }
    }
    None
}

fn trusted_trae_executable(proc: &Path) -> bool {
    fs::canonicalize(proc.join("exe"))
        .ok()
        .and_then(|path| path.file_name().map(OsString::from))
        .is_some_and(|name| name == "traecli" || name == "traex")
}

fn unix_socket_inodes(path: &Path) -> HashSet<u64> {
    let Some(path) = path.to_str() else {
        return HashSet::new();
    };
    fs::read_to_string("/proc/net/unix")
        .ok()
        .into_iter()
        .flat_map(|content| {
            content
                .lines()
                .skip(1)
                .filter_map(|line| unix_socket_line_inode(line, path))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn unix_socket_line_inode(line: &str, path: &str) -> Option<u64> {
    let mut rest = line;
    let mut inode = None;
    for index in 0..7 {
        rest = rest.trim_start();
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        if index == 6 {
            inode = rest[..end].parse::<u64>().ok();
        }
        rest = &rest[end..];
    }
    if rest.trim_start() == path {
        inode
    } else {
        None
    }
}

fn process_owns_any_socket(proc: &Path, inodes: &HashSet<u64>) -> bool {
    if inodes.is_empty() {
        return false;
    }
    fs::read_dir(proc.join("fd"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read_link(entry.path()).ok())
        .filter_map(|target| {
            target
                .to_str()?
                .strip_prefix("socket:[")?
                .strip_suffix(']')?
                .parse::<u64>()
                .ok()
        })
        .any(|inode| inodes.contains(&inode))
}

fn delete_args(id: &str) -> [&str; 3] {
    ["delete", "--force", id]
}

async fn open_pool(homes: &TraeHomes) -> Result<SqlitePool, sqlx::Error> {
    let path = homes.cli_home.join("state_5.sqlite");
    if !path.is_file() {
        return Err(sqlx::Error::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Trae history database not found",
        )));
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .busy_timeout(Duration::from_secs(2));
    SqlitePoolOptions::new()
        .max_connections(2)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("PRAGMA query_only = ON")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
        .connect_with(options)
        .await
}

async fn validate_schema(pool: &SqlitePool) -> Result<Schema, &'static str> {
    let rows = sqlx::query("PRAGMA table_info(threads)")
        .fetch_all(pool)
        .await
        .map_err(|_| "TRAE_HISTORY_SCHEMA_UNAVAILABLE")?;
    let columns = rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("name").ok())
        .collect::<HashSet<_>>();
    if !REQUIRED_COLUMNS.iter().all(|name| columns.contains(*name)) {
        return Err("TRAE_HISTORY_SCHEMA_UNSUPPORTED");
    }
    Ok(Schema {
        created_at_ms: columns.contains("created_at_ms"),
        updated_at_ms: columns.contains("updated_at_ms"),
        first_user_message: columns.contains("first_user_message"),
    })
}

fn trusted_cwd(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    fs::canonicalize(path).ok().filter(|path| path.is_dir())
}

fn trusted_rollout(homes: &TraeHomes, path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("jsonl") {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let sessions = fs::canonicalize(homes.cli_home.join("sessions")).ok()?;
    let canonical = fs::canonicalize(path).ok()?;
    canonical.starts_with(sessions).then_some(canonical)
}

pub(crate) fn valid_session_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.hyphenated().to_string() == value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::filesystem::path_string;
    use sqlx::sqlite::SqliteConnectOptions;
    use std::os::unix::net::UnixListener;

    fn temporary_homes() -> TraeHomes {
        let root = env::temp_dir().join(format!("devhatch-trae-history-{}", Uuid::new_v4()));
        let cli_home = root.join("cli");
        fs::create_dir_all(cli_home.join("sessions")).unwrap();
        TraeHomes {
            trae_home: root,
            cli_home,
        }
    }

    async fn database(homes: &TraeHomes, full_schema: bool) -> SqlitePool {
        let options = SqliteConnectOptions::new()
            .filename(homes.cli_home.join("state_5.sqlite"))
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .connect_with(options)
            .await
            .unwrap();
        let extra = if full_schema {
            ", created_at_ms INTEGER, updated_at_ms INTEGER, source TEXT, thread_source TEXT, has_user_event INTEGER"
        } else {
            ""
        };
        sqlx::query(&format!("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, cwd TEXT, title TEXT, first_user_message TEXT, archived INTEGER{extra})"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn external_peer_requires_every_strong_signal() {
        let valid = PeerEvidence {
            protocol_version: 1,
            valid_thread_id: true,
            process_live: true,
            start_time_matches: true,
            executable_matches: true,
            socket_is_unix: true,
            process_owns_socket: true,
            thread_exists: true,
        };
        assert!(verified_external_peer(&valid));
        for invalid in [
            PeerEvidence {
                protocol_version: 2,
                ..valid.clone()
            },
            PeerEvidence {
                process_live: false,
                ..valid.clone()
            },
            PeerEvidence {
                start_time_matches: false,
                ..valid.clone()
            },
            PeerEvidence {
                executable_matches: false,
                ..valid.clone()
            },
            PeerEvidence {
                socket_is_unix: false,
                ..valid.clone()
            },
            PeerEvidence {
                process_owns_socket: false,
                ..valid.clone()
            },
            PeerEvidence {
                thread_exists: false,
                ..valid.clone()
            },
        ] {
            assert!(!verified_external_peer(&invalid));
        }
    }

    #[test]
    fn rejects_untrusted_peer_files_without_reading_proc() {
        let homes = temporary_homes();
        let peers = homes.cli_home.join("session-peers");
        fs::create_dir(&peers).unwrap();
        let oversized = peers.join("oversized.json");
        fs::write(&oversized, vec![b'x'; MAX_PEER_BYTES as usize + 1]).unwrap();
        let linked = peers.join("linked.json");
        std::os::unix::fs::symlink(&oversized, &linked).unwrap();
        assert!(verified_peer_file(&oversized, &HashSet::new()).is_none());
        assert!(verified_peer_file(&linked, &HashSet::new()).is_none());
        fs::remove_dir_all(homes.trae_home).unwrap();
    }

    #[test]
    fn parses_unix_socket_paths_with_spaces() {
        assert_eq!(
            unix_socket_line_inode(
                "0001: 00000002 00000000 00010000 0001 01 12345 /tmp/peer socket",
                "/tmp/peer socket"
            ),
            Some(12345)
        );
    }

    #[test]
    fn resolves_unix_socket_inode_and_process_fd() {
        let root = env::temp_dir().join(format!("devhatch-trae-socket-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let socket = root.join("peer.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let inodes = unix_socket_inodes(&socket);
        assert_eq!(inodes.len(), 1);
        assert!(process_owns_any_socket(Path::new("/proc/self"), &inodes));
        drop(listener);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_canonical_uuid() {
        let id = Uuid::new_v4().to_string();
        assert!(valid_session_id(&id));
        assert!(!valid_session_id(&id.to_uppercase()));
        assert!(!valid_session_id("not-a-uuid"));
    }

    #[test]
    fn resolves_home_precedence() {
        let home = Path::new("/home/test");
        let current_dir = Path::new("/srv/devhatch");
        let default = resolve_homes_from(None, None, home, current_dir);
        assert_eq!(default.cli_home, Path::new("/home/test/.trae/cli"));
        let trae = resolve_homes_from(None, Some(OsString::from("/trae")), home, current_dir);
        assert_eq!(trae.cli_home, Path::new("/trae/cli"));
        let cli = resolve_homes_from(
            Some(OsString::from("/cli")),
            Some(OsString::from("/trae")),
            home,
            current_dir,
        );
        assert_eq!(cli.cli_home, Path::new("/cli"));
        assert_eq!(cli.trae_home, Path::new("/trae"));
        let relative = resolve_homes_from(
            Some(OsString::from("history")),
            Some(OsString::from("config")),
            home,
            current_dir,
        );
        assert_eq!(relative.cli_home, Path::new("/srv/devhatch/history"));
        assert_eq!(relative.trae_home, Path::new("/srv/devhatch/config"));
    }

    #[tokio::test]
    async fn validates_minimum_and_optional_schema() {
        let homes = temporary_homes();
        let pool = database(&homes, false).await;
        let schema = validate_schema(&pool).await.unwrap();
        assert!(!schema.created_at_ms);
        sqlx::query("DROP TABLE threads")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE threads (id TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            validate_schema(&pool).await.unwrap_err(),
            "TRAE_HISTORY_SCHEMA_UNSUPPORTED"
        );
        pool.close().await;
        fs::remove_dir_all(homes.trae_home).unwrap();
    }

    #[tokio::test]
    async fn lists_global_unarchived_history_with_fallbacks_and_ms_order() {
        let homes = temporary_homes();
        let pool = database(&homes, true).await;
        for values in [
            (
                Uuid::new_v4().to_string(),
                " Named ",
                "prompt",
                1,
                10,
                1000,
                3000,
                0,
                1,
            ),
            (
                Uuid::new_v4().to_string(),
                "",
                " First prompt ",
                2,
                20,
                2000,
                2000,
                0,
                1,
            ),
            (Uuid::new_v4().to_string(), "", "", 3, 30, 3000, 1000, 0, 1),
            (
                Uuid::new_v4().to_string(),
                "Hidden",
                "prompt",
                4,
                40,
                4000,
                4000,
                1,
                1,
            ),
            (
                Uuid::new_v4().to_string(),
                "No user",
                "",
                5,
                50,
                5000,
                5000,
                0,
                0,
            ),
        ] {
            sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, first_user_message, archived, created_at_ms, updated_at_ms, source, thread_source, has_user_event) VALUES (?, NULL, ?, ?, '/tmp', ?, ?, ?, ?, ?, 'unknown', 'unknown', ?)")
                .bind(values.0).bind(values.3).bind(values.4).bind(values.1).bind(values.2).bind(values.7).bind(values.5).bind(values.6).bind(values.8).execute(&pool).await.unwrap();
        }
        pool.close().await;
        let items = list_from(homes.clone(), HashSet::new(), HashSet::new())
            .await
            .unwrap();
        assert_eq!(items.len(), 4);
        assert_eq!(
            items
                .iter()
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>(),
            ["No user", "Named", "First prompt", "(no messages)"]
        );
        assert_eq!(items[1].time_created, 1000);
        assert_eq!(items[1].time_updated, 3000);
        fs::remove_dir_all(homes.trae_home).unwrap();
    }

    #[tokio::test]
    async fn lookup_requires_trusted_cwd_and_rollout() {
        let homes = temporary_homes();
        let cwd = homes.trae_home.join("work");
        fs::create_dir(&cwd).unwrap();
        let rollout = homes.cli_home.join("sessions/session.jsonl");
        fs::write(&rollout, "{}\n").unwrap();
        let id = Uuid::new_v4().to_string();
        let pool = database(&homes, true).await;
        sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, first_user_message, archived) VALUES (?, ?, 1, 1, ?, '', '', 0)")
            .bind(&id).bind(path_string(&rollout)).bind(path_string(&cwd)).execute(&pool).await.unwrap();
        pool.close().await;
        let record = lookup(homes.clone(), id.clone()).await.unwrap();
        assert_eq!(record.path, fs::canonicalize(&rollout).unwrap());
        assert_eq!(record.cwd, fs::canonicalize(&cwd).unwrap());
        let outside = homes.trae_home.join("outside.jsonl");
        fs::write(&outside, "{}\n").unwrap();
        let writable = SqlitePoolOptions::new()
            .connect_with(
                SqliteConnectOptions::new().filename(homes.cli_home.join("state_5.sqlite")),
            )
            .await
            .unwrap();
        sqlx::query("UPDATE threads SET rollout_path = ? WHERE id = ?")
            .bind(path_string(outside))
            .bind(&id)
            .execute(&writable)
            .await
            .unwrap();
        writable.close().await;
        assert_eq!(
            lookup(homes.clone(), id).await.unwrap_err(),
            HistoryError::NotFound
        );
        fs::remove_dir_all(homes.trae_home).unwrap();
    }

    #[tokio::test]
    async fn prepares_new_and_resume_and_builds_delete_arguments() {
        let new_homes = temporary_homes();
        assert!(
            matches!(prepare_from(new_homes.clone(), None).await.unwrap(), PreparedLaunch::TraeNew { id } if valid_session_id(&id))
        );
        fs::remove_dir_all(new_homes.trae_home).unwrap();
        let homes = temporary_homes();
        let cwd = homes.trae_home.join("work");
        fs::create_dir(&cwd).unwrap();
        let rollout = homes.cli_home.join("sessions/session.jsonl");
        fs::write(&rollout, "{}\n").unwrap();
        let id = Uuid::new_v4().to_string();
        let pool = database(&homes, true).await;
        sqlx::query("INSERT INTO threads (id, rollout_path, created_at, updated_at, cwd, title, first_user_message, archived) VALUES (?, ?, 1, 1, ?, '', '', 0)")
            .bind(&id)
            .bind(path_string(&rollout))
            .bind(path_string(&cwd))
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(
            matches!(prepare_from(homes.clone(), Some(&id)).await.unwrap(), PreparedLaunch::TraeResume { id: prepared_id, path, cwd: prepared_cwd } if prepared_id == id && path == fs::canonicalize(&rollout).unwrap() && prepared_cwd == fs::canonicalize(&cwd).unwrap())
        );
        assert_eq!(delete_args("id"), ["delete", "--force", "id"]);
        fs::remove_dir_all(homes.trae_home).unwrap();
    }
}
