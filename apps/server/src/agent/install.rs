use std::{
    env, fs, io,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json,
    extract::{Path as AxumPath, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};

use super::{
    AgentKind,
    launch::{executable_in_prefix, installed_version, managed_agent_prefix},
};
use crate::{api::ApiError, auth, state::AppState};

const INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);
const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const INSTALL_OUTPUT_LIMIT: usize = 512 * 1024;
const CHECK_OUTPUT_LIMIT: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct InstallSpec {
    kind: AgentKind,
    package: &'static str,
    version: &'static str,
    minimum_node: [u64; 3],
    postinstall: Option<&'static str>,
}

const CODEX: InstallSpec = InstallSpec {
    kind: AgentKind::Codex,
    package: "@openai/codex@0.153.4",
    version: "0.153.4",
    minimum_node: [16, 0, 0],
    postinstall: None,
};
const OPENCODE: InstallSpec = InstallSpec {
    kind: AgentKind::OpenCode,
    package: "opencode-ai@1.18.30",
    version: "1.18.30",
    minimum_node: [16, 0, 0],
    postinstall: Some("lib/node_modules/opencode-ai/postinstall.mjs"),
};
const PI: InstallSpec = InstallSpec {
    kind: AgentKind::Pi,
    package: "@earendil-works/pi-coding-agent@0.85.1",
    version: "0.85.1",
    minimum_node: [22, 19, 0],
    postinstall: None,
};

fn install_spec(kind: AgentKind) -> Option<&'static InstallSpec> {
    match kind {
        AgentKind::Codex => Some(&CODEX),
        AgentKind::OpenCode => Some(&OPENCODE),
        AgentKind::Pi => Some(&PI),
        AgentKind::TraeCli => None,
    }
}

struct InstallerTools {
    node: PathBuf,
    npm: PathBuf,
    path: std::ffi::OsString,
}

struct InstallerEnvironment {
    path: std::ffi::OsString,
    home: PathBuf,
    cache: PathBuf,
    temporary: PathBuf,
    user_config: PathBuf,
    global_config: PathBuf,
}

struct StagingDirectory(Option<PathBuf>);

impl StagingDirectory {
    fn new(path: PathBuf) -> Self {
        Self(Some(path))
    }

    fn disarm(&mut self) {
        self.0 = None;
    }
}

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

#[derive(Debug)]
enum InstallError {
    UnsafePath(String),
    InstallerUnavailable(String),
    Timeout(String),
    Failed(String),
    Publish(String),
}

impl InstallError {
    fn into_response(self) -> Response {
        let (status, code, message, detail) = match self {
            Self::UnsafePath(detail) => (
                StatusCode::CONFLICT,
                "AGENT_INSTALL_PATH_UNSAFE",
                "The managed Agent CLI directory is unsafe.",
                detail,
            ),
            Self::InstallerUnavailable(detail) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "AGENT_INSTALLER_UNAVAILABLE",
                "A compatible Node.js and npm installation is required.",
                detail,
            ),
            Self::Timeout(detail) => (
                StatusCode::GATEWAY_TIMEOUT,
                "AGENT_INSTALL_TIMEOUT",
                "The Agent CLI installation timed out.",
                detail,
            ),
            Self::Failed(detail) => (
                StatusCode::BAD_GATEWAY,
                "AGENT_INSTALL_FAILED",
                "Unable to install the Agent CLI.",
                detail,
            ),
            Self::Publish(detail) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "AGENT_INSTALL_PUBLISH_FAILED",
                "Unable to save the Agent CLI installation.",
                detail,
            ),
        };
        eprintln!("Agent installation failed: {detail}");
        auth::with_no_store(ApiError::with_message(status, code, message).into_response())
    }
}

pub(crate) async fn install(
    State(state): State<Arc<AppState>>,
    AxumPath(agent_id): AxumPath<String>,
) -> Response {
    let kind = match AgentKind::try_from(agent_id.as_str()) {
        Ok(kind) => kind,
        Err(()) => {
            return auth::with_no_store(
                ApiError::new(StatusCode::BAD_REQUEST, "INVALID_AGENT_ID").into_response(),
            );
        }
    };
    let Some(spec) = install_spec(kind) else {
        return auth::with_no_store(
            ApiError::new(
                StatusCode::UNPROCESSABLE_ENTITY,
                "AGENT_INSTALL_UNSUPPORTED",
            )
            .into_response(),
        );
    };
    let Ok(_install_guard) = state.agent_install_lock().try_lock() else {
        return auth::with_no_store(
            ApiError::with_message(
                StatusCode::CONFLICT,
                "AGENT_INSTALL_IN_PROGRESS",
                "Another Agent CLI installation is already in progress.",
            )
            .into_response(),
        );
    };
    if let Some(version) = installed_version(state.data_dir(), kind).await {
        return install_response(StatusCode::OK, kind, version);
    }
    match install_managed(&state, spec).await {
        Ok(version) => install_response(StatusCode::CREATED, kind, version),
        Err(error) => error.into_response(),
    }
}

fn install_response(status: StatusCode, kind: AgentKind, version: String) -> Response {
    auth::with_no_store(
        (
            status,
            Json(serde_json::json!({
                "agentInstall": {
                    "agentId": kind.as_str(),
                    "version": version
                }
            })),
        )
            .into_response(),
    )
}

async fn install_managed(state: &AppState, spec: &InstallSpec) -> Result<String, InstallError> {
    let data_dir = state.data_dir();
    let tools = installer_tools(spec.minimum_node).await?;
    let root = data_dir.join("agent-clis");
    ensure_private_directory(&root)?;
    let install_id = uuid::Uuid::new_v4().simple();
    let staging = root.join(format!(".{}.install-{install_id}", spec.kind.as_str()));
    let work = root.join(format!(".{}.work-{install_id}", spec.kind.as_str()));
    create_private_directory(&staging).map_err(|error| InstallError::Publish(error.to_string()))?;
    let mut staging_guard = StagingDirectory::new(staging.clone());
    create_private_directory(&work).map_err(|error| InstallError::Publish(error.to_string()))?;
    let _work_guard = StagingDirectory::new(work.clone());
    let home = work.join("home");
    let cache = work.join("npm-cache");
    let temporary = work.join("tmp");
    for directory in [&home, &cache, &temporary] {
        create_private_directory(directory)
            .map_err(|error| InstallError::Publish(error.to_string()))?;
    }
    let user_config = work.join("user.npmrc");
    let global_config = work.join("global.npmrc");
    for config in [&user_config, &global_config] {
        create_private_file(config).map_err(|error| InstallError::Publish(error.to_string()))?;
    }
    let environment = InstallerEnvironment {
        path: tools.path.clone(),
        home,
        cache,
        temporary,
        user_config,
        global_config,
    };
    let mut command = tokio::process::Command::new(&tools.npm);
    command.args([
        "install",
        "--global",
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--loglevel=error",
        "--registry=https://registry.npmjs.org/",
        "--prefix",
    ]);
    command.arg(&staging).arg(spec.package);
    configure_installer_environment(&mut command, &environment);
    let output = run_command(state, &mut command, INSTALL_TIMEOUT).await?;
    if !output.status.success() {
        return Err(InstallError::Failed(format!(
            "npm exited with {}; {}",
            output.status,
            output_detail(&output)
        )));
    }
    if let Some(postinstall) = spec.postinstall {
        let script = staging.join(postinstall);
        if !script.is_file() {
            return Err(InstallError::Failed(
                "the pinned postinstall script is missing".into(),
            ));
        }
        let mut command = tokio::process::Command::new(&tools.node);
        command.arg(script);
        configure_installer_environment(&mut command, &environment);
        let output = run_command(state, &mut command, INSTALL_TIMEOUT).await?;
        if !output.status.success() {
            return Err(InstallError::Failed(format!(
                "postinstall exited with {}; {}",
                output.status,
                output_detail(&output)
            )));
        }
    }
    let executable = executable_in_prefix(&staging, spec.kind.as_str())
        .ok_or_else(|| InstallError::Failed("the installed executable failed validation".into()))?;
    let version = validate_installed_version(state, &executable, spec, &environment).await?;
    publish(&root, &staging, &managed_agent_prefix(data_dir, spec.kind))?;
    staging_guard.disarm();
    Ok(version)
}

async fn installer_tools(minimum_node: [u64; 3]) -> Result<InstallerTools, InstallError> {
    let (node, node_directory) = find_tool("node").ok_or_else(|| {
        InstallError::InstallerUnavailable("the node executable was not found".into())
    })?;
    let (npm, npm_directory) = find_tool("npm").ok_or_else(|| {
        InstallError::InstallerUnavailable("the npm executable was not found".into())
    })?;
    let output = crate::process::command_output(
        tokio::process::Command::new(&node).arg("--version"),
        CHECK_TIMEOUT,
        CHECK_OUTPUT_LIMIT,
    )
    .await
    .map_err(|error| InstallError::InstallerUnavailable(format!("node check failed: {error}")))?;
    let version = String::from_utf8_lossy(&output.stdout);
    if !output.status.success() || !version_at_least(version.trim(), minimum_node) {
        return Err(InstallError::InstallerUnavailable(format!(
            "node {}.{}.{} or newer is required",
            minimum_node[0], minimum_node[1], minimum_node[2]
        )));
    }
    let mut paths = vec![node_directory];
    if !paths.contains(&npm_directory) {
        paths.push(npm_directory);
    }
    for directory in [
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ] {
        if !paths.contains(&directory) {
            paths.push(directory);
        }
    }
    let path = env::join_paths(paths)
        .map_err(|error| InstallError::InstallerUnavailable(error.to_string()))?;
    Ok(InstallerTools { node, npm, path })
}

fn find_tool(name: &str) -> Option<(PathBuf, PathBuf)> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths).find_map(|directory| {
            let candidate = directory.join(name);
            let metadata = fs::metadata(&candidate).ok()?;
            if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
            Some((fs::canonicalize(candidate).ok()?, directory))
        })
    })
}

fn version_at_least(version: &str, minimum: [u64; 3]) -> bool {
    let mut parts = version.trim_start_matches('v').split('.');
    let current = [parts.next(), parts.next(), parts.next()]
        .map(|part| part.and_then(|value| value.parse::<u64>().ok()));
    current
        .into_iter()
        .collect::<Option<Vec<_>>>()
        .is_some_and(|current| current.as_slice() >= minimum.as_slice())
}

fn configure_installer_environment(
    command: &mut tokio::process::Command,
    environment: &InstallerEnvironment,
) {
    command
        .env_clear()
        .env("PATH", &environment.path)
        .env("HOME", &environment.home)
        .env("TMPDIR", &environment.temporary)
        .env("NPM_CONFIG_CACHE", &environment.cache)
        .env("NPM_CONFIG_USERCONFIG", &environment.user_config)
        .env("NPM_CONFIG_GLOBALCONFIG", &environment.global_config)
        .env("NPM_CONFIG_IGNORE_SCRIPTS", "true");
}

async fn run_command(
    state: &AppState,
    command: &mut tokio::process::Command,
    timeout: Duration,
) -> Result<std::process::Output, InstallError> {
    tokio::select! {
        result = crate::process::command_output(command, timeout, INSTALL_OUTPUT_LIMIT) => {
            result.map_err(|error| {
                if error == "Command timed out" {
                    InstallError::Timeout(error)
                } else {
                    InstallError::InstallerUnavailable(error)
                }
            })
        }
        () = state.wait_for_shutdown() => Err(InstallError::Failed("server shutdown interrupted the installation".into())),
    }
}

async fn validate_installed_version(
    state: &AppState,
    executable: &Path,
    spec: &InstallSpec,
    environment: &InstallerEnvironment,
) -> Result<String, InstallError> {
    let mut command = tokio::process::Command::new(executable);
    command.arg("--version");
    configure_installer_environment(&mut command, environment);
    let output = tokio::select! {
        result = crate::process::command_output(&mut command, CHECK_TIMEOUT, CHECK_OUTPUT_LIMIT) => result,
        () = state.wait_for_shutdown() => Err("Server shutdown interrupted the installation".into()),
    }
        .map_err(|error| {
            if error == "Command timed out" {
                InstallError::Timeout(error)
            } else {
                InstallError::Failed(error)
            }
        })?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success()
        || (!stdout.contains(spec.version) && !stderr.contains(spec.version))
    {
        return Err(InstallError::Failed(format!(
            "installed version validation failed; {}",
            output_detail(&output)
        )));
    }
    Ok(spec.version.to_string())
}

fn output_detail(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    stderr
        .trim()
        .lines()
        .next()
        .or_else(|| stdout.trim().lines().next())
        .unwrap_or("no process output")
        .chars()
        .take(512)
        .collect()
}

fn ensure_private_directory(path: &Path) -> Result<(), InstallError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => validate_private_directory(&metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            create_private_directory(path)
                .map_err(|error| InstallError::Publish(error.to_string()))?;
            validate_private_directory(
                &fs::symlink_metadata(path)
                    .map_err(|error| InstallError::Publish(error.to_string()))?,
            )
        }
        Err(error) => Err(InstallError::Publish(error.to_string())),
    }
}

fn validate_private_directory(metadata: &fs::Metadata) -> Result<(), InstallError> {
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o022 != 0
    {
        return Err(InstallError::UnsafePath(
            "the managed Agent CLI directory is unsafe".into(),
        ));
    }
    Ok(())
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    fs::create_dir(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

fn create_private_file(path: &Path) -> io::Result<()> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map(|_| ())
}

fn publish(root: &Path, staging: &Path, destination: &Path) -> Result<(), InstallError> {
    if staging.parent() != Some(root) || destination.parent() != Some(root) {
        return Err(InstallError::UnsafePath(
            "the managed Agent CLI path is invalid".into(),
        ));
    }
    let existing = match fs::symlink_metadata(destination) {
        Ok(metadata) => {
            validate_private_directory(&metadata)?;
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(InstallError::Publish(error.to_string())),
    };
    let backup = root.join(format!(
        ".{}.backup-{}",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| InstallError::UnsafePath("invalid destination path".into()))?,
        uuid::Uuid::new_v4().simple()
    ));
    if existing {
        fs::rename(destination, &backup)
            .map_err(|error| InstallError::Publish(error.to_string()))?;
    }
    if let Err(error) = fs::rename(staging, destination) {
        if existing {
            let _ = fs::rename(&backup, destination);
        }
        return Err(InstallError::Publish(error.to_string()));
    }
    if existing && let Err(error) = fs::remove_dir_all(&backup) {
        eprintln!("Unable to remove previous Agent CLI installation: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        os::unix::fs::{PermissionsExt, symlink},
        sync::Arc,
    };

    use sqlx::sqlite::SqlitePoolOptions;

    use super::{
        CODEX, OPENCODE, PI, ensure_private_directory, install, install_spec, version_at_least,
    };
    use crate::{
        agent::{AgentKind, launch::executable_in_prefix},
        state::{AppState, OpenCodeHistoryPool},
    };

    async fn state() -> (tempfile::TempDir, Arc<AppState>) {
        let temp = tempfile::tempdir().unwrap();
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!().run(&pool).await.unwrap();
        let skillink = skillink::Skillink::open(Some(temp.path().join("skillink")))
            .await
            .unwrap();
        let state = Arc::new(AppState::new(
            temp.path().to_owned(),
            pool,
            OpenCodeHistoryPool::new(temp.path().join("history.db")),
            skillink,
            None,
            false,
        ));
        (temp, state)
    }

    #[tokio::test]
    async fn rejects_unknown_and_unsupported_agents_without_running_an_installer() {
        let (_temp, state) = state().await;
        let unknown = install(
            axum::extract::State(state.clone()),
            axum::extract::Path("unknown".to_string()),
        )
        .await;
        assert_eq!(unknown.status(), axum::http::StatusCode::BAD_REQUEST);
        let unsupported = install(
            axum::extract::State(state),
            axum::extract::Path("traecli".to_string()),
        )
        .await;
        assert_eq!(
            unsupported.status(),
            axum::http::StatusCode::UNPROCESSABLE_ENTITY
        );
    }

    #[tokio::test]
    async fn rejects_concurrent_installations_across_agent_kinds() {
        let (_temp, state) = state().await;
        let guard = state.agent_install_lock().try_lock().unwrap();
        let response = install(
            axum::extract::State(state.clone()),
            axum::extract::Path("codex".to_string()),
        )
        .await;
        assert_eq!(response.status(), axum::http::StatusCode::CONFLICT);
        drop(guard);
        assert!(state.agent_install_lock().try_lock().is_ok());
    }

    #[test]
    fn installation_specs_are_fixed_and_trae_is_manual_only() {
        assert_eq!(install_spec(AgentKind::Codex), Some(&CODEX));
        assert_eq!(install_spec(AgentKind::OpenCode), Some(&OPENCODE));
        assert_eq!(install_spec(AgentKind::Pi), Some(&PI));
        assert_eq!(install_spec(AgentKind::TraeCli), None);
        assert_eq!(CODEX.package, "@openai/codex@0.153.4");
        assert_eq!(OPENCODE.package, "opencode-ai@1.18.30");
        assert_eq!(PI.package, "@earendil-works/pi-coding-agent@0.85.1");
    }

    #[test]
    fn validates_node_versions() {
        assert!(version_at_least("v22.19.0", [22, 19, 0]));
        assert!(version_at_least("26.1.0", [22, 19, 0]));
        assert!(!version_at_least("v22.18.9", [22, 19, 0]));
        assert!(!version_at_least("unknown", [16, 0, 0]));
    }

    #[test]
    fn managed_executable_must_resolve_inside_private_prefix() {
        let root = tempfile::tempdir().unwrap();
        let prefix = root.path().join("agent");
        std::fs::create_dir(&prefix).unwrap();
        std::fs::set_permissions(&prefix, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::create_dir(prefix.join("bin")).unwrap();
        let target = prefix.join("cli.js");
        std::fs::write(&target, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o700)).unwrap();
        symlink("../cli.js", prefix.join("bin/codex")).unwrap();
        assert_eq!(
            executable_in_prefix(&prefix, "codex"),
            Some(target.canonicalize().unwrap())
        );

        let outside = root.path().join("outside");
        std::fs::write(&outside, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&outside, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::remove_file(prefix.join("bin/codex")).unwrap();
        symlink(&outside, prefix.join("bin/codex")).unwrap();
        assert_eq!(executable_in_prefix(&prefix, "codex"), None);
    }

    #[test]
    fn rejects_symlinked_managed_root() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target");
        std::fs::create_dir(&target).unwrap();
        let managed = root.path().join("agent-clis");
        symlink(&target, &managed).unwrap();
        assert!(ensure_private_directory(&managed).is_err());
    }
}
