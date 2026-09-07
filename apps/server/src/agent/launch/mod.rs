use std::{
    env,
    ffi::OsString,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use portable_pty::CommandBuilder;
use uuid::Uuid;

mod workspace;

use super::{
    AgentKind, CODEX_ID, CODEX_NAME, OPENCODE_ID, OPENCODE_NAME, PI_ID, PI_NAME, TRAECLI_ID,
    TRAECLI_NAME,
    runtime::events::start_event_watcher,
    runtime_input::{configure_pi_endpoint, prepare_opencode},
};
use crate::{
    filesystem::{default_cwd, resolve_path},
    launch_config::AgentLaunchConfig,
    session::{Session, SessionKind, SessionSpawn, dimension},
    state::AppState,
    terminal::{CreateRequest, configure_environment},
};
use workspace::{
    copy_skills, create_run_dir, prepare_codex_home, prepare_trae_home,
    write_pi_identity_extension, write_wrapper,
};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

pub(super) fn available(kind: AgentKind) -> bool {
    executable_path(kind.as_str()).is_some()
}

pub(super) async fn installed_version(kind: AgentKind) -> Option<String> {
    let executable_name = kind.as_str();
    let executable = executable_path(executable_name)?;
    let mut command = tokio::process::Command::new(executable);
    crate::process::configure_tokio_command(&mut command);
    let output = tokio::time::timeout(Duration::from_secs(2), command.arg("--version").output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let prefix = match kind {
        AgentKind::Codex => "codex-cli",
        AgentKind::OpenCode => "opencode",
        AgentKind::TraeCli => "traecli",
        AgentKind::Pi => "pi",
    };
    let version = version
        .strip_prefix(prefix)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&version)
        .to_string();
    (!version.is_empty()).then_some(version)
}

pub(super) fn supports_image_paste(kind: AgentKind, version: Option<&str>) -> bool {
    match kind {
        AgentKind::OpenCode | AgentKind::Pi => true,
        AgentKind::Codex => version.is_some_and(|value| version_at_least(value, [0, 149, 1])),
        AgentKind::TraeCli => version.is_some_and(|value| version_at_least(value, [0, 202, 1])),
    }
}

fn version_at_least(version: &str, minimum: [u64; 3]) -> bool {
    let version = version
        .strip_suffix("(internal edition)")
        .map(str::trim)
        .unwrap_or(version);
    let mut parts = version.split('.');
    let current = [parts.next(), parts.next(), parts.next()]
        .map(|part| part.and_then(|value| value.parse::<u64>().ok()));
    parts.next().is_none()
        && current
            .into_iter()
            .collect::<Option<Vec<_>>>()
            .is_some_and(|current| current.as_slice() >= minimum.as_slice())
}

pub(crate) fn executable_path(executable: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|path| path.join(executable))
            .find_map(|path| {
                path.is_file()
                    .then(|| std::fs::canonicalize(path).ok())
                    .flatten()
            })
    })
}

pub(super) fn spawn_codex(
    state: Arc<AppState>,
    request: CreateRequest,
    home: PathBuf,
    resume: Option<(String, PathBuf)>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_path(requested_cwd)?;
    if !cwd.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cwd").into());
    }
    let executable = executable_path(CODEX_ID).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "codex executable not found")
    })?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let runtime_home = if let Some(generation) = skill_generation {
        match prepare_codex_home(&run_dir, generation, &home) {
            Ok(runtime_home) => runtime_home,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&run_dir);
                return Err(error.into());
            }
        }
    } else {
        home.clone()
    };
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, true) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    let arguments = match codex_args(
        resume.as_ref().map(|value| value.0.as_str()),
        &home,
        skill_generation.is_some(),
    ) {
        Ok(arguments) => arguments,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(error.into());
        }
    };
    for argument in arguments {
        command.arg(argument);
    }
    configure_environment(&mut command, &cwd);
    command.env("CODEX_HOME", &runtime_home);
    command.env("DEVHATCH_AGENT_ID", CODEX_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    let cleanup_path = run_dir.clone();
    let runtime = resume.clone();
    let runtime_cwd = cwd.clone();
    let result = Session::spawn(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id: resume.as_ref().map(|value| value.0.clone()),
            pending_upstream_session_id: None,
            cwd,
            name: CODEX_NAME.to_string(),
            cols,
            rows,
            agent_id: Some(CODEX_ID),
            agent_name: Some(CODEX_NAME),
            cleanup_path: Some(cleanup_path),
            runtime_endpoint: None,
            exit_cleanup: Some(state.agent_exit_cleanup()),
        },
        move |session| {
            if let Some((id, path)) = &runtime {
                session.update_runtime_identity(
                    id.clone(),
                    Some(path.clone()),
                    Some(runtime_cwd.clone()),
                );
            }
        },
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(run_dir);
    }
    result
}

fn codex_args(
    id: Option<&str>,
    base_home: &Path,
    selected_profile: bool,
) -> std::io::Result<Vec<OsString>> {
    let mut arguments = Vec::new();
    if selected_profile {
        let home = base_home.to_str().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Codex home is not valid UTF-8",
            )
        })?;
        let sqlite_home = serde_json::to_string(home).map_err(std::io::Error::other)?;
        let log_dir = serde_json::to_string(base_home.join("log").to_str().ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Codex log path is not valid UTF-8",
            )
        })?)
        .map_err(std::io::Error::other)?;
        arguments.extend([
            OsString::from("-c"),
            OsString::from(format!("sqlite_home={sqlite_home}")),
            OsString::from("-c"),
            OsString::from(format!("log_dir={log_dir}")),
            OsString::from("--disable"),
            OsString::from("plugins"),
        ]);
    }
    if let Some(id) = id {
        arguments.extend([OsString::from("resume"), OsString::from(id)]);
    }
    Ok(arguments)
}

pub(super) fn spawn_opencode(
    state: Arc<AppState>,
    request: CreateRequest,
    upstream_session_id: Option<String>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_path(requested_cwd)?;
    if !cwd.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cwd").into());
    }
    let executable = executable_path("opencode").ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "opencode executable not found",
        )
    })?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    if let Some(generation) = skill_generation
        && let Err(error) = copy_skills(&run_dir, generation)
    {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config, skill_generation.is_some(), false) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    let event_endpoint = match configure_command(&mut command, upstream_session_id.as_ref()) {
        Ok(endpoint) => endpoint,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(error.into());
        }
    };
    configure_environment(&mut command, &cwd);
    if let Err(error) = prepare_opencode(&run_dir, &mut command) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    command.env("DEVHATCH_AGENT_ID", OPENCODE_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    command.env_remove("OPENCODE_CONFIG");
    command.env_remove("OPENCODE_CONFIG_CONTENT");
    command.env_remove("OPENCODE_CONFIG_DIR");
    command.env_remove("BYTE_API_API_KEY");
    command.env_remove("BYTE_API_PROVIDER_ID");
    command.env_remove("BYTE_API_SERVER_URL");
    if skill_generation.is_some() {
        command.env("OPENCODE_CONFIG_DIR", &run_dir);
    }
    let endpoint = event_endpoint.clone();
    let runtime_endpoint =
        event_endpoint
            .as_ref()
            .map(|(port, password)| crate::session::RuntimeEndpoint {
                port: *port,
                password: password.clone(),
            });
    let app_state = state.clone();
    let cleanup_path = run_dir.clone();
    let result = Session::spawn(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id,
            pending_upstream_session_id: None,
            cwd,
            name: OPENCODE_NAME.to_string(),
            cols,
            rows,
            agent_id: Some(OPENCODE_ID),
            agent_name: Some(OPENCODE_NAME),
            cleanup_path: Some(cleanup_path),
            runtime_endpoint,
            exit_cleanup: Some(state.agent_exit_cleanup()),
        },
        move |session| {
            if let Some((port, password)) = endpoint {
                start_event_watcher(session, app_state.clone(), port, password);
            }
        },
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(run_dir);
    }
    result
}

pub(super) fn spawn_traecli(
    state: Arc<AppState>,
    request: CreateRequest,
    session_id: String,
    history_path: Option<&Path>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_path(requested_cwd)?;
    if !cwd.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cwd").into());
    }
    let executable = executable_path("traecli").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "traecli executable not found")
    })?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, false) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    for argument in trae_args(&session_id, history_path) {
        command.arg(argument);
    }
    configure_environment(&mut command, &cwd);
    command.env("DEVHATCH_AGENT_ID", TRAECLI_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    let homes = crate::history::trae::resolve_homes();
    let mut runtime_homes = homes.clone();
    command.env("TRAE_HOME", &homes.trae_home);
    command.env("TRAECLI_HOME", &homes.cli_home);
    if let Some(generation) = skill_generation {
        let (trae_home, cli_home) = match prepare_trae_home(&run_dir, generation) {
            Ok(value) => value,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&run_dir);
                return Err(error.into());
            }
        };
        command.env("TRAE_HOME", &trae_home);
        command.env("TRAECLI_HOME", &cli_home);
        runtime_homes = crate::history::trae::TraeHomes {
            trae_home,
            cli_home,
        };
    }
    let cleanup_path = run_dir.clone();
    let resume_path = history_path.map(Path::to_path_buf);
    let is_resume = resume_path.is_some();
    let runtime_identity = is_resume.then(|| session_id.clone());
    let runtime_correlation = session_id.clone();
    let runtime_cwd = cwd.clone();
    let watcher_state = state.clone();
    let result = Session::spawn(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id: runtime_identity.clone(),
            pending_upstream_session_id: (!is_resume).then(|| runtime_correlation.clone()),
            cwd,
            name: TRAECLI_NAME.to_string(),
            cols,
            rows,
            agent_id: Some(TRAECLI_ID),
            agent_name: Some(TRAECLI_NAME),
            cleanup_path: Some(cleanup_path),
            runtime_endpoint: None,
            exit_cleanup: Some(state.agent_exit_cleanup()),
        },
        move |session| {
            if let (Some(path), Some(id)) = (resume_path, runtime_identity) {
                session.update_runtime_identity(id, Some(path), Some(runtime_cwd.clone()));
            } else {
                start_trae_identity_watcher(
                    session,
                    watcher_state,
                    runtime_homes,
                    runtime_correlation,
                );
            }
        },
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(run_dir);
    }
    result
}

fn trae_args(session_id: &str, history_path: Option<&Path>) -> Vec<OsString> {
    match history_path {
        Some(_) => vec![OsString::from("resume"), OsString::from(session_id)],
        None => vec![OsString::from("--session-id"), OsString::from(session_id)],
    }
}

fn start_trae_identity_watcher(
    session: &Arc<Session>,
    state: Arc<AppState>,
    homes: crate::history::trae::TraeHomes,
    thread_name: String,
) {
    let session = Arc::downgrade(session);
    tokio::spawn(async move {
        for _ in 0..60 {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let Some(session) = session.upgrade() else {
                break;
            };
            if session.is_deleting()
                || session.upstream_session_id().is_some()
                || !state.contains_session(&session)
            {
                break;
            }
            let record =
                crate::history::trae::lookup_thread_name(homes.clone(), thread_name.clone()).await;
            let Ok(record) = record else {
                continue;
            };
            let _history_guard = state.history_reconciliation().lock().await;
            if session.is_deleting()
                || session.upstream_session_id().is_some()
                || !state.contains_session(&session)
            {
                break;
            }
            let claimed = state.active_upstream_session_ids_for(TRAECLI_ID);
            if state.history_deletion_pending(TRAECLI_ID, &record.id)
                || claimed.contains(&record.id)
            {
                break;
            }
            session.update_runtime_identity(record.id, Some(record.path), Some(record.cwd));
            break;
        }
    });
}

pub(super) fn spawn_pi(
    state: Arc<AppState>,
    request: CreateRequest,
    session_id: String,
    history_path: Option<&Path>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_path(requested_cwd)?;
    if !cwd.is_dir() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid cwd").into());
    }
    let executable = executable_path(PI_ID).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "pi executable not found")
    })?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    if let Some(generation) = skill_generation
        && let Err(error) = copy_skills(&run_dir, generation)
    {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let pi_skills = if skill_generation.is_some() {
        match std::fs::canonicalize(run_dir.join("skills")) {
            Ok(skills) => Some(skills),
            Err(error) => {
                let _ = std::fs::remove_dir_all(&run_dir);
                return Err(error.into());
            }
        }
    } else {
        None
    };
    let (identity_extension, identity_state) = match write_pi_identity_extension(&run_dir) {
        Ok(paths) => paths,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(error.into());
        }
    };
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, false) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    for argument in pi_args(
        &session_id,
        history_path,
        pi_skills.as_deref(),
        &identity_extension,
    ) {
        command.arg(argument);
    }
    configure_environment(&mut command, &cwd);
    let runtime_endpoint = match configure_pi_endpoint(&run_dir, &mut command) {
        Ok(endpoint) => Some(endpoint),
        Err(error) => {
            let _ = std::fs::remove_dir_all(&run_dir);
            return Err(error.into());
        }
    };
    command.env("DEVHATCH_AGENT_ID", PI_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    command.env("DEVHATCH_PI_STATE_FILE", &identity_state);
    let cleanup_path = run_dir.clone();
    let result = Session::spawn(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id: Some(session_id),
            pending_upstream_session_id: None,
            cwd,
            name: PI_NAME.to_string(),
            cols,
            rows,
            agent_id: Some(PI_ID),
            agent_name: Some(PI_NAME),
            cleanup_path: Some(cleanup_path),
            runtime_endpoint,
            exit_cleanup: Some(state.agent_exit_cleanup()),
        },
        move |session| start_pi_identity_watcher(session, state, identity_state),
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(run_dir);
    }
    result
}

fn pi_args(
    session_id: &str,
    history_path: Option<&Path>,
    skills: Option<&Path>,
    identity_extension: &Path,
) -> Vec<OsString> {
    let mut arguments = match history_path {
        Some(path) => vec![OsString::from("--session"), path.as_os_str().to_owned()],
        None => vec![OsString::from("--session-id"), OsString::from(session_id)],
    };
    arguments.extend([
        OsString::from("--extension"),
        identity_extension.as_os_str().to_owned(),
    ]);
    if let Some(skills) = skills {
        arguments.extend([
            OsString::from("--no-skills"),
            OsString::from("--skill"),
            skills.as_os_str().to_owned(),
        ]);
    }
    arguments
}

#[derive(serde::Deserialize, Debug, PartialEq)]
struct PiIdentityState {
    id: String,
    file: Option<PathBuf>,
    cwd: PathBuf,
}

fn parse_pi_identity_state(bytes: &[u8]) -> Option<PiIdentityState> {
    if bytes.len() > 16 * 1024 {
        return None;
    }
    let state: PiIdentityState = serde_json::from_slice(bytes).ok()?;
    if !crate::history::pi::valid_session_id(&state.id) || !state.cwd.is_absolute() {
        return None;
    }
    if state.file.as_ref().is_some_and(|path| !path.is_absolute()) {
        return None;
    }
    Some(state)
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

fn apply_pi_identity_state(session: &Session, state: PiIdentityState) {
    let file = state.file.as_deref().and_then(safe_runtime_file);
    session.update_runtime_identity(state.id, file, safe_runtime_cwd(&state.cwd));
}

fn start_pi_identity_watcher(session: &Arc<Session>, state: Arc<AppState>, path: PathBuf) {
    let session = Arc::downgrade(session);
    tokio::spawn(async move {
        let mut last = Vec::new();
        loop {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let Some(session) = session.upgrade() else {
                break;
            };
            if !state.contains_session(&session) {
                break;
            }
            let Ok(bytes) = tokio::fs::read(&path).await else {
                continue;
            };
            if bytes == last {
                continue;
            }
            last = bytes.clone();
            if let Some(identity) = parse_pi_identity_state(&bytes) {
                let _history_guard = state.history_reconciliation().lock().await;
                if state.contains_session(&session)
                    && !state.history_deletion_pending(PI_ID, &identity.id)
                {
                    apply_pi_identity_state(&session, identity);
                }
            }
        }
    });
}

fn configure_command(
    command: &mut CommandBuilder,
    upstream_session_id: Option<&String>,
) -> std::io::Result<Option<(u16, String)>> {
    if let Some(id) = upstream_session_id {
        command.arg("-s");
        command.arg(id);
    }
    let port = available_loopback_port()?;
    let password = Uuid::new_v4().to_string();
    command.arg("--hostname");
    command.arg("127.0.0.1");
    command.arg("--port");
    command.arg(port.to_string());
    command.env("OPENCODE_SERVER_USERNAME", "opencode");
    command.env("OPENCODE_SERVER_PASSWORD", &password);
    Ok(Some((port, password)))
}

fn available_loopback_port() -> std::io::Result<u16> {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?
        .local_addr()
        .map(|address| address.port())
}

#[cfg(test)]
mod tests {
    use std::{ffi::OsString, path::Path};

    use super::{
        codex_args, parse_pi_identity_state, pi_args, safe_runtime_cwd, supports_image_paste,
        trae_args,
    };
    use crate::agent::AgentKind;

    #[test]
    fn gates_terminal_image_paste_by_verified_version() {
        assert!(!supports_image_paste(AgentKind::Codex, Some("0.149.0")));
        assert!(supports_image_paste(AgentKind::Codex, Some("0.149.1")));
        assert!(!supports_image_paste(
            AgentKind::Codex,
            Some("0.149.1-beta")
        ));
        assert!(!supports_image_paste(
            AgentKind::Codex,
            Some("build 1 codex 0.149.1")
        ));
        assert!(!supports_image_paste(AgentKind::TraeCli, Some("0.202.0")));
        assert!(supports_image_paste(
            AgentKind::TraeCli,
            Some("0.202.1(internal edition)")
        ));
        assert!(supports_image_paste(AgentKind::OpenCode, None));
        assert!(supports_image_paste(AgentKind::Pi, None));
    }

    #[test]
    fn builds_codex_args_for_new_and_resume() {
        let home = Path::new("/home/user/.codex");
        assert!(codex_args(None, home, false).unwrap().is_empty());
        assert_eq!(
            codex_args(Some("session-id"), home, false).unwrap(),
            vec![OsString::from("resume"), OsString::from("session-id")]
        );
        let profile = vec![
            OsString::from("-c"),
            OsString::from("sqlite_home=\"/home/user/.codex\""),
            OsString::from("-c"),
            OsString::from("log_dir=\"/home/user/.codex/log\""),
            OsString::from("--disable"),
            OsString::from("plugins"),
        ];
        assert_eq!(codex_args(None, home, true).unwrap(), profile);
        let mut resumed = profile;
        resumed.extend([OsString::from("resume"), OsString::from("session-id")]);
        assert_eq!(codex_args(Some("session-id"), home, true).unwrap(), resumed);
        assert_eq!(
            codex_args(None, Path::new("/home/a\"b"), true).unwrap()[1],
            OsString::from("sqlite_home=\"/home/a\\\"b\"")
        );
    }

    #[test]
    fn builds_trae_args_for_new_and_resume() {
        assert_eq!(
            trae_args("new-id", None),
            vec![OsString::from("--session-id"), OsString::from("new-id")]
        );
        assert_eq!(
            trae_args("resume-id", Some(Path::new("/sessions/resume.jsonl"))),
            vec![OsString::from("resume"), OsString::from("resume-id")]
        );
    }

    #[test]
    fn builds_pi_args_for_new_resume_and_optional_profile_skills() {
        let extension = Path::new("/run/identity.mjs");
        assert_eq!(
            pi_args("new-id", None, None, extension),
            vec![
                OsString::from("--session-id"),
                OsString::from("new-id"),
                OsString::from("--extension"),
                OsString::from("/run/identity.mjs")
            ]
        );
        assert_eq!(
            pi_args(
                "ignored",
                Some(Path::new("/sessions/resume.jsonl")),
                Some(Path::new("/run/skills")),
                extension,
            ),
            vec![
                OsString::from("--session"),
                OsString::from("/sessions/resume.jsonl"),
                OsString::from("--extension"),
                OsString::from("/run/identity.mjs"),
                OsString::from("--no-skills"),
                OsString::from("--skill"),
                OsString::from("/run/skills")
            ]
        );
    }

    #[test]
    fn runtime_identity_accepts_only_safe_existing_cwd() {
        assert_eq!(safe_runtime_cwd(Path::new("relative")), None);
        assert!(safe_runtime_cwd(Path::new("/tmp")).is_some());
    }

    #[test]
    fn validates_pi_identity_state() {
        let state = parse_pi_identity_state(
            br#"{"id":"session-1","file":"/sessions/a.jsonl","cwd":"/tmp"}"#,
        )
        .unwrap();
        assert_eq!(state.id, "session-1");
        assert!(parse_pi_identity_state(br#"{"id":"../bad","cwd":"/tmp"}"#).is_none());
        assert!(parse_pi_identity_state(br#"{"id":"ok","cwd":"relative"}"#).is_none());
    }
}
