use std::{
    os::unix::fs::PermissionsExt,
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
) -> std::io::Result<()> {
    std::fs::write(path, wrapper_source(config, use_managed_skills))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
}

fn wrapper_source(config: &AgentLaunchConfig, use_managed_skills: bool) -> String {
    let mut source = String::from("#!/bin/sh\nset -e\n");
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
    source.push_str("exec \"$@\"\n");
    source
}

#[cfg(test)]
mod tests {
    use super::wrapper_source;
    use crate::launch_config::AgentLaunchConfig;

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
            wrapper_source(&config, false),
            "#!/bin/sh\nset -e\nexport A='one'\nprintf '%s\\n' \"$A\"\ncase x in x) :;; esac\nexec \"$@\"\n"
        );
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
        let source = wrapper_source(&config, true);
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
