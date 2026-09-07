mod agent;
mod agent_workspace;
mod api;
mod auth;
mod clock;
mod filesystem;
mod history;
mod launch_config;
mod launch_path;
mod process;
mod router;
mod server;
mod session;
mod settings;
mod skillink;
mod state;
mod supervisor;
mod terminal;
mod terminal_launch_path;
mod terminal_workspace;
mod web_app;

const ADMIN_PASSWORD_FILE_ENV: &str = "DEVHATCH_ADMIN_PASSWORD_FILE";

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = std::env::args_os().skip(1).collect::<Vec<_>>();
    match arguments.as_slice() {
        [] => run_server(read_admin_password()?),
        [mode] if mode == std::ffi::OsStr::new("--systemd-server") => run_server(None),
        [mode, path] if mode == std::ffi::OsStr::new("--systemd-handoff-wait") => {
            supervisor::run_handoff_helper(std::path::Path::new(path))
        }
        [mode, path] if mode == std::ffi::OsStr::new("--systemd-launch") => {
            supervisor::run_systemd_launcher(std::path::Path::new(path))
        }
        _ => Err("invalid command-line arguments".into()),
    }
}

fn run_server(admin_password: Option<String>) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        std::env::remove_var(ADMIN_PASSWORD_FILE_ENV);
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(server::run(admin_password))
}

fn read_admin_password() -> Result<Option<String>, Box<dyn std::error::Error>> {
    let Some(path) = std::env::var_os(ADMIN_PASSWORD_FILE_ENV) else {
        return Ok(None);
    };
    read_password_file(std::path::Path::new(&path)).map(Some)
}

const MAX_PASSWORD_FILE_BYTES: usize = 1026;

fn read_password_file(path: &std::path::Path) -> Result<String, Box<dyn std::error::Error>> {
    use std::io::Read;

    let mut file = open_password_file(path)?;
    validate_password_file(&file)?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take((MAX_PASSWORD_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "failed to read administrator password file")?;
    if bytes.len() > MAX_PASSWORD_FILE_BYTES {
        return Err("administrator password file is too large".into());
    }
    if bytes.ends_with(b"\r\n") {
        bytes.truncate(bytes.len() - 2);
    } else if bytes.ends_with(b"\n") {
        bytes.pop();
    }
    if bytes.contains(&b'\r') || bytes.contains(&b'\n') {
        return Err("administrator password file must contain only one line".into());
    }
    if bytes.contains(&b'\0') {
        return Err("administrator password file must not contain NUL bytes".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "administrator password file must contain valid UTF-8".into())
}

#[cfg(unix)]
fn open_password_file(path: &std::path::Path) -> Result<std::fs::File, Box<dyn std::error::Error>> {
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| "failed to open administrator password file".into())
}

#[cfg(not(unix))]
fn open_password_file(path: &std::path::Path) -> Result<std::fs::File, Box<dyn std::error::Error>> {
    std::fs::File::open(path).map_err(|_| "failed to open administrator password file".into())
}

#[cfg(unix)]
fn validate_password_file(file: &std::fs::File) -> Result<(), Box<dyn std::error::Error>> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file
        .metadata()
        .map_err(|_| "failed to inspect administrator password file")?;
    if !metadata.file_type().is_file() {
        return Err("administrator password file must be a regular file".into());
    }
    if metadata.uid() != unsafe { libc::geteuid() } {
        return Err("administrator password file must be owned by the current user".into());
    }
    if metadata.mode() & 0o077 != 0 {
        return Err("administrator password file must not grant group or other permissions".into());
    }
    if metadata.len() > MAX_PASSWORD_FILE_BYTES as u64 {
        return Err("administrator password file is too large".into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_password_file(file: &std::fs::File) -> Result<(), Box<dyn std::error::Error>> {
    let metadata = file
        .metadata()
        .map_err(|_| "failed to inspect administrator password file")?;
    if !metadata.file_type().is_file() {
        return Err("administrator password file must be a regular file".into());
    }
    if metadata.len() > MAX_PASSWORD_FILE_BYTES as u64 {
        return Err("administrator password file is too large".into());
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::read_password_file;

    fn password_file(contents: &[u8]) -> (tempfile::TempDir, std::path::PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("password");
        std::fs::write(&path, contents).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        (root, path)
    }

    #[test]
    fn accepts_no_newline_lf_and_crlf() {
        for (contents, expected) in [
            (b"password".as_slice(), "password"),
            (b"password\n".as_slice(), "password"),
            (b"password\r\n".as_slice(), "password"),
        ] {
            let (_root, path) = password_file(contents);
            assert_eq!(read_password_file(&path).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_symlink() {
        let (root, path) = password_file(b"password");
        let link = root.path().join("password-link");
        std::os::unix::fs::symlink(path, &link).unwrap();
        assert!(read_password_file(&link).is_err());
    }

    #[test]
    fn rejects_group_permissions() {
        let (_root, path) = password_file(b"password");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        assert!(read_password_file(&path).is_err());
    }

    #[test]
    fn rejects_extra_or_embedded_newlines() {
        for contents in [b"password\n\n".as_slice(), b"pass\nword".as_slice()] {
            let (_root, path) = password_file(contents);
            assert!(read_password_file(&path).is_err());
        }
    }

    #[test]
    fn rejects_oversize_file() {
        let (_root, path) = password_file(&vec![b'x'; 1027]);
        assert!(read_password_file(&path).is_err());
    }

    #[test]
    fn rejects_nul_and_invalid_utf8() {
        for contents in [b"password\0suffix".as_slice(), &[0xff]] {
            let (_root, path) = password_file(contents);
            assert!(read_password_file(&path).is_err());
        }
    }
}
