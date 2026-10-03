use std::{
    env,
    ffi::OsString,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    os::unix::fs::{MetadataExt, PermissionsExt},
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
    runtime::{
        activity::{
            ActivityBridge, IdentitySource, hook_override, remove_opencode_plugin, supports_hooks,
            write_opencode_plugin,
        },
        events::start_event_watcher,
    },
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
    copy_skills, create_run_dir, prepare_codex_home, prepare_trae_home, write_pi_extension,
    write_wrapper,
};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

#[derive(Debug)]
pub(crate) struct VerifiedExecutable {
    pub(crate) path: PathBuf,
    pub(crate) version: String,
    pub(crate) opencode_v2: bool,
}

struct RunDirCleanup(Option<PathBuf>);

impl RunDirCleanup {
    fn new(path: PathBuf) -> Self {
        Self(Some(path))
    }

    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for RunDirCleanup {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn resolve_agent_cwd(value: &str) -> std::io::Result<PathBuf> {
    let cwd = resolve_path(value)?;
    if !cwd.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid cwd",
        ));
    }
    std::fs::canonicalize(cwd)
}

pub(super) async fn installed_version(data_dir: &Path, kind: AgentKind) -> Option<String> {
    verified_executable(data_dir, kind)
        .await
        .map(|verified| verified.version)
}

pub(crate) async fn verified_executable(
    data_dir: &Path,
    kind: AgentKind,
) -> Option<VerifiedExecutable> {
    let mut fallback = None;
    for executable in executable_candidates(data_dir, kind) {
        let Some(verified) = verify_executable(data_dir, executable, kind).await else {
            continue;
        };
        if kind != AgentKind::OpenCode || verified.opencode_v2 {
            return Some(verified);
        }
        fallback = Some(verified);
    }
    fallback
}

async fn verify_executable(
    data_dir: &Path,
    executable: PathBuf,
    kind: AgentKind,
) -> Option<VerifiedExecutable> {
    let output = if kind == AgentKind::OpenCode {
        isolated_opencode_output(data_dir, &executable, &["--version"]).await?
    } else {
        crate::process::command_output(
            tokio::process::Command::new(&executable).arg("--version"),
            Duration::from_secs(2),
            16 * 1024,
        )
        .await
        .ok()?
    };
    if !output.status.success() {
        return None;
    }
    let version = parse_version(kind, &output.stdout)?;
    let opencode_v2 = if kind == AgentKind::OpenCode {
        match opencode_generation(&version) {
            Some(generation) => generation,
            None => probe_local_opencode_v2(data_dir, &executable).await?,
        }
    } else {
        false
    };
    Some(VerifiedExecutable {
        path: executable,
        version,
        opencode_v2,
    })
}

#[cfg(target_os = "linux")]
pub(super) async fn isolated_opencode_output(
    data_dir: &Path,
    executable: &Path,
    arguments: &[&str],
) -> Option<std::process::Output> {
    let probe_dir = create_run_dir(data_dir).ok()?;
    let _cleanup = RunDirCleanup::new(probe_dir.clone());
    let directories = [
        ("home", "HOME"),
        ("data", "XDG_DATA_HOME"),
        ("config", "XDG_CONFIG_HOME"),
        ("cache", "XDG_CACHE_HOME"),
        ("state", "XDG_STATE_HOME"),
        ("runtime", "XDG_RUNTIME_DIR"),
        ("tmp", "TMPDIR"),
    ];
    for (name, _) in directories {
        let path = probe_dir.join(name);
        std::fs::create_dir(&path).ok()?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).ok()?;
    }
    let mut command = tokio::process::Command::new("/usr/bin/unshare");
    command
        .args(["--user", "--map-root-user", "--net", "--"])
        .arg(executable)
        .args(arguments)
        .env_clear()
        .env(
            "PATH",
            env::var_os("PATH").unwrap_or_else(|| OsString::from("/usr/bin:/bin")),
        )
        .env("LANG", "C.UTF-8")
        .env("TERM", "dumb");
    for (name, variable) in directories {
        command.env(variable, probe_dir.join(name));
    }
    crate::process::command_output(&mut command, Duration::from_secs(2), 16 * 1024)
        .await
        .ok()
}

#[cfg(not(target_os = "linux"))]
pub(super) async fn isolated_opencode_output(
    _: &Path,
    _: &Path,
    _: &[&str],
) -> Option<std::process::Output> {
    None
}

async fn probe_local_opencode_v2(data_dir: &Path, executable: &Path) -> Option<bool> {
    let output =
        isolated_opencode_output(data_dir, executable, &["session", "delete", "--help"]).await?;
    if !output.status.success() {
        return None;
    }
    classify_opencode_help(&[output.stdout, output.stderr].concat())
}

fn classify_opencode_help(output: &[u8]) -> Option<bool> {
    let help = String::from_utf8_lossy(output);
    let has_option = |option: &str| {
        help.lines().any(|line| {
            line.trim_start()
                .strip_prefix(option)
                .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with(char::is_whitespace))
        })
    };
    match (has_option("--standalone"), has_option("--pure")) {
        (true, false) => Some(true),
        (false, true) => Some(false),
        _ => None,
    }
}

fn parse_version(kind: AgentKind, output: &[u8]) -> Option<String> {
    let version = String::from_utf8_lossy(output).trim().to_string();
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
        .unwrap_or(&version);
    let version = version.strip_prefix('v').unwrap_or(version).to_string();
    (!version.is_empty()).then_some(version)
}

pub(super) fn supports_image_paste(kind: AgentKind, version: Option<&str>) -> bool {
    match kind {
        AgentKind::OpenCode | AgentKind::Pi => true,
        AgentKind::Codex => version.is_some_and(|value| version_at_least(value, [0, 149, 1])),
        AgentKind::TraeCli => version.is_some_and(|value| version_at_least(value, [0, 202, 1])),
    }
}

fn opencode_generation(version: &str) -> Option<bool> {
    match version
        .trim()
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .next()
        .and_then(|major| major.parse::<u64>().ok())
    {
        Some(major) if major >= 2 => Some(true),
        Some(1) => Some(false),
        _ => None,
    }
}

#[cfg(test)]
pub(crate) fn opencode_v2(version: &str) -> bool {
    opencode_generation(version) == Some(true)
}

pub(crate) fn version_at_least(version: &str, minimum: [u64; 3]) -> bool {
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

pub(crate) fn managed_agent_prefix(data_dir: &Path, kind: AgentKind) -> PathBuf {
    data_dir.join("agent-clis").join(kind.as_str())
}

fn ordered_executable_candidates(
    kind: AgentKind,
    managed: Option<PathBuf>,
    path: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = if kind == AgentKind::OpenCode {
        managed.into_iter().chain(path).collect::<Vec<_>>()
    } else {
        path.into_iter().chain(managed).collect::<Vec<_>>()
    };
    candidates.dedup();
    candidates
}

fn executable_candidates(data_dir: &Path, kind: AgentKind) -> Vec<PathBuf> {
    ordered_executable_candidates(
        kind,
        managed_executable_path(data_dir, kind),
        path_executable(kind.as_str()),
    )
}

fn managed_executable_path(data_dir: &Path, kind: AgentKind) -> Option<PathBuf> {
    executable_in_prefix(&managed_agent_prefix(data_dir, kind), kind.as_str())
}

pub(crate) fn executable_in_prefix(prefix: &Path, executable: &str) -> Option<PathBuf> {
    let prefix_metadata = std::fs::symlink_metadata(prefix).ok()?;
    if prefix_metadata.file_type().is_symlink()
        || !prefix_metadata.is_dir()
        || prefix_metadata.uid() != unsafe { libc::geteuid() }
        || prefix_metadata.permissions().mode() & 0o022 != 0
    {
        return None;
    }
    let prefix = std::fs::canonicalize(prefix).ok()?;
    let executable = std::fs::canonicalize(prefix.join("bin").join(executable)).ok()?;
    if !executable.starts_with(&prefix) {
        return None;
    }
    let metadata = std::fs::metadata(&executable).ok()?;
    (metadata.is_file()
        && metadata.uid() == unsafe { libc::geteuid() }
        && metadata.permissions().mode() & 0o111 != 0
        && metadata.permissions().mode() & 0o022 == 0)
        .then_some(executable)
}

fn path_executable(executable: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|path| path.join(executable))
            .find_map(|path| {
                let metadata = std::fs::metadata(&path).ok()?;
                (metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
                    .then(|| std::fs::canonicalize(path).ok())
                    .flatten()
            })
    })
}

pub(super) fn spawn_codex(
    state: Arc<AppState>,
    verified_executable: VerifiedExecutable,
    request: CreateRequest,
    home: PathBuf,
    resume: Option<(String, PathBuf)>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let VerifiedExecutable {
        path: executable,
        version,
        ..
    } = verified_executable;
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_agent_cwd(requested_cwd)?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let mut run_dir_cleanup = RunDirCleanup::new(run_dir.clone());
    let session_id = Uuid::new_v4().to_string();
    let server_executable = supports_hooks(CODEX_ID, &version)
        .then(std::env::current_exe)
        .and_then(Result::ok);
    let bridge = server_executable.as_ref().and_then(|_| {
        ActivityBridge::prepare(
            &run_dir,
            &session_id,
            CODEX_ID,
            IdentitySource::Codex { home: home.clone() },
        )
        .ok()
    });
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
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, true, false, false) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    let activity_hook = bridge.as_ref().and_then(|bridge| {
        server_executable
            .as_deref()
            .and_then(|server| hook_override(CODEX_ID, server, bridge.descriptor_path()))
    });
    let arguments = match codex_args(
        resume.as_ref().map(|value| value.0.as_str()),
        &home,
        skill_generation.is_some(),
        activity_hook.as_deref(),
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
    if let Some(bridge) = &bridge {
        command.env("DEVHATCH_ACTIVITY_DESCRIPTOR", bridge.descriptor_path());
    }
    let cleanup_path = run_dir.clone();
    let runtime = resume.clone();
    let runtime_cwd = cwd.clone();
    let bridge_state = state.clone();
    let result = Session::spawn_with_id(
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
            if let Some(bridge) = bridge {
                bridge.start(session, bridge_state);
            }
        },
        session_id,
    );
    if result.is_ok() {
        run_dir_cleanup.disarm();
    }
    result
}

fn codex_args(
    id: Option<&str>,
    base_home: &Path,
    selected_profile: bool,
    activity_hook: Option<&str>,
) -> std::io::Result<Vec<OsString>> {
    let mut arguments = Vec::new();
    if let Some(hooks) = activity_hook {
        arguments.extend([OsString::from("-c"), OsString::from(hooks)]);
    }
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
    verified_executable: VerifiedExecutable,
    request: CreateRequest,
    upstream_session_id: Option<String>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let VerifiedExecutable {
        path: executable,
        opencode_v2,
        ..
    } = verified_executable;
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_agent_cwd(requested_cwd)?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let mut run_dir_cleanup = RunDirCleanup::new(run_dir.clone());
    let session_id = Uuid::new_v4().to_string();
    let telemetry = prepare_opencode_telemetry(&run_dir, &session_id, opencode_v2);
    if let Some(generation) = skill_generation
        && let Err(error) = copy_skills(&run_dir, generation)
    {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(
        &wrapper,
        &launch_config,
        skill_generation.is_some(),
        false,
        true,
        opencode_v2,
    ) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    if let Err(error) = sanitize_opencode_environment(&mut command) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    command.arg(&wrapper);
    command.arg(&executable);
    let event_endpoint =
        match configure_opencode_command(&mut command, opencode_v2, upstream_session_id.as_deref())
        {
            Ok(endpoint) => endpoint,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&run_dir);
                return Err(error.into());
            }
        };
    configure_environment(&mut command, &cwd);
    if let Err(error) = prepare_opencode_runtime(&run_dir, &mut command, opencode_v2) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    command.env("DEVHATCH_AGENT_ID", OPENCODE_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    command.env("DEVHATCH_OPENCODE_DB", state.opencode_database_path());
    command.env_remove("OPENCODE_CONFIG");
    command.env_remove("OPENCODE_CONFIG_DIR");
    command.env_remove("BYTE_API_API_KEY");
    command.env_remove("BYTE_API_PROVIDER_ID");
    command.env_remove("BYTE_API_SERVER_URL");
    if let Some((bridge, server, plugin_url)) = &telemetry {
        command.env("DEVHATCH_ACTIVITY_DESCRIPTOR", bridge.descriptor_path());
        command.env("DEVHATCH_SERVER_EXECUTABLE", server);
        command.env("DEVHATCH_OPENCODE_PLUGIN_URL", plugin_url);
        command.env(
            "DEVHATCH_OPENCODE_PLUGIN_KEY",
            if opencode_v2 { "plugins" } else { "plugin" },
        );
    }
    if skill_generation.is_some() {
        command.env("OPENCODE_CONFIG_DIR", &run_dir);
    }
    let runtime_endpoint =
        event_endpoint
            .as_ref()
            .map(|(port, password)| crate::session::RuntimeEndpoint {
                port: *port,
                password: password.clone(),
            });
    let bridge_state = state.clone();
    let cleanup_path = run_dir.clone();
    let spawn = SessionSpawn {
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
    };
    let started = move |session: &Arc<Session>| {
        if opencode_v2 {
            crate::history::opencode::watch_lineage_initialization(session, bridge_state.clone());
            if let Some((bridge, _, _)) = telemetry {
                bridge.start(session, bridge_state);
            }
        } else if let Some((port, password)) = event_endpoint {
            start_event_watcher(session, bridge_state, port, password);
        }
    };
    let result = Session::spawn_with_id(state.session_registry(), spawn, started, session_id);
    if result.is_ok() {
        run_dir_cleanup.disarm();
    }
    result
}

pub(super) fn spawn_traecli(
    state: Arc<AppState>,
    verified_executable: VerifiedExecutable,
    request: CreateRequest,
    upstream_session_id: String,
    history_path: Option<&Path>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let VerifiedExecutable {
        path: executable,
        version,
        ..
    } = verified_executable;
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_agent_cwd(requested_cwd)?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let mut run_dir_cleanup = RunDirCleanup::new(run_dir.clone());
    let wrapper = run_dir.join("launch.sh");
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, false, false, false) {
        let _ = std::fs::remove_dir_all(&run_dir);
        return Err(error.into());
    }
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
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
    let devhatch_session_id = Uuid::new_v4().to_string();
    let server_executable = supports_hooks(TRAECLI_ID, &version)
        .then(std::env::current_exe)
        .and_then(Result::ok);
    let bridge = server_executable.as_ref().and_then(|_| {
        ActivityBridge::prepare(
            &run_dir,
            &devhatch_session_id,
            TRAECLI_ID,
            IdentitySource::Trae {
                homes: runtime_homes,
            },
        )
        .ok()
    });
    let activity_hook = bridge.as_ref().and_then(|bridge| {
        server_executable
            .as_deref()
            .and_then(|server| hook_override(TRAECLI_ID, server, bridge.descriptor_path()))
    });
    for argument in trae_args(&upstream_session_id, history_path, activity_hook.as_deref()) {
        command.arg(argument);
    }
    if let Some(bridge) = &bridge {
        command.env("DEVHATCH_ACTIVITY_DESCRIPTOR", bridge.descriptor_path());
    }
    let cleanup_path = run_dir.clone();
    let resume_path = history_path.map(Path::to_path_buf);
    let is_resume = resume_path.is_some();
    let runtime_identity = is_resume.then(|| upstream_session_id.clone());
    let runtime_cwd = cwd.clone();
    let bridge_state = state.clone();
    let result = Session::spawn_with_id(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id: runtime_identity.clone(),
            pending_upstream_session_id: (!is_resume).then(|| upstream_session_id.clone()),
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
                session.update_runtime_identity(id, Some(path), Some(runtime_cwd));
            }
            if let Some(bridge) = bridge {
                bridge.start(session, bridge_state);
            }
        },
        devhatch_session_id,
    );
    if result.is_ok() {
        run_dir_cleanup.disarm();
    }
    result
}

fn trae_args(
    session_id: &str,
    history_path: Option<&Path>,
    activity_hook: Option<&str>,
) -> Vec<OsString> {
    let mut arguments = Vec::new();
    if let Some(hooks) = activity_hook {
        arguments.extend([OsString::from("-c"), OsString::from(hooks)]);
    }
    match history_path {
        Some(_) => arguments.extend([OsString::from("resume"), OsString::from(session_id)]),
        None => arguments.extend([OsString::from("--session-id"), OsString::from(session_id)]),
    }
    arguments
}

pub(super) fn spawn_pi(
    state: Arc<AppState>,
    verified_executable: VerifiedExecutable,
    request: CreateRequest,
    upstream_session_id: String,
    history_path: Option<&Path>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let executable = verified_executable.path;
    let fallback_cwd = default_cwd();
    let requested_cwd = request
        .cwd
        .as_ref()
        .and_then(serde_json::Value::as_str)
        .unwrap_or(&fallback_cwd);
    let cwd = resolve_agent_cwd(requested_cwd)?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let mut run_dir_cleanup = RunDirCleanup::new(run_dir.clone());
    if let Some(generation) = skill_generation {
        copy_skills(&run_dir, generation)?;
    }
    let pi_skills = skill_generation
        .is_some()
        .then(|| std::fs::canonicalize(run_dir.join("skills")))
        .transpose()?;
    let devhatch_session_id = Uuid::new_v4().to_string();
    let bridge =
        ActivityBridge::prepare(&run_dir, &devhatch_session_id, PI_ID, IdentitySource::Pi).ok();
    let extension = write_pi_extension(&run_dir).ok();
    let wrapper = run_dir.join("launch.sh");
    write_wrapper(&wrapper, &launch_config, false, false, false, false)?;
    let shell = executable.to_string_lossy().into_owned();
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg(&wrapper);
    command.arg(&executable);
    for argument in pi_args(
        &upstream_session_id,
        history_path,
        pi_skills.as_deref(),
        extension.as_deref(),
    ) {
        command.arg(argument);
    }
    configure_environment(&mut command, &cwd);
    let runtime_endpoint = extension
        .as_ref()
        .map(|_| configure_pi_endpoint(&mut command))
        .transpose()?;
    command.env("DEVHATCH_AGENT_ID", PI_ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    if let Some(bridge) = &bridge {
        command.env("DEVHATCH_ACTIVITY_DESCRIPTOR", bridge.descriptor_path());
    }
    let cleanup_path = run_dir.clone();
    let resume_path = history_path.map(Path::to_path_buf);
    let runtime_id = upstream_session_id.clone();
    let runtime_cwd = cwd.clone();
    let bridge_state = state.clone();
    let result = Session::spawn_with_id(
        state.session_registry(),
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id: Some(upstream_session_id),
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
        move |session| {
            if let Some(path) = resume_path {
                session.update_runtime_identity(runtime_id, Some(path), Some(runtime_cwd));
            }
            if let Some(bridge) = bridge {
                bridge.start(session, bridge_state);
            }
        },
        devhatch_session_id,
    );
    if result.is_ok() {
        run_dir_cleanup.disarm();
    }
    result
}

fn pi_args(
    session_id: &str,
    history_path: Option<&Path>,
    skills: Option<&Path>,
    extension: Option<&Path>,
) -> Vec<OsString> {
    let mut arguments = match history_path {
        Some(path) => vec![OsString::from("--session"), path.as_os_str().to_owned()],
        None => vec![OsString::from("--session-id"), OsString::from(session_id)],
    };
    if let Some(extension) = extension {
        arguments.extend([
            OsString::from("--extension"),
            extension.as_os_str().to_owned(),
        ]);
    }
    if let Some(skills) = skills {
        arguments.extend([
            OsString::from("--no-skills"),
            OsString::from("--skill"),
            skills.as_os_str().to_owned(),
        ]);
    }
    arguments
}

fn sanitize_opencode_environment(command: &mut CommandBuilder) -> std::io::Result<()> {
    let inherited_runtime_bin = command.get_env("DEVHATCH_RUNTIME_BIN").map(PathBuf::from);
    let inherited_plugin_url = command
        .get_env("DEVHATCH_OPENCODE_PLUGIN_URL")
        .and_then(|value| value.to_str())
        .map(str::to_string);
    if let Some(path) = command.get_env("PATH") {
        let paths = env::split_paths(path)
            .filter(|path| Some(path) != inherited_runtime_bin.as_ref())
            .collect::<Vec<_>>();
        command.env(
            "PATH",
            env::join_paths(paths).map_err(std::io::Error::other)?,
        );
    }
    if let (Some(content), Some(plugin_url)) = (
        command
            .get_env("OPENCODE_CONFIG_CONTENT")
            .and_then(|value| value.to_str()),
        inherited_plugin_url.as_deref(),
    ) {
        let sanitized = remove_opencode_plugin(content, plugin_url).map_err(|error| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string())
        })?;
        if sanitized.is_empty() {
            command.env_remove("OPENCODE_CONFIG_CONTENT");
        } else {
            command.env("OPENCODE_CONFIG_CONTENT", sanitized);
        }
    }
    for variable in [
        "DEVHATCH_RUNTIME_BIN",
        "DEVHATCH_IMAGE_CLIPBOARD_DIR",
        "DEVHATCH_ACTIVITY_DESCRIPTOR",
        "DEVHATCH_SERVER_EXECUTABLE",
        "DEVHATCH_OPENCODE_PLUGIN_URL",
        "DEVHATCH_OPENCODE_PLUGIN_KEY",
        "DEVHATCH_OPENCODE_DB",
        "DEVHATCH_OPENCODE_SESSION_ID",
        "DEVHATCH_PI_IMAGE_PASSWORD",
        "OPENCODE_SERVER_USERNAME",
        "OPENCODE_SERVER_PASSWORD",
    ] {
        command.env_remove(variable);
    }
    Ok(())
}

fn prepare_opencode_telemetry(
    run_dir: &Path,
    session_id: &str,
    v2: bool,
) -> Option<(ActivityBridge, PathBuf, String)> {
    if !v2 {
        return None;
    }
    let bridge =
        ActivityBridge::prepare(run_dir, session_id, OPENCODE_ID, IdentitySource::OpenCode).ok()?;
    let plugin = write_opencode_plugin(run_dir, true).ok()?;
    let server = std::env::current_exe().ok()?;
    let plugin_url = url::Url::from_file_path(plugin).ok()?;
    Some((bridge, server, plugin_url.to_string()))
}

fn prepare_opencode_runtime(
    run_dir: &Path,
    command: &mut CommandBuilder,
    v2: bool,
) -> std::io::Result<()> {
    if v2 {
        return Ok(());
    }
    prepare_opencode(run_dir, command)
}

fn configure_opencode_command(
    command: &mut CommandBuilder,
    v2: bool,
    upstream_session_id: Option<&str>,
) -> std::io::Result<Option<(u16, String)>> {
    if v2 {
        command.arg("--standalone");
        if let Some(id) = upstream_session_id {
            command.arg("--session");
            command.arg(id);
        }
        return Ok(None);
    }
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
        classify_opencode_help, codex_args, configure_opencode_command, opencode_generation,
        opencode_v2, ordered_executable_candidates, parse_version, pi_args,
        prepare_opencode_runtime, prepare_opencode_telemetry, probe_local_opencode_v2,
        resolve_agent_cwd, sanitize_opencode_environment, supports_image_paste, trae_args,
    };
    use crate::agent::AgentKind;

    #[cfg(unix)]
    #[test]
    fn canonicalizes_agent_working_directories() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let canonical = root.path().join("canonical");
        let alias = root.path().join("alias");
        std::fs::create_dir(&canonical).unwrap();
        symlink(&canonical, &alias).unwrap();

        assert_eq!(
            resolve_agent_cwd(alias.to_str().unwrap()).unwrap(),
            canonical
        );
    }

    #[test]
    fn prioritizes_managed_opencode_without_changing_other_agents() {
        let managed = std::path::PathBuf::from("/managed/opencode");
        let path = std::path::PathBuf::from("/path/opencode");
        assert_eq!(
            ordered_executable_candidates(
                AgentKind::OpenCode,
                Some(managed.clone()),
                Some(path.clone()),
            ),
            vec![managed.clone(), path.clone()]
        );
        assert_eq!(
            ordered_executable_candidates(AgentKind::Codex, Some(managed), Some(path.clone())),
            vec![path, std::path::PathBuf::from("/managed/opencode")]
        );
    }

    #[test]
    fn classifies_opencode_prerelease_and_unknown_versions() {
        assert_eq!(opencode_generation("1.18.34"), Some(false));
        assert_eq!(opencode_generation("2.3.4-beta.1"), Some(true));
        assert_eq!(opencode_generation("v2.0.20+local"), Some(true));
        assert_eq!(opencode_generation("3-dev"), Some(true));
        assert_eq!(opencode_generation("local"), None);
        assert_eq!(opencode_generation("0.0.0-preview-a-1234"), None);
        assert_eq!(opencode_generation("unknown"), None);
        assert!(!opencode_v2("0.0.0-preview-a-1234"));
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn probes_unknown_opencode_in_private_environment_and_network_namespace() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().unwrap();
        let host_namespace = std::fs::read_link("/proc/self/ns/net").unwrap();
        let marker = root.path().join("host-network-namespace");
        std::fs::write(&marker, host_namespace.as_os_str().as_encoded_bytes()).unwrap();
        let executable = root.path().join("opencode");
        let data_dir = root.path().join("data");
        std::fs::create_dir(&data_dir).unwrap();
        let script = format!(
            "#!/bin/sh\nset -eu\ncase \"$HOME\" in {}/agent-runs/*/home) ;; *) exit 1 ;; esac\nfor name in XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR TMPDIR; do eval value=\\\"\\$$name\\\"; case \"$value\" in {}/agent-runs/*) ;; *) exit 1 ;; esac; done\n[ -z \"${{CARGO_MANIFEST_DIR+x}}\" ]\n[ \"$(readlink /proc/self/ns/net)\" != \"$(cat {})\" ]\nprintf '%b' 'FLAGS\\n  --standalone\\n'\n",
            data_dir.display(),
            data_dir.display(),
            marker.display(),
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(
            probe_local_opencode_v2(&data_dir, &executable).await,
            Some(true)
        );
        assert!(
            std::fs::read_dir(data_dir.join("agent-runs"))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[test]
    fn classifies_opencode_delete_help_surface() {
        for (help, expected) in [
            (b"Options:\n  --pure\n".as_slice(), Some(false)),
            (b"FLAGS\n  --standalone\n".as_slice(), Some(true)),
            (b"FLAGS\n  --standalone-mode\n  --purely\n".as_slice(), None),
            (b"FLAGS\n  --standalone\n  --pure\n".as_slice(), None),
            (b"usage".as_slice(), None),
        ] {
            assert_eq!(classify_opencode_help(help), expected);
        }
    }

    #[test]
    fn normalizes_agent_version_output() {
        assert_eq!(
            parse_version(AgentKind::OpenCode, b"v2.0.20\n"),
            Some("2.0.20".into())
        );
        assert_eq!(
            parse_version(AgentKind::OpenCode, b"opencode 1.18.34\n"),
            Some("1.18.34".into())
        );
        assert_eq!(
            parse_version(AgentKind::OpenCode, b"local\n"),
            Some("local".into())
        );
        assert_eq!(
            parse_version(AgentKind::Codex, b"codex-cli 0.153.4\n"),
            Some("0.153.4".into())
        );
    }

    #[tokio::test]
    async fn prepares_v2_plugin_telemetry_without_a_v1_plugin_path() {
        let root = tempfile::tempdir().unwrap();
        let v1_dir = root.path().join("v1");
        let v2_dir = root.path().join("v2");
        std::fs::create_dir(&v1_dir).unwrap();
        std::fs::create_dir(&v2_dir).unwrap();

        assert!(
            prepare_opencode_telemetry(&v1_dir, &uuid::Uuid::new_v4().to_string(), false).is_none()
        );
        assert_eq!(std::fs::read_dir(&v1_dir).unwrap().count(), 0);

        let telemetry =
            prepare_opencode_telemetry(&v2_dir, &uuid::Uuid::new_v4().to_string(), true).unwrap();
        assert!(telemetry.0.descriptor_path().is_file());
        assert!(telemetry.2.starts_with("file://"));
        assert!(v2_dir.join("devhatch-opencode-plugin/server.mjs").is_file());
    }

    #[test]
    fn removes_inherited_opencode_runtime_injection_before_generation_setup() {
        let root = tempfile::tempdir().unwrap();
        let stale_runtime = root.path().join("stale-bin");
        let stale_plugin = "file:///tmp/stale-devhatch-plugin.mjs";
        let mut command = portable_pty::CommandBuilder::new("opencode");
        command.env(
            "PATH",
            std::env::join_paths([stale_runtime.as_path(), Path::new("/usr/bin")]).unwrap(),
        );
        command.env("DEVHATCH_RUNTIME_BIN", &stale_runtime);
        command.env("DEVHATCH_IMAGE_CLIPBOARD_DIR", "/tmp/stale-clipboard");
        command.env("DEVHATCH_ACTIVITY_DESCRIPTOR", "/tmp/stale-activity.json");
        command.env("DEVHATCH_SERVER_EXECUTABLE", "/tmp/stale-server");
        command.env("DEVHATCH_OPENCODE_PLUGIN_URL", stale_plugin);
        command.env("DEVHATCH_OPENCODE_PLUGIN_KEY", "plugin");
        command.env("DEVHATCH_OPENCODE_DB", "/tmp/stale.db");
        command.env("DEVHATCH_OPENCODE_SESSION_ID", "ses_stale");
        command.env("DEVHATCH_PI_IMAGE_PASSWORD", "stale");
        command.env("OPENCODE_SERVER_USERNAME", "stale");
        command.env("OPENCODE_SERVER_PASSWORD", "stale");
        command.env(
            "OPENCODE_CONFIG_CONTENT",
            format!("{{plugin: ['npm:user-plugin', '{stale_plugin}']}}"),
        );

        sanitize_opencode_environment(&mut command).unwrap();

        let path = command.get_env("PATH").unwrap();
        assert_eq!(
            std::env::split_paths(path).collect::<Vec<_>>(),
            [Path::new("/usr/bin")]
        );
        for variable in [
            "DEVHATCH_RUNTIME_BIN",
            "DEVHATCH_IMAGE_CLIPBOARD_DIR",
            "DEVHATCH_ACTIVITY_DESCRIPTOR",
            "DEVHATCH_SERVER_EXECUTABLE",
            "DEVHATCH_OPENCODE_PLUGIN_URL",
            "DEVHATCH_OPENCODE_PLUGIN_KEY",
            "DEVHATCH_OPENCODE_DB",
            "DEVHATCH_OPENCODE_SESSION_ID",
            "DEVHATCH_PI_IMAGE_PASSWORD",
            "OPENCODE_SERVER_USERNAME",
            "OPENCODE_SERVER_PASSWORD",
        ] {
            assert!(
                command.get_env(variable).is_none(),
                "{variable} was retained"
            );
        }
        let config: serde_json::Value = serde_json::from_str(
            command
                .get_env("OPENCODE_CONFIG_CONTENT")
                .unwrap()
                .to_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(config["plugin"], serde_json::json!(["npm:user-plugin"]));
    }

    #[test]
    fn rejects_unparseable_inherited_inline_config_without_discarding_it() {
        let stale_plugin = "file:///tmp/stale-devhatch-plugin.mjs";
        let mut command = portable_pty::CommandBuilder::new("opencode");
        command.env("DEVHATCH_OPENCODE_PLUGIN_URL", stale_plugin);
        command.env("OPENCODE_CONFIG_CONTENT", "{not valid");

        assert!(sanitize_opencode_environment(&mut command).is_err());
        assert_eq!(
            command.get_env("OPENCODE_CONFIG_CONTENT").unwrap(),
            "{not valid"
        );
    }

    #[test]
    fn prepares_legacy_opencode_image_bridge_for_v1_only() {
        let root = tempfile::tempdir().unwrap();
        let v1_dir = root.path().join("v1");
        let v2_dir = root.path().join("v2");
        std::fs::create_dir(&v1_dir).unwrap();
        std::fs::create_dir(&v2_dir).unwrap();

        let mut v1 = portable_pty::CommandBuilder::new("opencode");
        prepare_opencode_runtime(&v1_dir, &mut v1, false).unwrap();
        assert!(v1_dir.join("image-clipboard").is_dir());
        assert!(v1_dir.join("bin/wl-paste").is_file());
        let v1_debug = format!("{v1:?}");
        assert!(v1_debug.contains("DEVHATCH_IMAGE_CLIPBOARD_DIR"));
        assert!(v1_debug.contains("DEVHATCH_RUNTIME_BIN"));

        let mut v2 = portable_pty::CommandBuilder::new("opencode");
        prepare_opencode_runtime(&v2_dir, &mut v2, true).unwrap();
        assert!(!v2_dir.join("image-clipboard").exists());
        assert!(!v2_dir.join("bin").exists());
        let v2_debug = format!("{v2:?}");
        assert!(!v2_debug.contains("DEVHATCH_IMAGE_CLIPBOARD_DIR"));
        assert!(!v2_debug.contains("DEVHATCH_RUNTIME_BIN"));
    }

    #[test]
    fn builds_versioned_opencode_args() {
        let mut v1 = portable_pty::CommandBuilder::new("opencode");
        let endpoint = configure_opencode_command(&mut v1, false, Some("ses_v1"))
            .unwrap()
            .unwrap();
        assert_ne!(endpoint.0, 0);
        let v1_debug = format!("{v1:?}");
        assert!(v1_debug.contains("-s"));
        assert!(v1_debug.contains("--hostname"));
        assert!(v1_debug.contains("--port"));
        assert!(!v1_debug.contains("--standalone"));

        let mut v2 = portable_pty::CommandBuilder::new("opencode");
        assert!(
            configure_opencode_command(&mut v2, true, Some("ses_v2"))
                .unwrap()
                .is_none()
        );
        let v2_debug = format!("{v2:?}");
        assert!(v2_debug.contains("--standalone"));
        assert!(v2_debug.contains("--session"));
        assert!(!v2_debug.contains("--hostname"));
        assert!(!v2_debug.contains("--port"));
    }

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
        assert!(codex_args(None, home, false, None).unwrap().is_empty());
        assert_eq!(
            codex_args(Some("session-id"), home, false, None).unwrap(),
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
        assert_eq!(codex_args(None, home, true, None).unwrap(), profile);
        let mut resumed = profile;
        resumed.extend([OsString::from("resume"), OsString::from("session-id")]);
        assert_eq!(
            codex_args(Some("session-id"), home, true, None).unwrap(),
            resumed
        );
        assert_eq!(
            codex_args(None, Path::new("/home/a\"b"), true, None).unwrap()[1],
            OsString::from("sqlite_home=\"/home/a\\\"b\"")
        );
    }

    #[test]
    fn builds_trae_args_for_new_and_resume() {
        assert_eq!(
            trae_args("new-id", None, None),
            vec![OsString::from("--session-id"), OsString::from("new-id")]
        );
        assert_eq!(
            trae_args("resume-id", Some(Path::new("/sessions/resume.jsonl")), None),
            vec![OsString::from("resume"), OsString::from("resume-id")]
        );
    }

    #[test]
    fn builds_pi_args_for_new_resume_and_optional_profile_skills() {
        let extension = Path::new("/run/identity.mjs");
        assert_eq!(
            pi_args("new-id", None, None, Some(extension)),
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
                Some(extension),
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
}
