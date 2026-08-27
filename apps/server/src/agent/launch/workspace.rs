use std::{
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
};

use uuid::Uuid;

use crate::launch_config::AgentLaunchConfig;

pub(super) fn create_run_dir(data_dir: &Path) -> std::io::Result<PathBuf> {
    let root = data_dir.join("agent-runs");
    std::fs::create_dir_all(&root)?;
    std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
    let run_dir = root.join(Uuid::new_v4().to_string());
    std::fs::create_dir(&run_dir)?;
    std::fs::set_permissions(&run_dir, std::fs::Permissions::from_mode(0o700))?;
    Ok(run_dir)
}

pub(super) fn copy_skills(run_dir: &Path, generation: &Path) -> std::io::Result<()> {
    let skills = run_dir.join("skills");
    std::fs::create_dir(&skills)?;
    for entry in std::fs::read_dir(generation)? {
        let entry = entry?;
        let source = std::fs::canonicalize(entry.path())?;
        copy_skill_directory(&source, &skills.join(entry.file_name()))?;
    }
    Ok(())
}

pub(super) fn prepare_codex_home(
    run_dir: &Path,
    generation: &Path,
    base_home: &Path,
) -> std::io::Result<PathBuf> {
    match std::fs::metadata(base_home) {
        Ok(metadata) if !metadata.is_dir() => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Codex home is not a directory",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(base_home)?;
            std::fs::set_permissions(base_home, std::fs::Permissions::from_mode(0o700))?;
        }
        Err(error) => return Err(error),
    }
    let base_home = std::fs::canonicalize(base_home)?;
    let runtime_home = run_dir.join("codex-home");
    std::fs::create_dir(&runtime_home)?;
    std::fs::set_permissions(&runtime_home, std::fs::Permissions::from_mode(0o700))?;
    copy_skills(&runtime_home, generation)?;
    for name in [
        "auth.json",
        "config.toml",
        "history.jsonl",
        "session_index.jsonl",
        "sessions",
        "archived_sessions",
        "thread-writer-locks",
        "shell_snapshots",
    ] {
        link_codex_entry(&base_home, &runtime_home, name)?;
    }
    if base_home.is_dir() {
        for entry in std::fs::read_dir(&base_home)? {
            let entry = entry?;
            let name = entry.file_name();
            if entry.file_type()?.is_file()
                && name
                    .to_str()
                    .is_some_and(|name| name.ends_with(".config.toml"))
            {
                link_codex_entry(&base_home, &runtime_home, &name)?;
            }
        }
    }
    Ok(runtime_home)
}

fn link_codex_entry(
    base_home: &Path,
    runtime_home: &Path,
    name: impl AsRef<std::ffi::OsStr>,
) -> std::io::Result<()> {
    let source = base_home.join(name.as_ref());
    let metadata = match std::fs::symlink_metadata(&source) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if metadata.file_type().is_symlink() || !(metadata.is_file() || metadata.is_dir()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Codex home contains an unsupported filesystem entry",
        ));
    }
    symlink(source, runtime_home.join(name.as_ref()))
}

const PI_IDENTITY_EXTENSION: &str = r#"import { open, rename } from "node:fs/promises"

export default function (pi) {
  pi.on("session_start", async (_event, ctx) => {
    const target = process.env.DEVHATCH_PI_STATE_FILE
    if (!target) return
    const temporary = `${target}.${process.pid}.tmp`
    const state = {
      id: ctx.sessionManager.getSessionId(),
      file: ctx.sessionManager.getSessionFile(),
      cwd: ctx.cwd,
    }
    const handle = await open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(JSON.stringify(state))
    } finally {
      await handle.close()
    }
    await rename(temporary, target)
  })
}
"#;

pub(super) fn write_pi_identity_extension(run_dir: &Path) -> std::io::Result<(PathBuf, PathBuf)> {
    let extension = run_dir.join("devhatch-pi-identity.mjs");
    let state = run_dir.join("pi-state.json");
    std::fs::write(&extension, PI_IDENTITY_EXTENSION)?;
    std::fs::set_permissions(&extension, std::fs::Permissions::from_mode(0o600))?;
    Ok((extension, state))
}

pub(super) fn prepare_trae_home(
    run_dir: &Path,
    generation: &Path,
) -> std::io::Result<(PathBuf, PathBuf)> {
    let homes = crate::history::trae::resolve_homes();
    prepare_trae_home_from(run_dir, generation, &homes.trae_home, &homes.cli_home)
}

fn prepare_trae_home_from(
    run_dir: &Path,
    generation: &Path,
    base_home: &Path,
    cli_home: &Path,
) -> std::io::Result<(PathBuf, PathBuf)> {
    let trae_home = run_dir.join("trae-home");
    std::fs::create_dir(&trae_home)?;
    std::fs::set_permissions(&trae_home, std::fs::Permissions::from_mode(0o700))?;
    let config = base_home.join("traecli.toml");
    if config.is_file() {
        std::fs::copy(&config, trae_home.join("traecli.toml"))?;
    }
    for entry in [
        "agents",
        "hooks",
        "hooks.json",
        "model-provider",
        "plugins",
        "rules",
    ] {
        let source = base_home.join(entry);
        if source.exists() {
            symlink(source, trae_home.join(entry))?;
        }
    }
    copy_skills(&trae_home, generation)?;
    let system_skills = base_home.join("skills/.system");
    if system_skills.exists() {
        symlink(system_skills, trae_home.join("skills/.system"))?;
    }
    Ok((trae_home, cli_home.to_path_buf()))
}

fn copy_skill_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::create_dir(destination)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            copy_skill_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), target)?;
        } else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "skill contains an unsupported filesystem entry",
            ));
        }
    }
    Ok(())
}

pub(super) fn write_wrapper(
    path: &Path,
    config: &AgentLaunchConfig,
    use_managed_skills: bool,
    restore_codex_home: bool,
) -> std::io::Result<()> {
    std::fs::write(
        path,
        wrapper_source(config, use_managed_skills, restore_codex_home),
    )?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

fn wrapper_source(
    config: &AgentLaunchConfig,
    use_managed_skills: bool,
    restore_codex_home: bool,
) -> String {
    let mut source = String::from("#!/bin/sh\nset -e\n");
    if restore_codex_home {
        source.push_str("devhatch_codex_home=$CODEX_HOME\nreadonly devhatch_codex_home\n");
    }
    for script in [
        &config.pre_launch_script,
        &config.provider_script,
        &config.tui_script,
    ] {
        source.push_str(script);
        if !script.ends_with('\n') {
            source.push('\n');
        }
    }
    if use_managed_skills {
        source.push_str(
            "devhatch_base_config_dir=${OPENCODE_CONFIG_DIR:-}\n\
             if [ -n \"$devhatch_base_config_dir\" ] && [ \"$devhatch_base_config_dir\" != \"$DEVHATCH_CONFIG_DIR\" ] && [ -d \"$devhatch_base_config_dir\" ]; then\n\
             for devhatch_entry in agents agent commands command plugins tools themes tui.json tui.jsonc package.json package-lock.json bun.lock bun.lockb node_modules; do\n\
             if [ -e \"$devhatch_base_config_dir/$devhatch_entry\" ] && [ ! -e \"$DEVHATCH_CONFIG_DIR/$devhatch_entry\" ]; then\n\
             ln -s \"$devhatch_base_config_dir/$devhatch_entry\" \"$DEVHATCH_CONFIG_DIR/$devhatch_entry\"\n\
             fi\n\
             done\n\
             fi\n\
             export OPENCODE_CONFIG_DIR=\"$DEVHATCH_CONFIG_DIR\"\n",
        );
    }
    if restore_codex_home {
        source.push_str("export CODEX_HOME=\"$devhatch_codex_home\"\n");
    }
    source.push_str("exec \"$@\"\n");
    source
}

#[cfg(test)]
mod tests {
    use super::{
        PI_IDENTITY_EXTENSION, prepare_codex_home, prepare_trae_home_from, wrapper_source,
    };
    use crate::launch_config::AgentLaunchConfig;
    use std::os::unix::fs::PermissionsExt;
    use uuid::Uuid;

    #[test]
    fn pi_identity_extension_is_trusted_and_local_only() {
        assert!(PI_IDENTITY_EXTENSION.contains("session_start"));
        assert!(PI_IDENTITY_EXTENSION.contains("getSessionId()"));
        assert!(PI_IDENTITY_EXTENSION.contains("getSessionFile()"));
        assert!(PI_IDENTITY_EXTENSION.contains("open(temporary, \"wx\", 0o600)"));
        assert!(PI_IDENTITY_EXTENSION.contains("rename(temporary, target)"));
        assert!(!PI_IDENTITY_EXTENSION.contains("fetch("));
        assert!(!PI_IDENTITY_EXTENSION.contains("console."));
    }

    #[test]
    fn prepares_isolated_codex_home_with_shared_state() {
        let root = std::env::temp_dir().join(format!("devhatch-codex-home-{}", Uuid::new_v4()));
        let run_dir = root.join("run");
        let generation = root.join("generation");
        let base_home = root.join("base");
        std::fs::create_dir_all(generation.join("selected")).unwrap();
        std::fs::create_dir_all(base_home.join("sessions")).unwrap();
        std::fs::create_dir_all(base_home.join("skills/base-only")).unwrap();
        std::fs::create_dir(&run_dir).unwrap();
        std::fs::write(generation.join("selected/SKILL.md"), "# Selected").unwrap();
        std::fs::write(base_home.join("auth.json"), "{}").unwrap();
        std::fs::write(base_home.join("config.toml"), "model = 'test'").unwrap();
        std::fs::write(base_home.join("work.config.toml"), "model = 'work'").unwrap();

        let runtime_home = prepare_codex_home(&run_dir, &generation, &base_home).unwrap();

        assert_eq!(runtime_home, run_dir.join("codex-home"));
        assert_eq!(
            std::fs::read_to_string(runtime_home.join("skills/selected/SKILL.md")).unwrap(),
            "# Selected"
        );
        assert!(runtime_home.join("auth.json").is_symlink());
        assert!(runtime_home.join("config.toml").is_symlink());
        assert!(runtime_home.join("work.config.toml").is_symlink());
        assert!(runtime_home.join("sessions").is_symlink());
        assert!(!runtime_home.join("skills/base-only").exists());
        assert_ne!(runtime_home, base_home);
        let second_run = root.join("second-run");
        std::fs::create_dir(&second_run).unwrap();
        let second_runtime = prepare_codex_home(&second_run, &generation, &base_home).unwrap();
        assert_ne!(runtime_home, second_runtime);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn creates_missing_codex_base_home_with_private_permissions() {
        let root = std::env::temp_dir().join(format!("devhatch-codex-base-{}", Uuid::new_v4()));
        let run_dir = root.join("run");
        let generation = root.join("generation");
        let base_home = root.join("missing/base");
        std::fs::create_dir_all(&run_dir).unwrap();
        std::fs::create_dir(&generation).unwrap();

        prepare_codex_home(&run_dir, &generation, &base_home).unwrap();

        assert!(base_home.is_dir());
        assert_eq!(
            std::fs::metadata(&base_home).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepares_isolated_trae_home_with_profile_skills() {
        let root = std::env::temp_dir().join(format!("devhatch-trae-home-{}", Uuid::new_v4()));
        let run_dir = root.join("run");
        let generation = root.join("generation");
        let base_home = root.join("base");
        let cli_home = base_home.join("cli");
        std::fs::create_dir_all(generation.join("selected")).unwrap();
        std::fs::create_dir_all(base_home.join("skills/.system")).unwrap();
        std::fs::create_dir_all(&cli_home).unwrap();
        std::fs::write(generation.join("selected/SKILL.md"), "# Selected").unwrap();
        std::fs::write(base_home.join("traecli.toml"), "model = 'test'").unwrap();
        std::fs::create_dir(&run_dir).unwrap();

        let (trae_home, resolved_cli_home) =
            prepare_trae_home_from(&run_dir, &generation, &base_home, &cli_home).unwrap();

        assert_eq!(resolved_cli_home, cli_home);
        assert_eq!(
            std::fs::read_to_string(trae_home.join("traecli.toml")).unwrap(),
            "model = 'test'"
        );
        assert_eq!(
            std::fs::read_to_string(trae_home.join("skills/selected/SKILL.md")).unwrap(),
            "# Selected"
        );
        assert!(trae_home.join("skills/.system").is_symlink());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn generates_wrapper_without_interpolating_command() {
        let config = AgentLaunchConfig {
            id: "id".into(),
            agent_id: "opencode".into(),
            name: "Name".into(),
            is_default: true,
            pre_launch_script: "export A='one'".into(),
            provider_script: "printf '%s\\n' \"$A\"".into(),
            tui_script: "case x in x) :;; esac".into(),
            created_at: 0,
            updated_at: 0,
        };
        assert_eq!(
            wrapper_source(&config, false, false),
            "#!/bin/sh\nset -e\nexport A='one'\nprintf '%s\\n' \"$A\"\ncase x in x) :;; esac\nexec \"$@\"\n"
        );
    }

    #[test]
    fn restores_codex_home_after_launch_scripts() {
        let config = AgentLaunchConfig {
            id: "id".into(),
            agent_id: "codex".into(),
            name: "Name".into(),
            is_default: true,
            pre_launch_script: String::new(),
            provider_script: String::new(),
            tui_script: "export CODEX_HOME=/changed".into(),
            created_at: 0,
            updated_at: 0,
        };
        let source = wrapper_source(&config, false, true);
        let save = source.find("devhatch_codex_home=$CODEX_HOME").unwrap();
        let readonly = source.find("readonly devhatch_codex_home").unwrap();
        let script = source.find("export CODEX_HOME=/changed").unwrap();
        let restore = source
            .find("export CODEX_HOME=\"$devhatch_codex_home\"")
            .unwrap();
        let exec = source.find("exec \"$@\"").unwrap();
        assert!(save < readonly && readonly < script && script < restore && restore < exec);
        assert!(!source.contains("DEVHATCH_CODEX_HOME"));

        let root = std::env::temp_dir().join(format!("devhatch-codex-wrapper-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let wrapper = root.join("launch.sh");
        std::fs::write(&wrapper, source).unwrap();
        let output = std::process::Command::new("/bin/sh")
            .arg(&wrapper)
            .arg("/bin/sh")
            .arg("-c")
            .arg("printf %s \"$CODEX_HOME\"")
            .env("CODEX_HOME", "/trusted")
            .env("DEVHATCH_CODEX_HOME", "/attacker")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"/trusted");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn restores_managed_config_directory_after_launch_scripts() {
        let config = AgentLaunchConfig {
            id: "id".into(),
            agent_id: "opencode".into(),
            name: "Name".into(),
            is_default: true,
            pre_launch_script: String::new(),
            provider_script: "export OPENCODE_CONFIG_DIR=/base/config".into(),
            tui_script: String::new(),
            created_at: 0,
            updated_at: 0,
        };
        let source = wrapper_source(&config, true, false);
        assert!(source.contains("devhatch_base_config_dir=${OPENCODE_CONFIG_DIR:-}"));
        assert!(source.contains("ln -s \"$devhatch_base_config_dir/$devhatch_entry\""));
        assert!(
            source.contains("export OPENCODE_CONFIG_DIR=\"$DEVHATCH_CONFIG_DIR\"\nexec \"$@\"")
        );
        assert!(
            source
                .find("export OPENCODE_CONFIG_DIR=/base/config")
                .unwrap()
                < source
                    .find("export OPENCODE_CONFIG_DIR=\"$DEVHATCH_CONFIG_DIR\"")
                    .unwrap()
        );
    }
}
