use std::{
    env,
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use portable_pty::CommandBuilder;
use uuid::Uuid;

use super::{
    ID, NAME,
    events::start_event_watcher,
    launch_workspace::{copy_skills, create_run_dir, write_wrapper},
};
use crate::{
    filesystem::{default_cwd, resolve_path},
    launch_config::AgentLaunchConfig,
    session::{Session, SessionKind, SessionSpawn, dimension},
    state::AppState,
    terminal::{CreateRequest, configure_environment},
};

const DEFAULT_COLS: u16 = 120;
const DEFAULT_ROWS: u16 = 32;

pub(super) fn available() -> bool {
    executable_path().is_some()
}

pub(super) async fn installed_version() -> Option<String> {
    let executable = executable_path()?;
    let output = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new(executable)
            .arg("--version")
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then_some(version)
}

fn executable_path() -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|path| path.join("opencode"))
            .find_map(|path| {
                path.is_file()
                    .then(|| std::fs::canonicalize(path).ok())
                    .flatten()
            })
    })
}

pub(super) fn spawn(
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
    let executable = executable_path().ok_or_else(|| {
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
    if let Err(error) = write_wrapper(&wrapper, &launch_config, skill_generation.is_some()) {
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
    command.env("DEVHATCH_AGENT_ID", ID);
    command.env("DEVHATCH_CONFIG_ID", &launch_config.id);
    command.env("DEVHATCH_CONFIG_NAME", &launch_config.name);
    command.env("DEVHATCH_CWD", &cwd);
    command.env("DEVHATCH_CONFIG_DIR", &run_dir);
    command.env_remove("OPENCODE_CONFIG");
    command.env_remove("OPENCODE_CONFIG_CONTENT");
    command.env_remove("OPENCODE_CONFIG_DIR");
    command.env_remove("BYTE_API_PROVIDER_ID");
    command.env_remove("BYTE_API_SERVER_URL");
    if skill_generation.is_some() {
        command.env("OPENCODE_CONFIG_DIR", &run_dir);
    }
    let endpoint = event_endpoint.clone();
    let app_state = state.clone();
    let cleanup_path = run_dir.clone();
    let result = Session::spawn(
        state,
        SessionSpawn {
            command,
            shell,
            kind: SessionKind::Agent,
            upstream_session_id,
            cwd,
            name: NAME.to_string(),
            cols,
            rows,
            agent_id: Some(ID),
            agent_name: Some(NAME),
            cleanup_path: Some(cleanup_path),
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
