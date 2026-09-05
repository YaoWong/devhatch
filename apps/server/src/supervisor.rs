use std::{
    collections::BTreeMap,
    env,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use path_clean::PathClean;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{api::ApiError, auth, process, state::AppState};

const UNIT_NAME: &str = "devhatch.service";
const UNIT_DESCRIPTION: &str = "DevHatch user supervisor managed installation";
const UNIT_MARKER: &str = "X-DevHatch-Managed=1";
const ENV_SCHEMA: &str = "DEVHATCH_SUPERVISOR_SCHEMA=\"1\"";
const ENV_SCHEMA_NAME: &str = "DEVHATCH_SUPERVISOR_SCHEMA";
const SYSTEMCTL: &str = "/usr/bin/systemctl";
const ENV_EXECUTABLE: &str = "/usr/bin/env";
const LOGINCTL: &str = "/usr/bin/loginctl";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(4);
const COMMAND_OUTPUT_LIMIT: usize = 16 * 1024;
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_HANDOFF_BYTES: u64 = 256;
const MAX_ENVIRONMENT_BYTES: u64 = 64 * 1024;
const REQUIRED_ENVIRONMENT: &[&str] = &[
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "PATH",
    "SHELL",
    "DEVHATCH_BIND",
    "DEVHATCH_DATA_DIR",
    "DEVHATCH_WEB_DIST",
    "DEVHATCH_CWD",
    "BYTE_API_API_KEY_FILE",
];
const OPTIONAL_ENVIRONMENT: &[&str] = &[
    "DEVHATCH_PUBLIC_ORIGIN",
    "DEVHATCH_IMPORT_ROOTS",
    "DEVHATCH_OPEN_DESIGN_URL",
    "DEVHATCH_OPENDESIGN_PUBLIC_URL",
    "CODEX_HOME",
    "TRAE_HOME",
    "TRAECLI_HOME",
    "PI_CODING_AGENT_DIR",
    "PI_CODING_AGENT_SESSION_DIR",
    "SKILLINK_HOME",
    "SSH_AUTH_SOCK",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SKILLINK_GIT_TIMEOUT_SECS",
    "SKILLINK_GIT_CONCURRENCY",
    "SKILLINK_GIT_SHALLOW",
];

#[derive(Clone)]
pub(crate) struct Supervisor {
    context: Arc<SupervisorContext>,
    install_lock: Arc<tokio::sync::Mutex<()>>,
    restart_pending: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Clone)]
pub(crate) struct SupervisorContext {
    current_exe: PathBuf,
    web_dist: Option<PathBuf>,
    data_dir: PathBuf,
    bind: String,
    home: String,
    config_home: String,
    runtime_dir: String,
    bus_address: String,
    path: String,
    shell: String,
    effective_cwd: String,
    optional_environment: BTreeMap<String, String>,
    install_root: PathBuf,
    unit_path: PathBuf,
    environment_path: PathBuf,
    handoff_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InstallRequest {
    byte_api_key_file: String,
    overwrite: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupervisorStatus {
    supported: bool,
    available: bool,
    installed: bool,
    managed: bool,
    enabled: bool,
    active: bool,
    current_process_managed: bool,
    handoff_pending: bool,
    restart_pending: bool,
    overwrite_required: bool,
    state: String,
    unit_name: &'static str,
    unit_path: String,
    install_root: String,
    byte_api_key_file: Option<String>,
    linger_enabled: bool,
}

#[derive(Default)]
struct SystemdStatus {
    description: String,
    load_state: String,
    unit_file_state: String,
    active_state: String,
    sub_state: String,
    main_pid: u32,
    control_pid: u32,
    job: String,
    fragment_path: Option<PathBuf>,
    drop_in_paths: Vec<PathBuf>,
    need_daemon_reload: bool,
}

struct LocalStatus {
    unit: ManagedFile,
    environment: ManagedFile,
    current: CurrentInstall,
    source_hash: Option<String>,
    byte_api_key_file: Option<String>,
    handoff_pending: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ManagedFile {
    Missing,
    Managed(String),
    Foreign,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CurrentInstall {
    Missing,
    Managed(PathBuf),
    ManagedInvalid(PathBuf),
    Foreign,
}

#[derive(Debug, PartialEq, Eq)]
enum InstallDecision {
    Fresh,
    Current,
    OverwriteRequired,
    Foreign,
}

struct InstallOutcome {
    status: SupervisorStatus,
    restart_required: bool,
}

struct InstallSnapshot {
    unit: Option<Vec<u8>>,
    environment: Option<Vec<u8>>,
    current: Option<PathBuf>,
    enabled: bool,
    active: bool,
}

struct InstallTransaction {
    context: Arc<SupervisorContext>,
    manager_environment: BTreeMap<String, String>,
    snapshot: InstallSnapshot,
    handoff_record: HandoffRecord,
    files_mutated: bool,
    newly_enabled: bool,
    handoff_attempted: bool,
    start_attempted: bool,
    committed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
struct HandoffRecord {
    pid: u32,
    starttime: u64,
}

struct InstallError {
    status: StatusCode,
    code: &'static str,
    detail: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct RollbackPlan {
    restore_files: bool,
    disable_unit: bool,
    stop_unit: bool,
    reload_manager: bool,
    remove_handoff: bool,
}

impl InstallTransaction {
    fn capture(
        context: Arc<SupervisorContext>,
        manager_environment: BTreeMap<String, String>,
        enabled: bool,
        active: bool,
        handoff_record: HandoffRecord,
    ) -> io::Result<Self> {
        Ok(Self {
            snapshot: InstallSnapshot {
                unit: snapshot_managed_file(&context.unit_path, managed_unit_content)?,
                environment: snapshot_managed_file(
                    &context.environment_path,
                    managed_environment_content,
                )?,
                current: snapshot_managed_current(&context.current_link())?,
                enabled,
                active,
            },
            context,
            manager_environment,
            handoff_record,
            files_mutated: false,
            newly_enabled: false,
            handoff_attempted: false,
            start_attempted: false,
            committed: false,
        })
    }

    fn rollback_plan(&self) -> RollbackPlan {
        RollbackPlan {
            restore_files: self.files_mutated,
            disable_unit: self.newly_enabled && !self.snapshot.enabled,
            stop_unit: self.start_attempted && !self.snapshot.active,
            reload_manager: self.files_mutated,
            remove_handoff: self.handoff_attempted,
        }
    }

    async fn rollback(&mut self) {
        if self.committed {
            return;
        }
        let plan = self.rollback_plan();
        if plan.stop_unit
            && let Err(error) = run_systemctl(&self.manager_environment, &["stop", UNIT_NAME]).await
        {
            eprintln!("Failed to stop rolled back supervisor: {}", error.code);
        }
        if plan.disable_unit
            && let Err(error) =
                run_systemctl(&self.manager_environment, &["disable", UNIT_NAME]).await
        {
            eprintln!("Failed to restore supervisor enablement: {}", error.code);
        }
        if plan.restore_files
            && let Err(error) = restore_install_snapshot(&self.context, &self.snapshot)
        {
            eprintln!("Failed to restore supervisor installation: {error}");
        }
        if plan.reload_manager
            && let Err(error) = reload_systemd_definition(&self.manager_environment).await
        {
            eprintln!(
                "Failed to reload restored supervisor definition: {}",
                error.code
            );
        }
        if plan.remove_handoff {
            let _ = remove_handoff_record_if_same(&self.context.handoff_path, self.handoff_record);
        }
    }

    fn commit(&mut self) {
        self.committed = true;
    }
}

fn unit_enabled(status: &SystemdStatus) -> bool {
    matches!(
        status.unit_file_state.as_str(),
        "enabled" | "enabled-runtime" | "linked" | "linked-runtime"
    )
}

fn snapshot_managed_file(path: &Path, managed: fn(&str) -> bool) -> io::Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
        Ok(_) => {
            let content = read_small_regular_file(path, 128 * 1024, 0o600)?;
            if managed(&content) {
                Ok(Some(content.into_bytes()))
            } else {
                Err(io::Error::new(io::ErrorKind::AlreadyExists, "foreign file"))
            }
        }
    }
}

fn snapshot_managed_current(path: &Path) -> io::Result<Option<PathBuf>> {
    match inspect_current(path) {
        CurrentInstall::Missing => Ok(None),
        CurrentInstall::Managed(target) | CurrentInstall::ManagedInvalid(target) => {
            Ok(Some(target))
        }
        CurrentInstall::Foreign => Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "foreign current install",
        )),
    }
}

fn restore_optional_file(
    path: &Path,
    value: Option<&[u8]>,
    managed: fn(&str) -> bool,
) -> io::Result<()> {
    if fs::symlink_metadata(path).is_ok() {
        match read_small_regular_file(path, 128 * 1024, 0o600) {
            Ok(content) if managed(&content) => {}
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "managed file was replaced during rollback",
                ));
            }
        }
    }
    match value {
        Some(value) => atomic_write_file(path, value, 0o600),
        None => match fs::remove_file(path) {
            Ok(()) => sync_parent(path),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        },
    }
}

fn restore_install_snapshot(
    context: &SupervisorContext,
    snapshot: &InstallSnapshot,
) -> io::Result<()> {
    restore_optional_file(
        &context.environment_path,
        snapshot.environment.as_deref(),
        managed_environment_content,
    )?;
    restore_optional_file(
        &context.unit_path,
        snapshot.unit.as_deref(),
        managed_unit_content,
    )?;
    match inspect_current(&context.current_link()) {
        CurrentInstall::Missing
        | CurrentInstall::Managed(_)
        | CurrentInstall::ManagedInvalid(_) => {}
        CurrentInstall::Foreign => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "current install was replaced during rollback",
            ));
        }
    }
    match snapshot.current.as_deref() {
        Some(target) => atomic_symlink(&context.current_link(), target),
        None => match fs::remove_file(context.current_link()) {
            Ok(()) => sync_parent(&context.current_link()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        },
    }
}

impl SupervisorContext {
    pub(crate) fn capture(
        current_exe: PathBuf,
        web_dist: Option<PathBuf>,
        data_dir: PathBuf,
        bind: String,
        public_origin: Option<String>,
    ) -> io::Result<Self> {
        let data_dir = fs::canonicalize(data_dir)?;
        let home_path = effective_home_directory()?;
        if !home_path.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "HOME must be absolute",
            ));
        }
        let home = environment_string(home_path.as_os_str())?;
        let config_home_path =
            resolve_config_home(&home_path, env::var_os("XDG_CONFIG_HOME").as_deref())?;
        let runtime_dir_path = resolve_runtime_directory(
            env::var_os("XDG_RUNTIME_DIR").as_deref(),
            &default_runtime_directory(),
        )?;
        let manager_environment = validated_manager_environment(&runtime_dir_path)?;
        let config_home = environment_string(config_home_path.as_os_str())?;
        let runtime_dir = environment_string(runtime_dir_path.as_os_str())?;
        let bus_address = manager_environment["DBUS_SESSION_BUS_ADDRESS"].clone();
        let path = environment_value("PATH", "/usr/local/bin:/usr/bin:/bin")?;
        let shell = environment_value("SHELL", "/bin/sh")?;
        let effective_cwd = match env::var_os("DEVHATCH_CWD") {
            Some(value) => {
                let value = environment_string(&value)?;
                crate::filesystem::validated_directory(&value)
                    .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid cwd"))?
            }
            None => fs::canonicalize(&home_path)?
                .to_str()
                .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "non-UTF-8 HOME"))?
                .to_string(),
        };
        let mut optional_environment = BTreeMap::new();
        for name in OPTIONAL_ENVIRONMENT {
            if let Some(value) = env::var_os(name) {
                let value = environment_string(&value)?;
                if let Ok(value) = sanitize_optional_environment(
                    name,
                    &value,
                    &home_path,
                    Path::new(&effective_cwd),
                ) {
                    optional_environment.insert(name.to_string(), value);
                }
            }
        }
        if let Some(public_origin) = public_origin {
            validate_environment_value(&public_origin)?;
            optional_environment.insert("DEVHATCH_PUBLIC_ORIGIN".into(), public_origin);
        }
        validate_environment_value(&bind)?;
        let install_root = home_path.join(".local/lib/devhatch");
        let unit_path = managed_unit_path(&config_home_path);
        let environment_path = managed_environment_path(&config_home_path);
        let handoff_path = managed_handoff_path(&runtime_dir_path);
        Ok(Self {
            current_exe,
            web_dist,
            data_dir,
            bind,
            home,
            config_home,
            runtime_dir,
            bus_address,
            path,
            shell,
            effective_cwd,
            optional_environment,
            install_root,
            unit_path,
            environment_path,
            handoff_path,
        })
    }

    fn manager_environment(&self) -> io::Result<BTreeMap<String, String>> {
        let home = logical_owner_controlled_directory(Path::new(&self.home))?;
        let config = resolve_config_home(&home, Some(std::ffi::OsStr::new(&self.config_home)))?;
        if config != Path::new(&self.config_home) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "supervisor config path changed",
            ));
        }
        let environment = BTreeMap::from([
            ("HOME".into(), self.home.clone()),
            ("XDG_CONFIG_HOME".into(), self.config_home.clone()),
            ("XDG_RUNTIME_DIR".into(), self.runtime_dir.clone()),
            ("DBUS_SESSION_BUS_ADDRESS".into(), self.bus_address.clone()),
        ]);
        validate_bus_address(Path::new(&self.runtime_dir), &self.bus_address)?;
        Ok(environment)
    }

    fn current_link(&self) -> PathBuf {
        self.install_root.join("current")
    }

    fn releases_dir(&self) -> PathBuf {
        self.install_root.join("releases")
    }

    fn installed_binary(&self) -> PathBuf {
        self.current_link().join("bin/devhatch-server")
    }

    fn installed_web_dist(&self) -> PathBuf {
        self.current_link().join("web/dist")
    }

    fn desired_current_target(hash: &str) -> PathBuf {
        PathBuf::from("releases").join(hash)
    }

    fn source_hash(&self) -> io::Result<String> {
        let web_dist = self.web_dist.as_deref().ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "web distribution unavailable")
        })?;
        hash_layout(&self.current_exe, web_dist)
    }

    fn environment_file(&self, byte_api_key_file: &str) -> io::Result<String> {
        let data_dir = path_utf8(&self.data_dir)?;
        let installed_web_dist = self.installed_web_dist();
        let web_dist = path_utf8(&installed_web_dist)?;
        let mut values = vec![
            ("HOME", self.home.as_str()),
            ("XDG_CONFIG_HOME", self.config_home.as_str()),
            ("XDG_RUNTIME_DIR", self.runtime_dir.as_str()),
            ("DBUS_SESSION_BUS_ADDRESS", self.bus_address.as_str()),
            ("PATH", self.path.as_str()),
            ("SHELL", self.shell.as_str()),
            ("DEVHATCH_BIND", self.bind.as_str()),
            ("DEVHATCH_DATA_DIR", data_dir),
            ("DEVHATCH_WEB_DIST", web_dist),
            ("DEVHATCH_CWD", self.effective_cwd.as_str()),
        ];
        for &name in OPTIONAL_ENVIRONMENT {
            if let Some(value) = self.optional_environment.get(name) {
                values.push((name, value));
            }
        }
        values.push(("BYTE_API_API_KEY_FILE", byte_api_key_file));
        let mut content = String::from(ENV_SCHEMA);
        content.push('\n');
        for (name, value) in values {
            content.push_str(name);
            content.push('=');
            content.push_str(&systemd_environment_quote(value)?);
            content.push('\n');
        }
        Ok(content)
    }

    fn unit_file(&self) -> io::Result<String> {
        let binary = systemd_exec_argument(path_utf8(&self.installed_binary())?)?;
        let handoff = systemd_exec_argument(path_utf8(&self.handoff_path)?)?;
        let environment = systemd_exec_argument(path_utf8(&self.environment_path)?)?;
        let environment_file = systemd_directive_path(path_utf8(&self.environment_path)?)?;
        let working_directory = systemd_directive_path(path_utf8(Path::new(&self.effective_cwd))?)?;
        Ok(format!(
            "[Unit]\nDescription={UNIT_DESCRIPTION}\n{UNIT_MARKER}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=exec\nUMask=0077\nEnvironmentFile={environment_file}\nUnsetEnvironment=BYTE_API_API_KEY DEVHATCH_ADMIN_PASSWORD DEVHATCH_ADMIN_PASSWORD_FILE\nWorkingDirectory={working_directory}\nExecStartPre={ENV_EXECUTABLE} {binary} \"--systemd-handoff-wait\" {handoff}\nExecStart={ENV_EXECUTABLE} {binary} \"--systemd-launch\" {environment}\nRestart=always\nRestartSec=2s\nKillMode=mixed\nTimeoutStartSec=120s\nTimeoutStopSec=45s\n\n[Install]\nWantedBy=default.target\n"
        ))
    }
}

impl Supervisor {
    pub(crate) fn new(context: SupervisorContext) -> Self {
        Self {
            context: Arc::new(context),
            install_lock: Arc::new(tokio::sync::Mutex::new(())),
            restart_pending: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub(crate) async fn status(&self) -> SupervisorStatus {
        if !cfg!(target_os = "linux") {
            return self.status_from(None, false, empty_local_status());
        }
        let context = self.context.clone();
        let local = tokio::task::spawn_blocking(move || inspect_local(&context));
        let manager_environment = match self.context.manager_environment() {
            Ok(environment) => environment,
            Err(error) => {
                eprintln!("Supervisor manager environment unavailable: {error}");
                return self.status_from(None, false, empty_local_status());
            }
        };
        let (systemd, manager_config, linger, local) = tokio::join!(
            systemd_status(&manager_environment),
            manager_config_home(&manager_environment, Path::new(&self.context.home)),
            linger_enabled(&manager_environment),
            local
        );
        let systemd = if manager_config
            .as_ref()
            .is_some_and(|path| same_path_identity(path, Path::new(&self.context.config_home)))
        {
            systemd
        } else {
            None
        };
        let local = local.unwrap_or_else(|error| {
            eprintln!("Failed to inspect supervisor files: {error}");
            empty_local_status()
        });
        self.status_from(systemd, linger, local)
    }

    fn status_from(
        &self,
        systemd: Option<SystemdStatus>,
        linger_enabled: bool,
        local: LocalStatus,
    ) -> SupervisorStatus {
        let supported = cfg!(target_os = "linux");
        let available = systemd.is_some();
        let systemd = systemd.unwrap_or_default();
        let expected_fragment = &self.context.unit_path;
        let loaded_foreign = !systemd.drop_in_paths.is_empty()
            || (systemd.load_state != "not-found"
                && !systemd.load_state.is_empty()
                && (systemd.description != UNIT_DESCRIPTION
                    || systemd
                        .fragment_path
                        .as_ref()
                        .is_none_or(|path| !same_path_identity(path, expected_fragment))));
        let managed = matches!(local.unit, ManagedFile::Managed(_)) && !loaded_foreign;
        let installed = managed
            && matches!(local.environment, ManagedFile::Managed(_))
            && matches!(local.current, CurrentInstall::Managed(_))
            && matches!(systemd.load_state.as_str(), "loaded" | "not-found" | "");
        let enabled = matches!(
            systemd.unit_file_state.as_str(),
            "enabled" | "enabled-runtime" | "linked" | "linked-runtime"
        );
        let active = matches!(systemd.active_state.as_str(), "active" | "reloading");
        let current_process_managed = managed
            && systemd.main_pid == std::process::id()
            && matches!(systemd.active_state.as_str(), "active" | "reloading");
        let foreign = loaded_foreign
            || local.unit == ManagedFile::Foreign
            || local.environment == ManagedFile::Foreign
            || local.current == CurrentInstall::Foreign;
        let any_install = local.unit != ManagedFile::Missing
            || local.environment != ManagedFile::Missing
            || local.current != CurrentInstall::Missing;
        let overwrite_required = if foreign {
            false
        } else if let (Some(hash), Some(key_file)) = (
            local.source_hash.as_deref(),
            local.byte_api_key_file.as_deref(),
        ) {
            let desired_unit = self.context.unit_file().ok();
            let desired_environment = self.context.environment_file(key_file).ok();
            match (desired_unit, desired_environment) {
                (Some(unit), Some(environment)) => {
                    installation_decision(
                        &local.unit,
                        &local.environment,
                        &local.current,
                        &unit,
                        &environment,
                        &SupervisorContext::desired_current_target(hash),
                    ) == InstallDecision::OverwriteRequired
                }
                _ => any_install,
            }
        } else {
            any_install
        };
        let handoff_pending = local.handoff_pending && !current_process_managed;
        let restart_pending = self
            .restart_pending
            .load(std::sync::atomic::Ordering::Acquire);
        let state = if !supported {
            "unsupported"
        } else if !available {
            "unavailable"
        } else if foreign {
            "foreign"
        } else if restart_pending {
            "restartPending"
        } else if handoff_pending {
            "handoffPending"
        } else if overwrite_required {
            "overwriteRequired"
        } else if active {
            "active"
        } else if enabled {
            "enabled"
        } else if installed || systemd.load_state == "loaded" {
            "installed"
        } else {
            "notInstalled"
        };
        SupervisorStatus {
            supported,
            available,
            installed,
            managed,
            enabled,
            active,
            current_process_managed,
            handoff_pending,
            restart_pending,
            overwrite_required,
            state: state.into(),
            unit_name: UNIT_NAME,
            unit_path: self.context.unit_path.to_string_lossy().into_owned(),
            install_root: self.context.install_root.to_string_lossy().into_owned(),
            byte_api_key_file: if managed {
                local.byte_api_key_file
            } else {
                None
            },
            linger_enabled,
        }
    }

    async fn install(&self, request: InstallRequest) -> Result<InstallOutcome, InstallError> {
        let Ok(_operation) = self.install_lock.try_lock() else {
            return Err(InstallError::conflict(
                "SUPERVISOR_OPERATION_IN_PROGRESS",
                None,
            ));
        };
        if !cfg!(target_os = "linux") || !Path::new(SYSTEMCTL).exists() {
            return Err(InstallError::unavailable());
        }
        if self.context.web_dist.is_none() {
            return Err(InstallError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "WEB_DIST_UNAVAILABLE",
                None,
            ));
        }
        let requested_key = PathBuf::from(request.byte_api_key_file);
        let key_context = self.context.clone();
        let byte_api_key_file = tokio::task::spawn_blocking(move || {
            let path = validate_byte_api_key_file(&requested_key)?;
            let identity = canonical_path_identity(&path)?;
            let install_root = canonical_path_identity(&key_context.install_root)?;
            if identity.starts_with(&install_root)
                || same_path_identity(&path, &key_context.unit_path)
                || same_path_identity(&path, &key_context.environment_path)
                || same_path_identity(&path, &key_context.handoff_path)
            {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Byte API key file path overlaps managed supervisor files",
                ));
            }
            Ok(path)
        })
        .await
        .map_err(|error| InstallError::internal(error.to_string()))?
        .map_err(|error| {
            InstallError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_BYTE_API_KEY_FILE",
                Some(error.to_string()),
            )
        })?;
        let byte_api_key_file = path_utf8(&byte_api_key_file)
            .map_err(|error| InstallError::internal(error.to_string()))?
            .to_string();
        let manager_environment = self
            .context
            .manager_environment()
            .map_err(|_| InstallError::unavailable())?;
        let manager_config =
            manager_config_home(&manager_environment, Path::new(&self.context.home))
                .await
                .ok_or_else(InstallError::unavailable)?;
        if !same_path_identity(&manager_config, Path::new(&self.context.config_home)) {
            return Err(InstallError::conflict(
                "SUPERVISOR_MANAGER_CONFIG_MISMATCH",
                None,
            ));
        }
        let systemd = systemd_status(&manager_environment)
            .await
            .ok_or_else(InstallError::unavailable)?;
        if !systemd.drop_in_paths.is_empty()
            || (systemd.load_state != "not-found"
                && !systemd.load_state.is_empty()
                && (systemd.description != UNIT_DESCRIPTION
                    || systemd
                        .fragment_path
                        .as_ref()
                        .is_none_or(|path| !same_path_identity(path, &self.context.unit_path))))
        {
            return Err(InstallError::conflict(
                "SUPERVISOR_FOREIGN_UNIT",
                Some("systemd loaded a unit from another path".into()),
            ));
        }
        let current_record = HandoffRecord::current()
            .ok_or_else(|| InstallError::internal("failed to identify current process".into()))?;
        let was_enabled = unit_enabled(&systemd);
        let context = self.context.clone();
        let source_hash = tokio::task::spawn_blocking(move || context.source_hash())
            .await
            .map_err(|error| InstallError::internal(error.to_string()))?
            .map_err(|error| InstallError::internal(error.to_string()))?;
        let desired_unit = self
            .context
            .unit_file()
            .map_err(|error| InstallError::internal(error.to_string()))?;
        let desired_environment = self
            .context
            .environment_file(&byte_api_key_file)
            .map_err(|error| InstallError::internal(error.to_string()))?;
        let desired_current = SupervisorContext::desired_current_target(&source_hash);
        let unit_path = self.context.unit_path.clone();
        let environment_path = self.context.environment_path.clone();
        let unit_for_decision = desired_unit.clone();
        let environment_for_decision = desired_environment.clone();
        let current_for_decision = desired_current.clone();
        let context_for_decision = self.context.clone();
        let decision = tokio::task::spawn_blocking(move || {
            let unit = inspect_managed_file(&unit_path, managed_unit_content);
            let environment = inspect_managed_file(&environment_path, managed_environment_content);
            let current = current_release(&context_for_decision);
            installation_decision(
                &unit,
                &environment,
                &current,
                &unit_for_decision,
                &environment_for_decision,
                &current_for_decision,
            )
        })
        .await
        .map_err(|error| InstallError::internal(error.to_string()))?;
        if decision == InstallDecision::Foreign {
            return Err(InstallError::conflict("SUPERVISOR_FOREIGN_INSTALL", None));
        }
        if decision == InstallDecision::OverwriteRequired && !request.overwrite {
            return Err(InstallError::conflict(
                "SUPERVISOR_OVERWRITE_REQUIRED",
                None,
            ));
        }
        let current_process_managed = systemd.main_pid == std::process::id()
            && matches!(systemd.active_state.as_str(), "active" | "reloading");
        let mut transaction = InstallTransaction::capture(
            self.context.clone(),
            manager_environment.clone(),
            was_enabled,
            matches!(systemd.active_state.as_str(), "active" | "reloading"),
            current_record,
        )
        .map_err(|error| InstallError::internal(error.to_string()))?;
        if decision == InstallDecision::Current && current_process_managed {
            let restart_required = self
                .restart_pending
                .load(std::sync::atomic::Ordering::Acquire);
            if !restart_required {
                if let Err(error) = reload_systemd_definition(&manager_environment).await {
                    transaction.rollback().await;
                    return Err(error);
                }
                if let Err(error) =
                    run_systemctl(&manager_environment, &["enable", UNIT_NAME]).await
                {
                    transaction.newly_enabled = systemd_status(&manager_environment)
                        .await
                        .is_some_and(|status| !was_enabled && unit_enabled(&status));
                    transaction.rollback().await;
                    return Err(error);
                }
                transaction.newly_enabled = !was_enabled;
                transaction.commit();
                return Ok(InstallOutcome {
                    status: self.status().await,
                    restart_required: false,
                });
            }
        }
        let handoff_path = self.context.handoff_path.clone();
        let pending = tokio::task::spawn_blocking(move || read_handoff_record(&handoff_path))
            .await
            .map_err(|error| InstallError::internal(error.to_string()))?
            .map_err(|error| InstallError::internal(error.to_string()))?;
        if pending.as_ref() == Some(&current_record) && current_record.is_live() {
            if decision != InstallDecision::Current {
                return Err(InstallError::conflict(
                    "SUPERVISOR_HANDOFF_IN_PROGRESS",
                    None,
                ));
            }
            if !handoff_started(&systemd, &self.context.unit_path) {
                transaction.handoff_attempted = true;
                transaction.start_attempted = !transaction.snapshot.active;
                if let Err(error) = start_systemd_service(&manager_environment).await {
                    transaction.rollback().await;
                    return Err(error);
                }
                if let Err(error) =
                    wait_for_handoff_start(&self.context.unit_path, &manager_environment).await
                {
                    transaction.rollback().await;
                    return Err(error);
                }
            }
            transaction.commit();
            let mut status = self.status().await;
            status.handoff_pending = true;
            status.state = "handoffPending".into();
            return Ok(InstallOutcome {
                status,
                restart_required: true,
            });
        }
        if pending.is_some_and(HandoffRecord::is_live) {
            return Err(InstallError::conflict(
                "SUPERVISOR_HANDOFF_IN_PROGRESS",
                None,
            ));
        }
        if !matches!(systemd.active_state.as_str(), "inactive" | "failed" | "")
            && systemd.main_pid != std::process::id()
        {
            return Err(InstallError::conflict(
                "SUPERVISOR_ACTIVE_PROCESS",
                Some(format!(
                    "systemd reports another active MainPID {} in state {}/{}",
                    systemd.main_pid, systemd.active_state, systemd.sub_state
                )),
            ));
        }
        if decision != InstallDecision::Current {
            transaction.files_mutated = true;
            let context = self.context.clone();
            let publish_hash = source_hash.clone();
            let publication = tokio::task::spawn_blocking(move || {
                publish_install(&context, &publish_hash, &desired_environment, &desired_unit)
            })
            .await
            .map_err(|error| InstallError::internal(error.to_string()))
            .and_then(|result| result.map_err(|error| InstallError::internal(error.to_string())));
            if let Err(error) = publication {
                transaction.rollback().await;
                return Err(error);
            }
        }
        if let Err(error) = reload_systemd_definition(&manager_environment).await {
            transaction.rollback().await;
            return Err(error);
        }
        if let Err(error) = run_systemctl(&manager_environment, &["enable", UNIT_NAME]).await {
            transaction.newly_enabled = systemd_status(&manager_environment)
                .await
                .is_some_and(|status| !was_enabled && unit_enabled(&status));
            transaction.rollback().await;
            return Err(error);
        }
        transaction.newly_enabled = !was_enabled;
        if !current_process_managed {
            transaction.handoff_attempted = true;
            let path = self.context.handoff_path.clone();
            let handoff =
                tokio::task::spawn_blocking(move || write_handoff_record(&path, current_record))
                    .await
                    .map_err(|error| InstallError::internal(error.to_string()))
                    .and_then(|result| {
                        result.map_err(|error| InstallError::internal(error.to_string()))
                    });
            if let Err(error) = handoff {
                transaction.rollback().await;
                return Err(error);
            }
        }
        transaction.start_attempted = !current_process_managed;
        if let Err(error) = start_systemd_service(&manager_environment).await {
            transaction.rollback().await;
            return Err(error);
        }
        if !current_process_managed
            && let Err(error) =
                wait_for_handoff_start(&self.context.unit_path, &manager_environment).await
        {
            transaction.rollback().await;
            return Err(error);
        }
        transaction.commit();
        let mut status = self.status().await;
        if current_process_managed {
            self.restart_pending
                .store(true, std::sync::atomic::Ordering::Release);
            status.restart_pending = true;
            status.state = "restartPending".into();
        } else {
            status.handoff_pending = true;
            status.state = "handoffPending".into();
        }
        Ok(InstallOutcome {
            status,
            restart_required: true,
        })
    }
}

impl SupervisorStatus {
    fn unavailable() -> Self {
        let home = effective_home_directory().unwrap_or_else(|_| crate::filesystem::home_dir());
        let config_home = expected_config_home().unwrap_or_else(|_| home.join(".config"));
        Self {
            supported: cfg!(target_os = "linux"),
            available: false,
            installed: false,
            managed: false,
            enabled: false,
            active: false,
            current_process_managed: false,
            handoff_pending: false,
            restart_pending: false,
            overwrite_required: false,
            state: if cfg!(target_os = "linux") {
                "unavailable".into()
            } else {
                "unsupported".into()
            },
            unit_name: UNIT_NAME,
            unit_path: managed_unit_path(&config_home)
                .to_string_lossy()
                .into_owned(),
            install_root: home
                .join(".local/lib/devhatch")
                .to_string_lossy()
                .into_owned(),
            byte_api_key_file: None,
            linger_enabled: false,
        }
    }
}

impl InstallError {
    fn new(status: StatusCode, code: &'static str, detail: Option<String>) -> Self {
        Self {
            status,
            code,
            detail,
        }
    }

    fn conflict(code: &'static str, detail: Option<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, detail)
    }

    fn unavailable() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "SUPERVISOR_UNAVAILABLE",
            None,
        )
    }

    fn internal(detail: String) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "SUPERVISOR_INSTALL_FAILED",
            Some(detail),
        )
    }

    fn into_response(self) -> Response {
        if let Some(detail) = self.detail {
            eprintln!("Supervisor operation failed: {detail}");
        }
        auth::with_no_store(ApiError::new(self.status, self.code).into_response())
    }
}

pub(crate) async fn get(State(state): State<Arc<AppState>>) -> Response {
    let status = match state.supervisor() {
        Some(supervisor) => supervisor.status().await,
        None => SupervisorStatus::unavailable(),
    };
    auth::with_no_store(Json(serde_json::json!({ "supervisor": status })).into_response())
}

pub(crate) async fn install(
    State(state): State<Arc<AppState>>,
    request: Result<Json<InstallRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = request else {
        return auth::with_no_store(
            ApiError::new(StatusCode::BAD_REQUEST, "INVALID_REQUEST").into_response(),
        );
    };
    let Some(supervisor) = state.supervisor() else {
        return InstallError::unavailable().into_response();
    };
    match supervisor.install(request).await {
        Ok(outcome) => {
            let status = if outcome.restart_required {
                StatusCode::ACCEPTED
            } else {
                StatusCode::OK
            };
            let response = auth::with_no_store(
                (
                    status,
                    Json(serde_json::json!({ "supervisor": outcome.status })),
                )
                    .into_response(),
            );
            if outcome.restart_required {
                state.request_internal_shutdown();
            }
            response
        }
        Err(error) => error.into_response(),
    }
}

fn durable_path_environment(name: &str) -> bool {
    matches!(
        name,
        "CODEX_HOME"
            | "TRAE_HOME"
            | "TRAECLI_HOME"
            | "PI_CODING_AGENT_DIR"
            | "PI_CODING_AGENT_SESSION_DIR"
            | "SKILLINK_HOME"
    )
}

fn normalize_durable_path(value: &str, home: &Path, cwd: &Path) -> io::Result<String> {
    let path = Path::new(value);
    let path = if path == Path::new("~") {
        home.to_path_buf()
    } else if let Ok(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
    .clean();
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "managed path is not absolute",
        ));
    }
    path_utf8(&path).map(str::to_string)
}

fn normalize_durable_path_list(value: &str, home: &Path, cwd: &Path) -> io::Result<String> {
    let paths = env::split_paths(value)
        .map(|path| {
            normalize_durable_path(
                path.to_str().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "path list is not UTF-8")
                })?,
                home,
                cwd,
            )
            .map(PathBuf::from)
        })
        .collect::<io::Result<Vec<_>>>()?;
    let value = env::join_paths(paths)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    environment_string(&value)
}

fn validate_managed_path_values(values: &BTreeMap<String, String>) -> io::Result<()> {
    for name in [
        "HOME",
        "XDG_CONFIG_HOME",
        "XDG_RUNTIME_DIR",
        "DEVHATCH_DATA_DIR",
        "DEVHATCH_WEB_DIST",
        "DEVHATCH_CWD",
        "BYTE_API_API_KEY_FILE",
    ] {
        if !Path::new(&values[name]).is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "managed path is not absolute",
            ));
        }
    }
    for name in OPTIONAL_ENVIRONMENT {
        if let Some(value) = values.get(*name) {
            let sanitized = sanitize_optional_environment(
                name,
                value,
                Path::new(&values["HOME"]),
                Path::new(&values["DEVHATCH_CWD"]),
            )?;
            if sanitized != *value {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "managed optional environment is not normalized",
                ));
            }
        }
    }
    validate_runtime_directory(Path::new(&values["XDG_RUNTIME_DIR"]))?;
    validate_bus_address(
        Path::new(&values["XDG_RUNTIME_DIR"]),
        &values["DBUS_SESSION_BUS_ADDRESS"],
    )?;
    let config_home = Path::new(&values["XDG_CONFIG_HOME"]);
    let resolved_config =
        resolve_config_home(Path::new(&values["HOME"]), Some(config_home.as_os_str()))?;
    if resolved_config != config_home.clean() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "managed config path is not normalized",
        ));
    }
    Ok(())
}

fn effective_home_directory() -> io::Result<PathBuf> {
    logical_owner_controlled_directory(&crate::filesystem::home_dir())
}

fn logical_owner_controlled_directory(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "directory must be absolute",
        ));
    }
    let logical = path.clean();
    let canonical = fs::canonicalize(&logical)?;
    validate_owner_controlled_hierarchy(&canonical)?;
    Ok(logical)
}

fn canonical_owner_controlled_directory(path: &Path) -> io::Result<PathBuf> {
    let logical = logical_owner_controlled_directory(path)?;
    fs::canonicalize(logical)
}

fn canonical_path_identity(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path must be absolute",
        ));
    }
    let path = path.clean();
    if let Ok(canonical) = fs::canonicalize(&path) {
        return Ok(canonical);
    }
    let mut missing = Vec::new();
    let mut ancestor = path.as_path();
    loop {
        match fs::canonicalize(ancestor) {
            Ok(canonical) => {
                validate_owner_controlled_hierarchy(&canonical)?;
                return Ok(missing
                    .into_iter()
                    .rev()
                    .fold(canonical, |path: PathBuf, name| path.join(name)));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let name = ancestor.file_name().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, "path has no existing ancestor")
                })?;
                missing.push(name.to_os_string());
                ancestor = ancestor.parent().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, "path has no existing ancestor")
                })?;
            }
            Err(error) => return Err(error),
        }
    }
}

fn same_path_identity(left: &Path, right: &Path) -> bool {
    match (
        canonical_path_identity(left),
        canonical_path_identity(right),
    ) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn validate_owner_controlled_hierarchy(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;

    let euid = unsafe { libc::geteuid() };
    let mut current = Some(path);
    let mut controlled = false;
    while let Some(directory) = current {
        let metadata = fs::symlink_metadata(directory)?;
        if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "directory hierarchy is unsafe",
            ));
        }
        if metadata.uid() != euid {
            break;
        }
        if metadata.mode() & 0o022 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "directory hierarchy is writable by another user",
            ));
        }
        controlled = true;
        current = directory.parent().filter(|parent| *parent != directory);
    }
    if !controlled {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "directory is not owned by the current user",
        ));
    }
    Ok(())
}

fn resolve_config_home(home: &Path, configured: Option<&std::ffi::OsStr>) -> io::Result<PathBuf> {
    if let Some(configured) = configured {
        let configured = Path::new(configured);
        if configured.is_absolute() {
            let configured = configured.clean();
            if fs::symlink_metadata(&configured).is_ok() {
                let _ = logical_owner_controlled_directory(&configured)?;
                return Ok(configured);
            }
            let identity = canonical_path_identity(&configured)?;
            let home_identity = fs::canonicalize(home)?;
            if !identity.starts_with(&home_identity) {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "configured directory is outside HOME",
                ));
            }
            return Ok(configured);
        }
    }
    let home = logical_owner_controlled_directory(home)?;
    let default = home.join(".config");
    let _ = canonical_path_identity(&default)?;
    Ok(default)
}

fn default_runtime_directory() -> PathBuf {
    PathBuf::from(format!("/run/user/{}", unsafe { libc::geteuid() }))
}

fn resolve_runtime_directory(
    configured: Option<&std::ffi::OsStr>,
    default: &Path,
) -> io::Result<PathBuf> {
    if let Some(configured) = configured {
        let configured = Path::new(configured);
        if configured.is_absolute()
            && let Ok(runtime) = canonical_owner_controlled_directory(configured)
        {
            return Ok(runtime);
        }
    }
    canonical_owner_controlled_directory(default)
}

fn validate_unix_socket(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_socket()
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Unix socket is unsafe",
        ));
    }
    Ok(())
}

fn expected_bus_address(runtime_dir: &Path) -> io::Result<String> {
    validate_runtime_directory(runtime_dir)?;
    let bus = runtime_dir.join("bus");
    validate_unix_socket(&bus)?;
    Ok(format!("unix:path={}", path_utf8(&bus)?))
}

fn validate_bus_address(runtime_dir: &Path, value: &str) -> io::Result<()> {
    if value == expected_bus_address(runtime_dir)? {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "session bus address does not match runtime directory",
        ))
    }
}

fn validated_manager_environment(runtime_dir: &Path) -> io::Result<BTreeMap<String, String>> {
    let runtime = path_utf8(runtime_dir)?.to_string();
    let bus = expected_bus_address(runtime_dir)?;
    Ok(BTreeMap::from([
        ("XDG_RUNTIME_DIR".into(), runtime),
        ("DBUS_SESSION_BUS_ADDRESS".into(), bus),
    ]))
}

fn configure_manager_command(
    command: &mut tokio::process::Command,
    environment: &BTreeMap<String, String>,
) {
    command.env_clear().envs(environment);
}

fn sanitize_optional_environment(
    name: &str,
    value: &str,
    home: &Path,
    cwd: &Path,
) -> io::Result<String> {
    if durable_path_environment(name) {
        return normalize_durable_path(value, home, cwd);
    }
    if name == "DEVHATCH_IMPORT_ROOTS" {
        return normalize_durable_path_list(value, home, cwd);
    }
    if name == "SSH_AUTH_SOCK" {
        let path = Path::new(value);
        if !path.is_absolute() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "SSH_AUTH_SOCK must be absolute",
            ));
        }
        let canonical = fs::canonicalize(path)?;
        validate_unix_socket(&canonical)?;
        return path_utf8(&canonical).map(str::to_string);
    }
    if matches!(
        name,
        "HTTP_PROXY" | "HTTPS_PROXY" | "http_proxy" | "https_proxy"
    ) {
        let url = url::Url::parse(value)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || value
                .split_once("://")
                .and_then(|(_, authority)| authority.split('/').next())
                .is_some_and(|authority| authority.contains('@'))
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "proxy URL must be noncredential HTTP(S)",
            ));
        }
        return Ok(value.into());
    }
    if matches!(name, "NO_PROXY" | "no_proxy") {
        if value.is_empty()
            || value.split(',').any(|entry| {
                let entry = entry.trim();
                entry.is_empty()
                    || entry.contains('@')
                    || entry.contains(['\0', '\n', '\r', ' ', '\t'])
            })
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "NO_PROXY list is invalid",
            ));
        }
        return Ok(value.into());
    }
    match name {
        "SKILLINK_GIT_TIMEOUT_SECS" => validate_numeric_environment(value, 1, u64::MAX),
        "SKILLINK_GIT_CONCURRENCY" => validate_numeric_environment(value, 1, usize::MAX as u64),
        "SKILLINK_GIT_SHALLOW" if matches!(value, "0" | "1") => Ok(value.into()),
        "SKILLINK_GIT_SHALLOW" => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "SKILLINK_GIT_SHALLOW must be 0 or 1",
        )),
        _ => Ok(value.into()),
    }
}

fn validate_numeric_environment(value: &str, minimum: u64, maximum: u64) -> io::Result<String> {
    let number = value
        .parse::<u64>()
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    if !(minimum..=maximum).contains(&number) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "numeric environment value is out of range",
        ));
    }
    Ok(value.into())
}

fn managed_unit_path(config_home: &Path) -> PathBuf {
    config_home.join("systemd/user").join(UNIT_NAME)
}

fn managed_environment_path(config_home: &Path) -> PathBuf {
    config_home.join("devhatch/devhatch.env")
}

fn managed_handoff_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join("devhatch/handoff.json")
}

fn expected_config_home() -> io::Result<PathBuf> {
    resolve_config_home(
        &effective_home_directory()?,
        env::var_os("XDG_CONFIG_HOME").as_deref(),
    )
}

fn expected_environment_path() -> io::Result<PathBuf> {
    Ok(managed_environment_path(&expected_config_home()?))
}

fn expected_handoff_path() -> io::Result<PathBuf> {
    Ok(managed_handoff_path(&resolve_runtime_directory(
        env::var_os("XDG_RUNTIME_DIR").as_deref(),
        &default_runtime_directory(),
    )?))
}

fn read_managed_environment(path: &Path) -> io::Result<BTreeMap<String, String>> {
    let content = read_private_regular_file(path, MAX_ENVIRONMENT_BYTES)?;
    parse_managed_environment(&content)
}

fn parse_managed_environment(content: &str) -> io::Result<BTreeMap<String, String>> {
    let mut values = BTreeMap::new();
    let mut schema = false;
    for line in content.lines() {
        let (name, encoded) = line.split_once('=').ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidData, "invalid environment entry")
        })?;
        if name == ENV_SCHEMA_NAME {
            if schema || encoded != "\"1\"" {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid environment schema",
                ));
            }
            schema = true;
            continue;
        }
        if !REQUIRED_ENVIRONMENT.contains(&name) && !OPTIONAL_ENVIRONMENT.contains(&name) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unknown environment entry",
            ));
        }
        let value = parse_systemd_environment_value(encoded)?;
        if values.insert(name.to_string(), value).is_some() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "duplicate environment entry",
            ));
        }
    }
    if !schema
        || REQUIRED_ENVIRONMENT
            .iter()
            .any(|name| !values.contains_key(*name))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "incomplete environment file",
        ));
    }
    validate_managed_path_values(&values)?;
    Ok(values)
}

fn parse_systemd_environment_value(value: &str) -> io::Result<String> {
    let value = value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid environment value"))?;
    let mut decoded = String::new();
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character == '\\' {
            match characters.next() {
                Some('\\') => decoded.push('\\'),
                Some('"') => decoded.push('"'),
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "invalid environment escape",
                    ));
                }
            }
        } else if character == '"' {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid environment quote",
            ));
        } else {
            decoded.push(character);
        }
    }
    validate_environment_value(&decoded)?;
    Ok(decoded)
}

fn read_private_regular_file(path: &Path, limit: u64) -> io::Result<String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.nlink() != 1
        || metadata.mode() & 0o777 != 0o600
        || metadata.len() > limit
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe managed environment file",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    unix_open_flags(&mut options, 0);
    let mut file = options.open(path)?;
    if !same_identity(&metadata, &file.metadata()?) {
        return Err(io::Error::other(
            "managed environment changed while opening",
        ));
    }
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "managed environment is too large",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "managed environment is not UTF-8",
        )
    })
}

pub(crate) fn run_systemd_launcher(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !path.is_absolute() || !same_path_identity(path, &expected_environment_path()?) {
        return Err("invalid managed environment path".into());
    }
    let environment = read_managed_environment(path)?;
    let executable = env::current_exe()?;
    let executable = fs::canonicalize(executable)?;
    let mut command = std::process::Command::new(executable);
    command
        .env_clear()
        .envs(environment)
        .arg("--systemd-server");
    use std::os::unix::process::CommandExt;
    Err(command.exec().into())
}

pub(crate) fn run_handoff_helper(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if !path.is_absolute() || !allowed_handoff_path(path) {
        return Err("invalid systemd handoff record path".into());
    }
    let Some(record) = read_handoff_record(path)? else {
        return Ok(());
    };
    let deadline = std::time::Instant::now() + HANDOFF_TIMEOUT;
    while record.is_live() {
        if std::time::Instant::now() >= deadline {
            return Err("timed out waiting for the previous DevHatch process".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    remove_handoff_record_if_same(path, record)?;
    Ok(())
}

async fn systemd_status(environment: &BTreeMap<String, String>) -> Option<SystemdStatus> {
    if !cfg!(target_os = "linux") || !Path::new(SYSTEMCTL).exists() {
        return None;
    }
    let mut command = tokio::process::Command::new(SYSTEMCTL);
    configure_manager_command(&mut command, environment);
    command.args([
        "--user",
        "show",
        UNIT_NAME,
        "--property=Description",
        "--property=LoadState",
        "--property=UnitFileState",
        "--property=ActiveState",
        "--property=SubState",
        "--property=MainPID",
        "--property=ControlPID",
        "--property=Job",
        "--property=FragmentPath",
        "--property=DropInPaths",
        "--property=NeedDaemonReload",
        "--no-pager",
    ]);
    let output =
        match process::command_output(&mut command, COMMAND_TIMEOUT, COMMAND_OUTPUT_LIMIT).await {
            Ok(output) => output,
            Err(error) => {
                eprintln!("systemctl show failed: {error}");
                return None;
            }
        };
    if !output.status.success() {
        eprintln!(
            "systemctl show failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        );
        return None;
    }
    let stdout = match String::from_utf8(output.stdout) {
        Ok(stdout) => stdout,
        Err(error) => {
            eprintln!("systemctl show returned invalid UTF-8: {error}");
            return None;
        }
    };
    Some(parse_systemd_status(&stdout))
}

fn parse_systemd_status(output: &str) -> SystemdStatus {
    let mut status = SystemdStatus::default();
    for line in output.lines() {
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        match name {
            "Description" => status.description = value.into(),
            "LoadState" => status.load_state = value.into(),
            "UnitFileState" => status.unit_file_state = value.into(),
            "ActiveState" => status.active_state = value.into(),
            "SubState" => status.sub_state = value.into(),
            "MainPID" => status.main_pid = value.parse().unwrap_or(0),
            "ControlPID" => status.control_pid = value.parse().unwrap_or(0),
            "Job" => status.job = value.into(),
            "FragmentPath" if !value.is_empty() => status.fragment_path = Some(value.into()),
            "DropInPaths" => status.drop_in_paths = parse_systemd_paths(value),
            "NeedDaemonReload" => status.need_daemon_reload = value == "yes",
            _ => {}
        }
    }
    status
}

fn parse_systemd_paths(value: &str) -> Vec<PathBuf> {
    value
        .split_whitespace()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .collect()
}

fn parse_manager_environment(output: &str) -> Option<BTreeMap<String, String>> {
    let mut values = BTreeMap::new();
    for line in output.lines() {
        let Some((name, encoded)) = line.split_once('=') else {
            continue;
        };
        if !matches!(name, "HOME" | "XDG_CONFIG_HOME") {
            continue;
        }
        let value = if encoded.starts_with('"') {
            parse_systemd_environment_value(encoded).ok()?
        } else {
            validate_environment_value(encoded).ok()?;
            encoded.to_string()
        };
        if values.insert(name.to_string(), value).is_some() {
            return None;
        }
    }
    Some(values)
}

fn parse_manager_config_home(output: &str, home: &Path) -> io::Result<PathBuf> {
    let values = parse_manager_environment(output)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "invalid manager environment"))?;
    resolve_config_home(
        home,
        values.get("XDG_CONFIG_HOME").map(std::ffi::OsStr::new),
    )
}

async fn manager_config_home(
    environment: &BTreeMap<String, String>,
    home: &Path,
) -> Option<PathBuf> {
    let mut command = tokio::process::Command::new(SYSTEMCTL);
    configure_manager_command(&mut command, environment);
    command.args(["--user", "show-environment"]);
    let output = process::command_output(&mut command, COMMAND_TIMEOUT, COMMAND_OUTPUT_LIMIT)
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let output = String::from_utf8(output.stdout).ok()?;
    let values = parse_manager_environment(&output)?;
    let manager_home = values.get("HOME").map(Path::new).unwrap_or(home);
    if !same_path_identity(manager_home, home) {
        return None;
    }
    parse_manager_config_home(&output, home).ok()
}

async fn linger_enabled(environment: &BTreeMap<String, String>) -> bool {
    if !cfg!(target_os = "linux") || !Path::new(LOGINCTL).exists() {
        return false;
    }
    let uid = unsafe { libc::geteuid() }.to_string();
    let mut command = tokio::process::Command::new(LOGINCTL);
    configure_manager_command(&mut command, environment);
    command.args([
        "show-user",
        &uid,
        "--property=Linger",
        "--value",
        "--no-pager",
    ]);
    match process::command_output(&mut command, COMMAND_TIMEOUT, 1024).await {
        Ok(output) if output.status.success() => {
            output.stdout == b"yes\n" || output.stdout == b"yes"
        }
        Ok(output) => {
            eprintln!(
                "loginctl show-user failed with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            );
            false
        }
        Err(error) => {
            eprintln!("loginctl show-user failed: {error}");
            false
        }
    }
}

async fn wait_for_handoff_start(
    expected_fragment: &Path,
    environment: &BTreeMap<String, String>,
) -> Result<SystemdStatus, InstallError> {
    let deadline = tokio::time::Instant::now() + COMMAND_TIMEOUT;
    loop {
        let status = systemd_status(environment)
            .await
            .ok_or_else(InstallError::unavailable)?;
        if handoff_started(&status, expected_fragment) {
            return Ok(status);
        }
        if status.active_state == "failed" || tokio::time::Instant::now() >= deadline {
            return Err(InstallError::internal(format!(
                "systemd did not enter handoff start-pre state: {}/{} job={} control_pid={}",
                status.active_state, status.sub_state, status.job, status.control_pid
            )));
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

async fn reload_systemd_definition(
    environment: &BTreeMap<String, String>,
) -> Result<(), InstallError> {
    run_systemctl(environment, &["daemon-reload"]).await?;
    let status = systemd_status(environment)
        .await
        .ok_or_else(InstallError::unavailable)?;
    if status.need_daemon_reload {
        return Err(InstallError::internal(
            "systemd still requires daemon-reload".into(),
        ));
    }
    Ok(())
}

async fn start_systemd_service(environment: &BTreeMap<String, String>) -> Result<(), InstallError> {
    run_systemctl(environment, &["start", "--no-block", UNIT_NAME]).await
}

async fn run_systemctl(
    environment: &BTreeMap<String, String>,
    arguments: &[&str],
) -> Result<(), InstallError> {
    let mut command = tokio::process::Command::new(SYSTEMCTL);
    configure_manager_command(&mut command, environment);
    command.arg("--user").args(arguments);
    let output = process::command_output(&mut command, COMMAND_TIMEOUT, COMMAND_OUTPUT_LIMIT)
        .await
        .map_err(|error| InstallError::internal(format!("systemctl {arguments:?}: {error}")))?;
    if output.status.success() {
        return Ok(());
    }
    Err(InstallError::internal(format!(
        "systemctl {arguments:?} failed with {}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

fn handoff_started(status: &SystemdStatus, expected_fragment: &Path) -> bool {
    status.description == UNIT_DESCRIPTION
        && status
            .fragment_path
            .as_ref()
            .is_some_and(|path| same_path_identity(path, expected_fragment))
        && status.drop_in_paths.is_empty()
        && status.active_state == "activating"
        && status.sub_state == "start-pre"
        && status.control_pid != 0
        && !status.job.is_empty()
}

fn empty_local_status() -> LocalStatus {
    LocalStatus {
        unit: ManagedFile::Missing,
        environment: ManagedFile::Missing,
        current: CurrentInstall::Missing,
        source_hash: None,
        byte_api_key_file: None,
        handoff_pending: false,
    }
}

fn inspect_local(context: &SupervisorContext) -> LocalStatus {
    let unit = inspect_managed_file(&context.unit_path, managed_unit_content);
    let environment = inspect_managed_file(&context.environment_path, managed_environment_content);
    let current = current_release(context);
    let byte_api_key_file = match &environment {
        ManagedFile::Managed(content) => {
            parse_environment_value(content, "BYTE_API_API_KEY_FILE").ok()
        }
        _ => None,
    };
    let source_hash = if context.web_dist.is_some() {
        context
            .source_hash()
            .map_err(|error| {
                eprintln!("Failed to hash supervisor sources: {error}");
                error
            })
            .ok()
    } else {
        None
    };
    let handoff_pending = read_handoff_record(&context.handoff_path)
        .map_err(|error| {
            eprintln!("Failed to inspect supervisor handoff record: {error}");
            error
        })
        .ok()
        .flatten()
        .is_some_and(HandoffRecord::is_live);
    LocalStatus {
        unit,
        environment,
        current,
        source_hash,
        byte_api_key_file,
        handoff_pending,
    }
}

fn inspect_managed_file(path: &Path, managed: fn(&str) -> bool) -> ManagedFile {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return ManagedFile::Missing,
        Err(_) => return ManagedFile::Foreign,
        Ok(_) => {}
    }
    match read_small_regular_file(path, 128 * 1024, 0o600) {
        Ok(content) if managed(&content) => ManagedFile::Managed(content),
        _ => ManagedFile::Foreign,
    }
}

fn managed_unit_content(content: &str) -> bool {
    content
        .lines()
        .filter(|line| line.starts_with("Description="))
        .eq([format!("Description={UNIT_DESCRIPTION}")]
            .iter()
            .map(String::as_str))
        && content
            .lines()
            .filter(|line| line.starts_with("X-DevHatch-Managed="))
            .eq([UNIT_MARKER])
}

fn managed_environment_content(content: &str) -> bool {
    content
        .lines()
        .filter(|line| line.starts_with("DEVHATCH_SUPERVISOR_SCHEMA="))
        .eq([ENV_SCHEMA])
}

fn inspect_current(path: &Path) -> CurrentInstall {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return CurrentInstall::Missing,
        Err(_) => return CurrentInstall::Foreign,
    };
    use std::os::unix::fs::MetadataExt;
    if !metadata.file_type().is_symlink() || metadata.uid() != unsafe { libc::geteuid() } {
        return CurrentInstall::Foreign;
    }
    match fs::read_link(path) {
        Ok(target) if managed_release_target(&target) => {
            let release = path.parent().map(|parent| parent.join(&target));
            match release.and_then(|release| fs::symlink_metadata(release).ok()) {
                Some(metadata)
                    if valid_release_target(&target) && metadata.file_type().is_dir() =>
                {
                    CurrentInstall::Managed(target)
                }
                _ => CurrentInstall::ManagedInvalid(target),
            }
        }
        _ => CurrentInstall::Foreign,
    }
}

fn managed_release_target(target: &Path) -> bool {
    let mut components = target.components();
    matches!(
        (components.next(), components.next(), components.next()),
        (
            Some(std::path::Component::Normal(releases)),
            Some(std::path::Component::Normal(_)),
            None
        ) if releases == "releases"
    )
}

fn valid_release_target(target: &Path) -> bool {
    if !managed_release_target(target) {
        return false;
    }
    let Some(hash) = target.file_name().and_then(|hash| hash.to_str()) else {
        return false;
    };
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn installation_decision(
    unit: &ManagedFile,
    environment: &ManagedFile,
    current: &CurrentInstall,
    desired_unit: &str,
    desired_environment: &str,
    desired_current: &Path,
) -> InstallDecision {
    if unit == &ManagedFile::Foreign
        || environment == &ManagedFile::Foreign
        || current == &CurrentInstall::Foreign
    {
        return InstallDecision::Foreign;
    }
    let any = unit != &ManagedFile::Missing
        || environment != &ManagedFile::Missing
        || current != &CurrentInstall::Missing;
    if !any {
        return InstallDecision::Fresh;
    }
    let matches = unit == &ManagedFile::Managed(desired_unit.to_string())
        && environment == &ManagedFile::Managed(desired_environment.to_string())
        && current == &CurrentInstall::Managed(desired_current.to_path_buf());
    if matches {
        InstallDecision::Current
    } else {
        InstallDecision::OverwriteRequired
    }
}

fn validate_byte_api_key_file(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Byte API key file path must be absolute",
        ));
    }
    let before = fs::symlink_metadata(path)?;
    if before.file_type().is_symlink() || !before.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Byte API key file must be a regular file",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    unix_open_flags(&mut options, 0);
    let file = options.open(path)?;
    let opened = file.metadata()?;
    validate_private_owned_file(&opened)?;
    if !same_identity(&before, &opened) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Byte API key file changed during validation",
        ));
    }
    let canonical = fs::canonicalize(path)?;
    let canonical_file = options.open(&canonical)?;
    if !same_identity(&opened, &canonical_file.metadata()?) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Byte API key file changed during canonicalization",
        ));
    }
    let value = path_utf8(&canonical)?;
    validate_environment_value(value)?;
    Ok(canonical)
}

fn validate_private_owned_file(metadata: &Metadata) -> io::Result<()> {
    validate_owned_file(metadata)?;
    use std::os::unix::fs::MetadataExt;
    if metadata.nlink() != 1 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file has multiple links",
        ));
    }
    if metadata.mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file grants group or other permissions",
        ));
    }
    Ok(())
}

fn validate_owned_file(metadata: &Metadata) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;

    if !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "file is not regular",
        ));
    }
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file has another owner",
        ));
    }
    Ok(())
}

fn ensure_managed_parents(context: &SupervisorContext) -> io::Result<()> {
    let home = Path::new(&context.home);
    let config_home = Path::new(&context.config_home);
    let _ = logical_owner_controlled_directory(home)?;
    for path in [home.join(".local"), home.join(".local/lib")] {
        ensure_owner_controlled_hierarchy_exists(&path)?;
    }
    ensure_owner_controlled_hierarchy_exists(config_home)?;
    ensure_owner_controlled_hierarchy_exists(&config_home.join("systemd"))?;
    Ok(())
}

fn ensure_owner_controlled_hierarchy_exists(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            let _ = logical_owner_controlled_directory(path)?;
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let parent = path.parent().ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "directory has no parent")
            })?;
            ensure_owner_controlled_hierarchy_exists(parent)?;
            fs::create_dir(path)?;
            fs::set_permissions(path, unix_permissions(0o700))?;
            validate_owner_controlled_directory(path)
        }
        Err(error) => Err(error),
    }
}

fn validate_owner_controlled_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "managed directory is unsafe",
        ));
    }
    Ok(())
}

fn publish_install(
    context: &SupervisorContext,
    expected_hash: &str,
    environment: &str,
    unit: &str,
) -> io::Result<()> {
    if inspect_current(&context.current_link()) == CurrentInstall::Foreign
        || inspect_managed_file(&context.unit_path, managed_unit_content) == ManagedFile::Foreign
        || inspect_managed_file(&context.environment_path, managed_environment_content)
            == ManagedFile::Foreign
    {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "foreign supervisor installation",
        ));
    }
    ensure_managed_parents(context)?;
    ensure_secure_directory(&context.install_root)?;
    ensure_secure_directory(&context.releases_dir())?;
    let release = publish_release(context, expected_hash)?;
    if release != context.releases_dir().join(expected_hash) {
        return Err(io::Error::other(
            "release publication returned an invalid path",
        ));
    }
    let environment_parent = context
        .environment_path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid environment path"))?;
    ensure_secure_directory(environment_parent)?;
    atomic_write_file(&context.environment_path, environment.as_bytes(), 0o600)?;
    let unit_parent = context
        .unit_path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid unit path"))?;
    ensure_secure_directory(unit_parent)?;
    atomic_write_file(&context.unit_path, unit.as_bytes(), 0o600)?;
    atomic_symlink(
        &context.current_link(),
        &SupervisorContext::desired_current_target(expected_hash),
    )?;
    Ok(())
}

fn validate_release_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;

    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "release directory is unsafe",
        ));
    }
    Ok(())
}

fn validate_release(path: &Path, expected_hash: &str) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    validate_release_directory(path)?;
    let binary = path.join("bin/devhatch-server");
    let binary_metadata = fs::symlink_metadata(&binary)?;
    if binary_metadata.file_type().is_symlink()
        || !binary_metadata.file_type().is_file()
        || binary_metadata.uid() != unsafe { libc::geteuid() }
        || binary_metadata.nlink() != 1
        || binary_metadata.permissions().mode() & 0o111 == 0
        || binary_metadata.permissions().mode() & 0o022 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "release executable is unsafe",
        ));
    }
    let index = path.join("web/dist/index.html");
    let index_metadata = fs::symlink_metadata(index)?;
    if index_metadata.file_type().is_symlink() || !index_metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "release web distribution is incomplete",
        ));
    }
    let hash = hash_layout(&binary, &path.join("web/dist"))?;
    if hash != expected_hash {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "release content does not match its hash",
        ));
    }
    Ok(())
}

fn current_release(context: &SupervisorContext) -> CurrentInstall {
    let current = inspect_current(&context.current_link());
    let CurrentInstall::Managed(target) = current else {
        return current;
    };
    let Some(hash) = target.file_name().and_then(|name| name.to_str()) else {
        return CurrentInstall::Foreign;
    };
    let release = context.install_root.join(&target);
    if validate_release(&release, hash).is_ok() {
        CurrentInstall::Managed(target)
    } else {
        CurrentInstall::ManagedInvalid(target)
    }
}

fn publish_release(context: &SupervisorContext, expected_hash: &str) -> io::Result<PathBuf> {
    let destination = context.releases_dir().join(expected_hash);
    let replace_existing = match fs::symlink_metadata(&destination) {
        Ok(_) => {
            validate_release_directory(&destination)?;
            if validate_release(&destination, expected_hash).is_ok() {
                return Ok(destination);
            }
            true
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error),
    };
    let staging = context
        .releases_dir()
        .join(format!(".tmp-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging)?;
    fs::set_permissions(&staging, unix_permissions(0o700))?;
    let result = (|| {
        fs::create_dir(staging.join("bin"))?;
        fs::set_permissions(staging.join("bin"), unix_permissions(0o700))?;
        fs::create_dir(staging.join("web"))?;
        fs::set_permissions(staging.join("web"), unix_permissions(0o700))?;
        fs::create_dir(staging.join("web/dist"))?;
        fs::set_permissions(staging.join("web/dist"), unix_permissions(0o700))?;
        copy_regular_source(
            &context.current_exe,
            &staging.join("bin/devhatch-server"),
            0o700,
        )?;
        copy_directory_contents(
            context.web_dist.as_deref().ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "web distribution unavailable")
            })?,
            &staging.join("web/dist"),
        )?;
        let copied_hash = hash_layout(
            &staging.join("bin/devhatch-server"),
            &staging.join("web/dist"),
        )?;
        if copied_hash != expected_hash {
            return Err(io::Error::other(
                "supervisor sources changed while being copied",
            ));
        }
        sync_directory_tree(&staging)?;
        if replace_existing {
            exchange_paths(&staging, &destination)?;
            sync_parent(&destination)?;
            fs::remove_dir_all(&staging)?;
            return Ok(());
        }
        match fs::rename(&staging, &destination) {
            Ok(()) => {
                sync_parent(&destination)?;
                Ok(())
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::AlreadyExists | io::ErrorKind::DirectoryNotEmpty
                ) =>
            {
                validate_release(&destination, expected_hash)?;
                Ok(())
            }
            Err(error) => Err(error),
        }
    })();
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result?;
    Ok(destination)
}

fn exchange_paths(left: &Path, right: &Path) -> io::Result<()> {
    use std::os::unix::ffi::OsStrExt;

    let left = std::ffi::CString::new(left.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))?;
    let right = std::ffi::CString::new(right.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains NUL"))?;
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            left.as_ptr(),
            libc::AT_FDCWD,
            right.as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn copy_directory_contents(source: &Path, destination: &Path) -> io::Result<()> {
    let source_metadata = fs::symlink_metadata(source)?;
    if source_metadata.file_type().is_symlink() || !source_metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "web distribution is not a regular directory",
        ));
    }
    copy_directory_level(source, destination)?;
    let after = fs::symlink_metadata(source)?;
    if !same_identity(&source_metadata, &after) {
        return Err(io::Error::other("web distribution changed while copying"));
    }
    Ok(())
}

fn copy_directory_level(source: &Path, destination: &Path) -> io::Result<()> {
    let mut entries = fs::read_dir(source)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let source_path = entry.path();
        let target = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "web distribution contains a symlink",
            ));
        }
        if metadata.file_type().is_dir() {
            fs::create_dir(&target)?;
            fs::set_permissions(&target, unix_permissions(0o700))?;
            copy_directory_level(&source_path, &target)?;
            if !same_identity(&metadata, &fs::symlink_metadata(&source_path)?) {
                return Err(io::Error::other(
                    "web distribution directory changed while copying",
                ));
            }
        } else if metadata.file_type().is_file() {
            copy_regular_source_with_metadata(&source_path, &target, 0o600, &metadata)?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "web distribution contains a non-regular file",
            ));
        }
    }
    Ok(())
}

fn copy_regular_source(source: &Path, destination: &Path, mode: u32) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "source is not a regular file",
        ));
    }
    copy_regular_source_with_metadata(source, destination, mode, &metadata)
}

fn copy_regular_source_with_metadata(
    source: &Path,
    destination: &Path,
    mode: u32,
    expected: &Metadata,
) -> io::Result<()> {
    let mut input_options = OpenOptions::new();
    input_options.read(true);
    unix_open_flags(&mut input_options, 0);
    let mut input = input_options.open(source)?;
    if !same_identity(expected, &input.metadata()?) {
        return Err(io::Error::other("source changed while opening"));
    }
    let mut output_options = OpenOptions::new();
    output_options.write(true).create_new(true);
    unix_open_flags(&mut output_options, mode);
    let mut output = output_options.open(destination)?;
    let copied = io::copy(
        &mut std::io::Read::by_ref(&mut input).take(expected.len().saturating_add(1)),
        &mut output,
    )?;
    if copied != expected.len() {
        return Err(io::Error::other("source changed while copying"));
    }
    output.flush()?;
    output.set_permissions(unix_permissions(mode))?;
    output.sync_all()?;
    if !same_identity(expected, &fs::symlink_metadata(source)?) {
        return Err(io::Error::other("source changed while copying"));
    }
    Ok(())
}

fn hash_layout(binary: &Path, web_dist: &Path) -> io::Result<String> {
    let mut hasher = Sha256::new();
    hash_regular_file(binary, Path::new("bin/devhatch-server"), &mut hasher)?;
    let root_metadata = fs::symlink_metadata(web_dist)?;
    if root_metadata.file_type().is_symlink() || !root_metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "web distribution is not a regular directory",
        ));
    }
    hash_directory_level(web_dist, web_dist, &mut hasher)?;
    if !same_identity(&root_metadata, &fs::symlink_metadata(web_dist)?) {
        return Err(io::Error::other("web distribution changed while hashing"));
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_directory_level(root: &Path, directory: &Path, hasher: &mut Sha256) -> io::Result<()> {
    use std::os::unix::ffi::OsStrExt;

    let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "release content contains a symlink",
            ));
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| io::Error::other("invalid release path"))?;
        let label = Path::new("web/dist").join(relative);
        if metadata.file_type().is_dir() {
            hasher.update(*b"d");
            hash_label(label.as_os_str().as_bytes(), hasher);
            hash_directory_level(root, &path, hasher)?;
            if !same_identity(&metadata, &fs::symlink_metadata(&path)?) {
                return Err(io::Error::other("directory changed while hashing"));
            }
        } else if metadata.file_type().is_file() {
            hash_regular_file(&path, &label, hasher)?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "release content contains a non-regular file",
            ));
        }
    }
    Ok(())
}

fn hash_regular_file(path: &Path, label: &Path, hasher: &mut Sha256) -> io::Result<()> {
    use std::os::unix::ffi::OsStrExt;

    let before = fs::symlink_metadata(path)?;
    if before.file_type().is_symlink() || !before.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "release source is not a regular file",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    unix_open_flags(&mut options, 0);
    let mut file = options.open(path)?;
    if !same_identity(&before, &file.metadata()?) {
        return Err(io::Error::other("release source changed while opening"));
    }
    hasher.update(*b"f");
    hash_label(label.as_os_str().as_bytes(), hasher);
    hasher.update(before.len().to_be_bytes());
    let mut remaining = before.len();
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let read_length = remaining.min(buffer.len() as u64) as usize;
        let count = file.read(&mut buffer[..read_length])?;
        if count == 0 {
            return Err(io::Error::other("release source was truncated"));
        }
        hasher.update(&buffer[..count]);
        remaining -= count as u64;
    }
    let mut extra = [0_u8; 1];
    if file.read(&mut extra)? != 0 || !same_identity(&before, &fs::symlink_metadata(path)?) {
        return Err(io::Error::other("release source changed while hashing"));
    }
    Ok(())
}

fn hash_label(label: &[u8], hasher: &mut Sha256) {
    hasher.update((label.len() as u64).to_be_bytes());
    hasher.update(label);
}

fn ensure_secure_directory(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    use std::os::unix::fs::MetadataExt;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "installation directory is unsafe",
        ));
    }
    fs::set_permissions(path, unix_permissions(0o700))
}

fn reject_symlink_target(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "target is a symlink",
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn atomic_write_file(path: &Path, value: &[u8], mode: u32) -> io::Result<()> {
    reject_symlink_target(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "target parent is unsafe",
        ));
    }
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no name"))?
        .to_string_lossy();
    let temporary = parent.join(format!(".{name}.tmp-{}", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    unix_open_flags(&mut options, mode);
    let mut file = options.open(&temporary)?;
    let result = (|| {
        file.write_all(value)?;
        file.flush()?;
        file.set_permissions(unix_permissions(mode))?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)?;
        sync_parent(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn atomic_symlink(path: &Path, target: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_symlink() => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "current install path is not a symlink",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "link has no parent"))?;
    let parent_metadata = fs::symlink_metadata(parent)?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.file_type().is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "link parent is unsafe",
        ));
    }
    let temporary = parent.join(format!(".current.tmp-{}", uuid::Uuid::new_v4()));
    std::os::unix::fs::symlink(target, &temporary)?;
    let result = fs::rename(&temporary, path).and_then(|_| sync_parent(path));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn sync_parent(path: &Path) -> io::Result<()> {
    File::open(
        path.parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?,
    )?
    .sync_all()
}

fn sync_directory_tree(root: &Path) -> io::Result<()> {
    let mut directories = Vec::new();
    collect_directories(root, &mut directories)?;
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for directory in directories {
        File::open(directory)?.sync_all()?;
    }
    Ok(())
}

fn collect_directories(path: &Path, directories: &mut Vec<PathBuf>) -> io::Result<()> {
    directories.push(path.to_path_buf());
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.file_type().is_dir() {
            collect_directories(&entry.path(), directories)?;
        }
    }
    Ok(())
}

fn read_small_regular_file(path: &Path, limit: u64, mode: u32) -> io::Result<String> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_file()
        || metadata.len() > limit
    {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "unsafe file"));
    }
    use std::os::unix::fs::MetadataExt;
    if metadata.uid() != unsafe { libc::geteuid() }
        || metadata.nlink() != 1
        || metadata.mode() & 0o777 != mode
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "file ownership or permissions are unsafe",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    unix_open_flags(&mut options, 0);
    let mut file = options.open(path)?;
    if !same_identity(&metadata, &file.metadata()?) {
        return Err(io::Error::other("file changed while opening"));
    }
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "file too large",
        ));
    }
    String::from_utf8(bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "file is not UTF-8"))
}

fn parse_environment_value(content: &str, name: &str) -> io::Result<String> {
    parse_managed_environment(content)?
        .remove(name)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "environment value missing"))
}

fn systemd_environment_quote(value: &str) -> io::Result<String> {
    validate_environment_value(value)?;
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

fn systemd_directive_path(value: &str) -> io::Result<String> {
    validate_systemd_absolute_path(value)?;
    systemd_unit_word(value, false)
}

fn systemd_unit_word(value: &str, expand_dollars: bool) -> io::Result<String> {
    validate_environment_value(value)?;
    let mut escaped = String::new();
    for character in value.chars() {
        match character {
            ' ' => escaped.push_str("\\x20"),
            '\t' => escaped.push_str("\\x09"),
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '%' => escaped.push_str("%%"),
            '$' if expand_dollars => escaped.push_str("$$"),
            _ => escaped.push(character),
        }
    }
    Ok(escaped)
}

fn systemd_exec_argument(value: &str) -> io::Result<String> {
    validate_systemd_absolute_path(value)?;
    systemd_unit_word(value, true)
}

fn validate_systemd_absolute_path(value: &str) -> io::Result<()> {
    validate_environment_value(value)?;
    if !Path::new(value).is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "systemd path is not absolute",
        ));
    }
    Ok(())
}

fn validate_environment_value(value: &str) -> io::Result<()> {
    if value.contains(['\0', '\n', '\r']) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "environment value contains a forbidden character",
        ));
    }
    Ok(())
}

fn environment_string(value: &std::ffi::OsStr) -> io::Result<String> {
    let value = value
        .to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "environment is not UTF-8"))?
        .to_string();
    validate_environment_value(&value)?;
    Ok(value)
}

fn environment_value(name: &str, fallback: &str) -> io::Result<String> {
    match env::var_os(name) {
        Some(value) => environment_string(&value),
        None => Ok(fallback.into()),
    }
}

fn path_utf8(path: &Path) -> io::Result<&str> {
    path.to_str()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "path is not UTF-8"))
}

fn allowed_handoff_path(path: &Path) -> bool {
    expected_handoff_path().is_ok_and(|expected| same_path_identity(&expected, path))
}

fn validate_runtime_directory(path: &Path) -> io::Result<()> {
    let canonical = canonical_owner_controlled_directory(path)?;
    if canonical != path {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "runtime directory is unsafe",
        ));
    }
    Ok(())
}

impl HandoffRecord {
    fn current() -> Option<Self> {
        let pid = std::process::id();
        Some(Self {
            pid,
            starttime: process::process_starttime(pid)?,
        })
    }

    fn is_live(self) -> bool {
        process::ChildIdentity::from_known(self.pid, self.starttime)
            .is_some_and(process::ChildIdentity::is_current)
    }
}

fn write_handoff_record(path: &Path, record: HandoffRecord) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "handoff has no parent"))?;
    let runtime_root = parent
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid runtime path"))?;
    validate_runtime_directory(runtime_root)?;
    ensure_secure_directory(parent)?;
    let value = serde_json::to_vec(&record)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    atomic_write_file(path, &value, 0o600)
}

fn read_handoff_record(path: &Path) -> io::Result<Option<HandoffRecord>> {
    use std::os::unix::fs::MetadataExt;

    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if metadata.file_type().is_symlink()
        || !metadata.file_type().is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.nlink() != 1
        || metadata.mode() & 0o777 != 0o600
        || metadata.len() > MAX_HANDOFF_BYTES
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "unsafe handoff record",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true);
    unix_open_flags(&mut options, 0);
    let mut file = options.open(path)?;
    if !same_identity(&metadata, &file.metadata()?) {
        return Err(io::Error::other("handoff record changed while opening"));
    }
    let mut value = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(MAX_HANDOFF_BYTES + 1)
        .read_to_end(&mut value)?;
    if value.len() as u64 > MAX_HANDOFF_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "handoff record is too large",
        ));
    }
    serde_json::from_slice(&value)
        .map(Some)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn remove_handoff_record_if_same(path: &Path, expected: HandoffRecord) -> io::Result<()> {
    let Some(actual) = read_handoff_record(path)? else {
        return Ok(());
    };
    if actual != expected {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "handoff record was replaced",
        ));
    }
    fs::remove_file(path)?;
    sync_parent(path)
}

fn unix_permissions(mode: u32) -> fs::Permissions {
    use std::os::unix::fs::PermissionsExt;
    fs::Permissions::from_mode(mode)
}

fn unix_open_flags(options: &mut OpenOptions, mode: u32) {
    use std::os::unix::fs::OpenOptionsExt;
    options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    if mode != 0 {
        options.mode(mode);
    }
}

fn same_identity(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.file_type() == right.file_type()
        && left.len() == right.len()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{PermissionsExt, symlink};

    use super::*;

    fn private_file(path: &Path, value: &[u8]) {
        fs::write(path, value).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
    }

    #[test]
    fn validates_and_canonicalizes_private_key_file_without_reading_it() {
        let root = tempfile::tempdir().unwrap();
        let key = root.path().join("key");
        private_file(&key, b"secret");
        assert_eq!(
            validate_byte_api_key_file(&key).unwrap(),
            key.canonicalize().unwrap()
        );
        fs::set_permissions(&key, fs::Permissions::from_mode(0o640)).unwrap();
        assert!(validate_byte_api_key_file(&key).is_err());
        fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).unwrap();
        let link = root.path().join("link");
        symlink(&key, &link).unwrap();
        assert!(validate_byte_api_key_file(&link).is_err());
        assert!(validate_byte_api_key_file(Path::new("relative")).is_err());
    }

    #[test]
    fn environment_is_an_allowlist_and_never_contains_key_value_or_admin_credentials() {
        let root = tempfile::tempdir().unwrap();
        let context = test_context(root.path());
        let content = context.environment_file("/private/key").unwrap();
        assert!(content.contains("BYTE_API_API_KEY_FILE=\"/private/key\""));
        assert!(content.contains(&format!("XDG_CONFIG_HOME=\"{}\"", context.config_home)));
        assert!(content.contains(&format!("XDG_RUNTIME_DIR=\"{}\"", context.runtime_dir)));
        let expected_bus = expected_bus_address(Path::new(&context.runtime_dir)).unwrap();
        assert_eq!(context.bus_address, expected_bus);
        assert!(content.contains(&format!(
            "DBUS_SESSION_BUS_ADDRESS=\"{}\"",
            context.bus_address
        )));
        assert!(!content.contains("BYTE_API_API_KEY="));
        assert!(!content.contains("DEVHATCH_ADMIN_PASSWORD"));
        let names = content
            .lines()
            .map(|line| line.split_once('=').unwrap().0)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "DEVHATCH_SUPERVISOR_SCHEMA",
                "HOME",
                "XDG_CONFIG_HOME",
                "XDG_RUNTIME_DIR",
                "DBUS_SESSION_BUS_ADDRESS",
                "PATH",
                "SHELL",
                "DEVHATCH_BIND",
                "DEVHATCH_DATA_DIR",
                "DEVHATCH_WEB_DIST",
                "DEVHATCH_CWD",
                "BYTE_API_API_KEY_FILE",
            ]
        );
    }

    #[test]
    fn systemd_quoting_escapes_each_directive_context_and_rejects_lines() {
        assert_eq!(
            systemd_exec_argument("/tmp/a b\\c\"%n$HOME").unwrap(),
            "/tmp/a\\x20b\\\\c\\\"%%n$$HOME"
        );
        assert_eq!(
            systemd_directive_path("/tmp/a b\\c\"%n$HOME").unwrap(),
            "/tmp/a\\x20b\\\\c\\\"%%n$HOME"
        );
        assert_eq!(
            systemd_environment_quote("a b\\c\"$HOME").unwrap(),
            "\"a b\\\\c\\\"$HOME\""
        );
        assert!(systemd_exec_argument("bad\nvalue").is_err());
        assert!(systemd_exec_argument("relative").is_err());
        assert!(systemd_directive_path("relative").is_err());
        assert!(systemd_environment_quote("bad\0value").is_err());
    }

    #[test]
    fn managed_environment_parser_rejects_untrusted_or_ambiguous_entries() {
        let root = tempfile::tempdir().unwrap();
        let context = test_context(root.path());
        let content = context.environment_file("/private/key").unwrap();
        assert!(parse_managed_environment(&content).is_ok());
        assert!(parse_managed_environment(&format!("{content}UNKNOWN=\"value\"\n")).is_err());
        assert!(parse_managed_environment(&format!("{content}HOME=\"/duplicate\"\n")).is_err());
        assert!(parse_managed_environment(&content.replace("HOME=", "MISSING_HOME=")).is_err());
        assert!(
            parse_managed_environment(&content.replace("\"/private/key\"", "relative")).is_err()
        );
        assert!(
            parse_managed_environment(&content.replace("\"/private/key\"", "\"bad\\q\"")).is_err()
        );
        assert!(parse_managed_environment(&format!("{content}CODEX_HOME=\"relative\"\n")).is_err());
    }

    #[test]
    fn managed_environment_parser_rejects_unsafe_runtime_paths() {
        let root = tempfile::tempdir().unwrap();
        let context = test_context(root.path());
        let content = context.environment_file("/private/key").unwrap();
        let relative = content.replace(
            &format!("XDG_RUNTIME_DIR=\"{}\"", context.runtime_dir),
            "XDG_RUNTIME_DIR=\"relative\"",
        );
        assert!(parse_managed_environment(&relative).is_err());
        let unsafe_runtime = root.path().join("unsafe-runtime");
        fs::create_dir(&unsafe_runtime).unwrap();
        fs::set_permissions(&unsafe_runtime, fs::Permissions::from_mode(0o777)).unwrap();
        let unsafe_content = content.replace(
            &format!("XDG_RUNTIME_DIR=\"{}\"", context.runtime_dir),
            &format!("XDG_RUNTIME_DIR=\"{}\"", unsafe_runtime.display()),
        );
        assert!(parse_managed_environment(&unsafe_content).is_err());
    }

    #[test]
    fn resolvers_honor_valid_config_and_runtime_roots() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let config = root.path().join("configuration");
        let runtime = root.path().join("runtime");
        for path in [&home, &config, &runtime] {
            fs::create_dir(path).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert_eq!(
            resolve_config_home(&home, Some(config.as_os_str())).unwrap(),
            config
        );
        assert_eq!(
            resolve_runtime_directory(Some(runtime.as_os_str()), Path::new("/unused")).unwrap(),
            runtime
        );
        assert_eq!(
            managed_unit_path(&config),
            config.join("systemd/user/devhatch.service")
        );
        assert_eq!(
            managed_environment_path(&config),
            config.join("devhatch/devhatch.env")
        );
        assert_eq!(
            managed_handoff_path(&runtime),
            runtime.join("devhatch/handoff.json")
        );
    }

    #[test]
    fn resolvers_reject_unsafe_config_and_runtime_roots() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let unsafe_path = root.path().join("unsafe");
        let fallback = root.path().join("fallback");
        for path in [&home, &unsafe_path, &fallback] {
            fs::create_dir(path).unwrap();
        }
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&fallback, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&unsafe_path, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(resolve_config_home(&home, Some(unsafe_path.as_os_str())).is_err());
        assert_eq!(
            resolve_runtime_directory(Some(unsafe_path.as_os_str()), &fallback).unwrap(),
            fallback
        );
        assert_eq!(
            resolve_runtime_directory(Some(std::ffi::OsStr::new("relative")), &fallback).unwrap(),
            fallback
        );
        assert_eq!(
            resolve_config_home(&home, Some(std::ffi::OsStr::new("relative"))).unwrap(),
            home.join(".config")
        );
    }

    #[test]
    fn symlinked_home_preserves_logical_paths_and_compares_identity() {
        let root = tempfile::tempdir().unwrap();
        let canonical_home = root.path().join("canonical-home");
        let logical_home = root.path().join("logical-home");
        fs::create_dir(&canonical_home).unwrap();
        fs::set_permissions(&canonical_home, fs::Permissions::from_mode(0o700)).unwrap();
        symlink(&canonical_home, &logical_home).unwrap();
        assert_eq!(
            logical_owner_controlled_directory(&logical_home).unwrap(),
            logical_home
        );
        assert_eq!(
            resolve_config_home(&logical_home, None).unwrap(),
            logical_home.join(".config")
        );
        let logical_unit = logical_home.join(".config/systemd/user/devhatch.service");
        let canonical_unit = canonical_home.join(".config/systemd/user/devhatch.service");
        assert!(same_path_identity(&logical_unit, &canonical_unit));
    }

    #[test]
    fn missing_absolute_config_home_under_home_is_supported() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        fs::create_dir(&home).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();
        let config = home.join("nested/config");
        assert_eq!(
            resolve_config_home(&home, Some(config.as_os_str())).unwrap(),
            config
        );
        ensure_owner_controlled_hierarchy_exists(&config).unwrap();
        assert!(config.is_dir());
    }

    #[test]
    fn manager_config_parser_uses_manager_value_or_logical_default() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let config = home.join("manager-config");
        fs::create_dir(&home).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            parse_manager_config_home("PATH=/usr/bin\n", &home).unwrap(),
            home.join(".config")
        );
        assert_eq!(
            parse_manager_config_home(
                &format!(
                    "HOME={}\nXDG_CONFIG_HOME=\"{}\"\n",
                    home.display(),
                    config.display()
                ),
                &home,
            )
            .unwrap(),
            config
        );
    }

    #[test]
    fn manager_environment_is_exact_and_requires_owned_bus_socket() {
        let root = tempfile::tempdir().unwrap();
        let runtime = root.path().join("runtime");
        fs::create_dir(&runtime).unwrap();
        fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(validated_manager_environment(&runtime).is_err());
        let listener = std::os::unix::net::UnixListener::bind(runtime.join("bus")).unwrap();
        let environment = validated_manager_environment(&runtime).unwrap();
        assert_eq!(environment.len(), 2);
        assert_eq!(environment["XDG_RUNTIME_DIR"], runtime.to_string_lossy());
        assert_eq!(
            environment["DBUS_SESSION_BUS_ADDRESS"],
            format!("unix:path={}/bus", runtime.display())
        );
        let mut command = tokio::process::Command::new("/bin/true");
        command.env("ATTACKER", "value");
        configure_manager_command(&mut command, &environment);
        assert_eq!(command.as_std().get_envs().count(), 2);
        drop(listener);
        fs::remove_file(runtime.join("bus")).unwrap();
        let context = test_context(root.path());
        let environment = context.manager_environment().unwrap();
        assert_eq!(environment.len(), 4);
        assert_eq!(environment["HOME"], context.home);
        assert_eq!(environment["XDG_CONFIG_HOME"], context.config_home);
        assert_eq!(environment["XDG_RUNTIME_DIR"], context.runtime_dir);
        assert_eq!(environment["DBUS_SESSION_BUS_ADDRESS"], context.bus_address);
    }

    #[test]
    fn optional_environment_sanitizes_sockets_proxies_and_skillink_values() {
        let root = tempfile::tempdir().unwrap();
        let socket = root.path().join("agent.sock");
        let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        assert_eq!(
            sanitize_optional_environment(
                "SSH_AUTH_SOCK",
                path_utf8(&socket).unwrap(),
                root.path(),
                root.path(),
            )
            .unwrap(),
            socket.to_string_lossy()
        );
        assert!(
            sanitize_optional_environment(
                "HTTP_PROXY",
                "https://user:password@example.com",
                root.path(),
                root.path(),
            )
            .is_err()
        );
        assert!(
            sanitize_optional_environment(
                "HTTPS_PROXY",
                "https://example.com:8443",
                root.path(),
                root.path(),
            )
            .is_ok()
        );
        assert!(
            sanitize_optional_environment(
                "NO_PROXY",
                "localhost,.example.com,127.0.0.1",
                root.path(),
                root.path(),
            )
            .is_ok()
        );
        assert!(
            sanitize_optional_environment(
                "SKILLINK_GIT_TIMEOUT_SECS",
                "0",
                root.path(),
                root.path(),
            )
            .is_err()
        );
        assert!(
            sanitize_optional_environment(
                "SKILLINK_GIT_CONCURRENCY",
                "2",
                root.path(),
                root.path(),
            )
            .is_ok()
        );
        assert_eq!(
            sanitize_optional_environment(
                "SKILLINK_HOME",
                "relative-skillink",
                root.path(),
                root.path(),
            )
            .unwrap(),
            root.path().join("relative-skillink").to_string_lossy()
        );
        assert!(
            sanitize_optional_environment(
                "SKILLINK_GIT_SHALLOW",
                "true",
                root.path(),
                root.path(),
            )
            .is_err()
        );
        drop(listener);
    }

    #[test]
    fn durable_environment_paths_are_absolute() {
        let root = tempfile::tempdir().unwrap();
        let cwd = root.path().join("cwd");
        assert_eq!(
            normalize_durable_path("relative/path", root.path(), &cwd).unwrap(),
            cwd.join("relative/path").to_string_lossy()
        );
        assert_eq!(
            normalize_durable_path("~/path", root.path(), &cwd).unwrap(),
            root.path().join("path").to_string_lossy()
        );
        let paths = normalize_durable_path_list("one:../two", root.path(), &cwd).unwrap();
        assert!(env::split_paths(&paths).all(|path| path.is_absolute()));
    }

    #[test]
    fn status_json_has_the_stable_field_set() {
        let value = serde_json::to_value(SupervisorStatus::unavailable()).unwrap();
        let object = value.as_object().unwrap();
        let actual = object
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let expected = [
            "active",
            "available",
            "byteApiKeyFile",
            "currentProcessManaged",
            "enabled",
            "handoffPending",
            "installRoot",
            "installed",
            "lingerEnabled",
            "managed",
            "overwriteRequired",
            "restartPending",
            "state",
            "supported",
            "unitName",
            "unitPath",
        ]
        .into_iter()
        .collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn systemd_status_parser_tracks_handoff_and_drop_in_fields() {
        let status = parse_systemd_status(
            "Description=DevHatch user supervisor managed installation\nLoadState=loaded\nUnitFileState=enabled\nActiveState=activating\nSubState=start-pre\nMainPID=0\nControlPID=42\nJob=/org/freedesktop/systemd1/job/7\nFragmentPath=/home/user/.config/systemd/user/devhatch.service\nDropInPaths=/home/user/.config/systemd/user/devhatch.service.d/override.conf /run/user/1/systemd/user/devhatch.service.d/runtime.conf\nNeedDaemonReload=yes\n",
        );
        assert_eq!(status.control_pid, 42);
        assert_eq!(status.job, "/org/freedesktop/systemd1/job/7");
        assert_eq!(status.drop_in_paths.len(), 2);
        assert!(status.need_daemon_reload);
        assert!(!handoff_started(
            &status,
            Path::new("/home/user/.config/systemd/user/devhatch.service")
        ));
    }

    #[test]
    fn corrupt_release_is_not_current_and_is_replaced() {
        let root = tempfile::tempdir().unwrap();
        let context = source_context(root.path());
        ensure_secure_directory(&context.install_root).unwrap();
        ensure_secure_directory(&context.releases_dir()).unwrap();
        let hash = context.source_hash().unwrap();
        let release = publish_release(&context, &hash).unwrap();
        atomic_symlink(
            &context.current_link(),
            &SupervisorContext::desired_current_target(&hash),
        )
        .unwrap();
        assert_eq!(
            current_release(&context),
            CurrentInstall::Managed(SupervisorContext::desired_current_target(&hash))
        );
        fs::write(release.join("web/dist/index.html"), b"corrupt").unwrap();
        assert_eq!(
            current_release(&context),
            CurrentInstall::ManagedInvalid(SupervisorContext::desired_current_target(&hash))
        );
        publish_release(&context, &hash).unwrap();
        validate_release(&release, &hash).unwrap();
        assert_eq!(
            fs::read(release.join("web/dist/index.html")).unwrap(),
            b"index"
        );
    }

    #[test]
    fn current_classifies_non_symlinks_as_foreign_and_bad_symlinks_as_managed_invalid() {
        let root = tempfile::tempdir().unwrap();
        let current = root.path().join("current");
        fs::write(&current, b"foreign").unwrap();
        assert_eq!(inspect_current(&current), CurrentInstall::Foreign);
        fs::remove_file(&current).unwrap();
        fs::create_dir(&current).unwrap();
        assert_eq!(inspect_current(&current), CurrentInstall::Foreign);
        fs::remove_dir(&current).unwrap();
        symlink("releases/not-a-hash", &current).unwrap();
        assert_eq!(
            inspect_current(&current),
            CurrentInstall::ManagedInvalid(PathBuf::from("releases/not-a-hash"))
        );
        assert_eq!(
            installation_decision(
                &ManagedFile::Managed("unit".into()),
                &ManagedFile::Managed("environment".into()),
                &CurrentInstall::Foreign,
                "unit",
                "environment",
                Path::new("releases/hash"),
            ),
            InstallDecision::Foreign
        );
    }

    #[test]
    fn install_snapshot_restores_managed_files_and_current() {
        let root = tempfile::tempdir().unwrap();
        let context = source_context(root.path());
        fs::create_dir_all(context.unit_path.parent().unwrap()).unwrap();
        fs::create_dir_all(context.environment_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&context.install_root).unwrap();
        let old_unit = context.unit_file().unwrap();
        let old_environment = context.environment_file("/private/old-key").unwrap();
        private_file(&context.unit_path, old_unit.as_bytes());
        private_file(&context.environment_path, old_environment.as_bytes());
        symlink("releases/old", context.current_link()).unwrap();
        let snapshot = InstallSnapshot {
            unit: snapshot_managed_file(&context.unit_path, managed_unit_content).unwrap(),
            environment: snapshot_managed_file(
                &context.environment_path,
                managed_environment_content,
            )
            .unwrap(),
            current: snapshot_managed_current(&context.current_link()).unwrap(),
            enabled: false,
            active: false,
        };
        atomic_write_file(
            &context.unit_path,
            format!("{old_unit}\n").as_bytes(),
            0o600,
        )
        .unwrap();
        atomic_write_file(
            &context.environment_path,
            old_environment
                .replace("/private/old-key", "/private/new-key")
                .as_bytes(),
            0o600,
        )
        .unwrap();
        atomic_symlink(&context.current_link(), Path::new("releases/new")).unwrap();
        restore_install_snapshot(&context, &snapshot).unwrap();
        assert_eq!(fs::read_to_string(&context.unit_path).unwrap(), old_unit);
        assert_eq!(
            fs::read_to_string(&context.environment_path).unwrap(),
            old_environment
        );
        assert_eq!(
            fs::read_link(context.current_link()).unwrap(),
            Path::new("releases/old")
        );
    }

    #[test]
    fn rollback_plan_restores_only_effects_owned_by_the_operation() {
        let root = tempfile::tempdir().unwrap();
        let context = Arc::new(test_context(root.path()));
        let mut transaction = InstallTransaction::capture(
            context,
            BTreeMap::new(),
            false,
            false,
            HandoffRecord {
                pid: 1,
                starttime: 1,
            },
        )
        .unwrap();
        transaction.files_mutated = true;
        transaction.newly_enabled = true;
        transaction.handoff_attempted = true;
        transaction.start_attempted = true;
        assert_eq!(
            transaction.rollback_plan(),
            RollbackPlan {
                restore_files: true,
                disable_unit: true,
                stop_unit: true,
                reload_manager: true,
                remove_handoff: true,
            }
        );
        transaction.newly_enabled = false;
        assert!(!transaction.rollback_plan().disable_unit);
        transaction.snapshot.active = true;
        assert!(!transaction.rollback_plan().stop_unit);
    }

    #[test]
    fn publication_switches_current_only_after_unit_and_environment() {
        let root = tempfile::tempdir().unwrap();
        let context = source_context(root.path());
        fs::create_dir_all(&context.install_root).unwrap();
        fs::create_dir_all(context.unit_path.parent().unwrap()).unwrap();
        fs::create_dir(&context.unit_path).unwrap();
        symlink("releases/old", context.current_link()).unwrap();
        let hash = context.source_hash().unwrap();
        assert!(
            publish_install(
                &context,
                &hash,
                &context.environment_file("/private/key").unwrap(),
                &context.unit_file().unwrap(),
            )
            .is_err()
        );
        assert_eq!(
            fs::read_link(context.current_link()).unwrap(),
            Path::new("releases/old")
        );
    }

    #[test]
    fn generated_unit_passes_systemd_analyze_verify() {
        let analyzer = Path::new("/usr/bin/systemd-analyze");
        if !analyzer.exists() {
            return;
        }
        let root = tempfile::tempdir().unwrap();
        let managed_root = root.path().join("space $ % quote\" slash\\");
        fs::create_dir(&managed_root).unwrap();
        let context = source_context(&managed_root);
        ensure_secure_directory(&context.install_root).unwrap();
        ensure_secure_directory(&context.releases_dir()).unwrap();
        let hash = context.source_hash().unwrap();
        publish_release(&context, &hash).unwrap();
        atomic_symlink(
            &context.current_link(),
            &SupervisorContext::desired_current_target(&hash),
        )
        .unwrap();
        fs::create_dir_all(context.environment_path.parent().unwrap()).unwrap();
        private_file(
            &context.environment_path,
            context.environment_file("/private/key").unwrap().as_bytes(),
        );
        fs::create_dir_all(context.unit_path.parent().unwrap()).unwrap();
        private_file(&context.unit_path, context.unit_file().unwrap().as_bytes());
        let output = std::process::Command::new(analyzer)
            .args(["--user", "--man=no", "verify"])
            .arg(&context.unit_path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn managed_install_requires_explicit_overwrite_when_any_content_differs() {
        let unit = ManagedFile::Managed("unit".into());
        let environment = ManagedFile::Managed("environment".into());
        let current = CurrentInstall::Managed(PathBuf::from("releases/hash"));
        assert_eq!(
            installation_decision(
                &unit,
                &environment,
                &current,
                "unit",
                "environment",
                Path::new("releases/hash"),
            ),
            InstallDecision::Current
        );
        assert_eq!(
            installation_decision(
                &unit,
                &environment,
                &current,
                "changed",
                "environment",
                Path::new("releases/hash"),
            ),
            InstallDecision::OverwriteRequired
        );
        assert_eq!(
            installation_decision(
                &unit,
                &ManagedFile::Foreign,
                &current,
                "unit",
                "environment",
                Path::new("releases/hash"),
            ),
            InstallDecision::Foreign
        );
        assert_eq!(
            installation_decision(
                &ManagedFile::Foreign,
                &environment,
                &current,
                "unit",
                "environment",
                Path::new("releases/hash"),
            ),
            InstallDecision::Foreign
        );
    }

    #[test]
    fn release_hash_and_copy_are_stable_and_reject_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let binary = root.path().join("server");
        let web = root.path().join("web");
        fs::create_dir(&web).unwrap();
        private_file(&binary, b"server");
        private_file(&web.join("index.html"), b"index");
        let first = hash_layout(&binary, &web).unwrap();
        let second = hash_layout(&binary, &web).unwrap();
        assert_eq!(first, second);
        let copied = root.path().join("copied");
        fs::create_dir(&copied).unwrap();
        copy_directory_contents(&web, &copied).unwrap();
        assert_eq!(fs::read(copied.join("index.html")).unwrap(), b"index");
        symlink(web.join("index.html"), web.join("linked")).unwrap();
        assert!(hash_layout(&binary, &web).is_err());
        let rejected = root.path().join("rejected");
        fs::create_dir(&rejected).unwrap();
        assert!(copy_directory_contents(&web, &rejected).is_err());
    }

    #[test]
    fn handoff_records_reject_unknown_fields_and_stale_identity_is_not_live() {
        assert!(
            serde_json::from_str::<HandoffRecord>(r#"{"pid":1,"starttime":2,"extra":3}"#).is_err()
        );
        let record = HandoffRecord {
            pid: std::process::id(),
            starttime: 0,
        };
        assert!(!record.is_live());
        let current = HandoffRecord::current().unwrap();
        assert!(current.is_live());
    }

    fn source_context(root: &Path) -> SupervisorContext {
        let context = test_context(root);
        fs::create_dir_all(context.web_dist.as_ref().unwrap()).unwrap();
        fs::create_dir_all(&context.data_dir).unwrap();
        fs::write(&context.current_exe, b"server").unwrap();
        fs::set_permissions(&context.current_exe, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(
            context.web_dist.as_ref().unwrap().join("index.html"),
            b"index",
        )
        .unwrap();
        context
    }

    fn test_context(root: &Path) -> SupervisorContext {
        let config_home = root.join("config");
        let runtime_dir = root.join("runtime");
        fs::create_dir_all(&config_home).unwrap();
        fs::create_dir_all(&runtime_dir).unwrap();
        fs::set_permissions(&config_home, fs::Permissions::from_mode(0o700)).unwrap();
        fs::set_permissions(&runtime_dir, fs::Permissions::from_mode(0o700)).unwrap();
        let bus = runtime_dir.join("bus");
        let listener = std::os::unix::net::UnixListener::bind(&bus).unwrap();
        drop(listener);
        SupervisorContext {
            current_exe: root.join("server"),
            web_dist: Some(root.join("web")),
            data_dir: root.join("data"),
            bind: "127.0.0.1".into(),
            home: root.to_string_lossy().into_owned(),
            config_home: config_home.to_string_lossy().into_owned(),
            runtime_dir: runtime_dir.to_string_lossy().into_owned(),
            bus_address: format!("unix:path={}", bus.display()),
            path: "/usr/bin:/bin".into(),
            shell: "/bin/sh".into(),
            effective_cwd: root.to_string_lossy().into_owned(),
            optional_environment: BTreeMap::new(),
            install_root: root.join(".local/lib/devhatch"),
            unit_path: managed_unit_path(&config_home),
            environment_path: managed_environment_path(&config_home),
            handoff_path: managed_handoff_path(&runtime_dir),
        }
    }
}
