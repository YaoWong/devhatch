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
    runtime::activity::{
        ActivityBridge, IdentitySource, hook_override, supports_hooks, write_opencode_plugin,
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
        .map(|(_, version)| version)
}

pub(crate) async fn verified_executable(
    data_dir: &Path,
    kind: AgentKind,
) -> Option<(PathBuf, String)> {
    for executable in executable_candidates(data_dir, kind) {
        let Ok(output) = crate::process::command_output(
            tokio::process::Command::new(&executable).arg("--version"),
            Duration::from_secs(2),
            16 * 1024,
        )
        .await
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let Some(version) = parse_version(kind, &output.stdout) else {
            continue;
        };
        return Some((executable, version));
    }
    None
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

pub(super) fn version_at_least(version: &str, minimum: [u64; 3]) -> bool {
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

fn executable_candidates(data_dir: &Path, kind: AgentKind) -> Vec<PathBuf> {
    let mut candidates = path_executable(kind.as_str())
        .into_iter()
        .collect::<Vec<_>>();
    if let Some(managed) = managed_executable_path(data_dir, kind)
        && !candidates.contains(&managed)
    {
        candidates.push(managed);
    }
    candidates
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
    verified_executable: (PathBuf, String),
    request: CreateRequest,
    home: PathBuf,
    resume: Option<(String, PathBuf)>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let (executable, version) = verified_executable;
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
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, true) {
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
    executable: PathBuf,
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
    let cwd = resolve_agent_cwd(requested_cwd)?;
    let cols = dimension(request.cols.as_ref(), DEFAULT_COLS);
    let rows = dimension(request.rows.as_ref(), DEFAULT_ROWS);
    let run_dir = create_run_dir(state.data_dir())?;
    let mut run_dir_cleanup = RunDirCleanup::new(run_dir.clone());
    let session_id = Uuid::new_v4().to_string();
    let telemetry =
        ActivityBridge::prepare(&run_dir, &session_id, OPENCODE_ID, IdentitySource::OpenCode)
            .ok()
            .and_then(|bridge| {
                let plugin = write_opencode_plugin(&run_dir).ok()?;
                let server = std::env::current_exe().ok()?;
                let plugin_url = url::Url::from_file_path(plugin).ok()?;
                Some((bridge, server, plugin_url.to_string()))
            });
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
    command.env_remove("OPENCODE_CONFIG_DIR");
    command.env_remove("BYTE_API_API_KEY");
    command.env_remove("BYTE_API_PROVIDER_ID");
    command.env_remove("BYTE_API_SERVER_URL");
    if let Some((bridge, server, plugin_url)) = &telemetry {
        command.env("DEVHATCH_ACTIVITY_DESCRIPTOR", bridge.descriptor_path());
        command.env("DEVHATCH_SERVER_EXECUTABLE", server);
        command.env("DEVHATCH_OPENCODE_PLUGIN_URL", plugin_url);
        if let Some(id) = &upstream_session_id {
            command.env("DEVHATCH_OPENCODE_SESSION_ID", id);
        }
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
    let result = Session::spawn_with_id(
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
            if let Some((bridge, _, _)) = telemetry {
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

pub(super) fn spawn_traecli(
    state: Arc<AppState>,
    verified_executable: (PathBuf, String),
    request: CreateRequest,
    upstream_session_id: String,
    history_path: Option<&Path>,
    launch_config: AgentLaunchConfig,
    skill_generation: Option<&Path>,
) -> Result<Arc<Session>, Box<dyn std::error::Error>> {
    let (executable, version) = verified_executable;
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
    if let Err(error) = write_wrapper(&wrapper, &launch_config, false, false) {
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
    executable: PathBuf,
    request: CreateRequest,
    upstream_session_id: String,
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
    write_wrapper(&wrapper, &launch_config, false, false)?;
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

    use super::{codex_args, pi_args, resolve_agent_cwd, supports_image_paste, trae_args};
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
