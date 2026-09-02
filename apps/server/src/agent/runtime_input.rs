use std::{
    fs::OpenOptions,
    io::{Cursor, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use portable_pty::CommandBuilder;
use uuid::Uuid;

use crate::session::Session;

use super::AgentKind;

pub(crate) const MAX_IMAGE_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
const CLIPBOARD_DIRECTORY: &str = "image-clipboard";
const ATTACHMENT_DIRECTORY: &str = "image-attachments";
const MAX_TERMINAL_IMAGE_ATTACHMENTS: usize = 32;
const MAX_TERMINAL_IMAGE_BYTES: u64 = 80 * 1024 * 1024;
const CLIPBOARD_SCRIPT: &str = "#!/bin/sh\nset -eu\n[ \"$#\" -eq 2 ] && [ \"$1\" = \"-t\" ] && [ \"$2\" = \"image/png\" ] || exit 1\nset -- \"$DEVHATCH_IMAGE_CLIPBOARD_DIR\"/*.png\n[ -f \"$1\" ] || exit 1\ncat -- \"$1\"\nrm -f -- \"$1\"\n";

pub(super) fn prepare_opencode(
    run_dir: &Path,
    command: &mut CommandBuilder,
) -> std::io::Result<()> {
    let clipboard_dir = run_dir.join(CLIPBOARD_DIRECTORY);
    std::fs::create_dir(&clipboard_dir)?;
    std::fs::set_permissions(&clipboard_dir, std::fs::Permissions::from_mode(0o700))?;
    let bin_dir = run_dir.join("bin");
    std::fs::create_dir(&bin_dir)?;
    std::fs::set_permissions(&bin_dir, std::fs::Permissions::from_mode(0o700))?;
    let shim = bin_dir.join("wl-paste");
    std::fs::write(&shim, CLIPBOARD_SCRIPT)?;
    std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o700))?;
    let mut paths = vec![bin_dir.clone()];
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    let path = std::env::join_paths(paths).map_err(std::io::Error::other)?;
    command.env("PATH", path);
    command.env("DEVHATCH_RUNTIME_BIN", bin_dir);
    command.env("DEVHATCH_IMAGE_CLIPBOARD_DIR", clipboard_dir);
    Ok(())
}

pub(super) fn configure_pi_endpoint(
    run_dir: &Path,
    command: &mut CommandBuilder,
) -> std::io::Result<crate::session::RuntimeEndpoint> {
    let password = Uuid::new_v4().to_string();
    command.env(
        "DEVHATCH_PI_IMAGE_ENDPOINT",
        run_dir.join("pi-image-endpoint.json"),
    );
    command.env("DEVHATCH_PI_IMAGE_PASSWORD", &password);
    Ok(crate::session::RuntimeEndpoint { port: 0, password })
}

pub(crate) async fn paste_image(
    client: &reqwest::Client,
    session: &Session,
    content_type: &str,
    bytes: &[u8],
) -> Result<(), PasteImageError> {
    let content_type = content_type.to_string();
    let image = bytes.to_vec();
    tokio::task::spawn_blocking(move || validate_png(&content_type, &image))
        .await
        .map_err(|_| PasteImageError::Unavailable)??;
    let kind = session
        .agent_id()
        .and_then(|id| AgentKind::try_from(id).ok())
        .ok_or(PasteImageError::Unsupported)?;
    match kind {
        AgentKind::OpenCode => paste_opencode_image(client, session, bytes).await,
        AgentKind::Pi => paste_pi_image(client, session, bytes).await,
        AgentKind::Codex | AgentKind::TraeCli => {
            let version = super::launch::installed_version(kind).await;
            if !super::launch::supports_image_paste(kind, version.as_deref()) {
                return Err(PasteImageError::Unsupported);
            }
            paste_terminal_image(session, bytes).await
        }
    }
}

async fn paste_terminal_image(session: &Session, bytes: &[u8]) -> Result<(), PasteImageError> {
    let _runtime_input = session.runtime_input.lock().await;
    if !session.is_live() {
        return Err(PasteImageError::Unavailable);
    }
    let run_dir = session.runtime_dir().ok_or(PasteImageError::Unavailable)?;
    let attachment_dir = run_dir.join(ATTACHMENT_DIRECTORY);
    ensure_private_attachment_directory(&attachment_dir)?;
    let attachment_dir = attachment_dir
        .canonicalize()
        .map_err(|_| PasteImageError::Unavailable)?;
    let (count, total_bytes) = terminal_attachment_usage(&attachment_dir)?;
    if count >= MAX_TERMINAL_IMAGE_ATTACHMENTS
        || total_bytes.saturating_add(bytes.len() as u64) > MAX_TERMINAL_IMAGE_BYTES
    {
        return Err(PasteImageError::Busy);
    }
    let target = attachment_dir.join(format!("{}.png", Uuid::new_v4().simple()));
    write_private_file(&target, bytes).map_err(|_| PasteImageError::Unavailable)?;
    let mut staged = StagedImage::new(target);
    let paste = terminal_image_paste(staged.path())?;
    if !session.write_input(&paste) {
        return Err(PasteImageError::Unavailable);
    }
    staged.disarm();
    Ok(())
}

fn terminal_image_paste(path: &Path) -> Result<String, PasteImageError> {
    if !path.is_absolute() {
        return Err(PasteImageError::Unavailable);
    }
    let path = path
        .to_str()
        .filter(|path| !path.contains(['\u{1b}', '\r', '\n']))
        .ok_or(PasteImageError::Unavailable)?;
    Ok(format!("\u{1b}[200~{path}\u{1b}[201~"))
}

fn ensure_private_attachment_directory(directory: &Path) -> Result<(), PasteImageError> {
    match std::fs::create_dir(directory) {
        Ok(()) => std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| PasteImageError::Unavailable),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let metadata =
                std::fs::symlink_metadata(directory).map_err(|_| PasteImageError::Unavailable)?;
            if !metadata.file_type().is_dir() || metadata.permissions().mode() & 0o777 != 0o700 {
                return Err(PasteImageError::Unavailable);
            }
            Ok(())
        }
        Err(_) => Err(PasteImageError::Unavailable),
    }
}

fn terminal_attachment_usage(directory: &Path) -> Result<(usize, u64), PasteImageError> {
    let mut count = 0_usize;
    let mut total_bytes = 0_u64;
    for entry in std::fs::read_dir(directory).map_err(|_| PasteImageError::Unavailable)? {
        let entry = entry.map_err(|_| PasteImageError::Unavailable)?;
        let file_type = entry
            .file_type()
            .map_err(|_| PasteImageError::Unavailable)?;
        if !file_type.is_file() || entry.path().extension().is_none_or(|value| value != "png") {
            return Err(PasteImageError::Unavailable);
        }
        let metadata = entry.metadata().map_err(|_| PasteImageError::Unavailable)?;
        count = count.saturating_add(1);
        total_bytes = total_bytes.saturating_add(metadata.len());
    }
    Ok((count, total_bytes))
}

async fn paste_pi_image(
    client: &reqwest::Client,
    session: &Session,
    bytes: &[u8],
) -> Result<(), PasteImageError> {
    let _runtime_input = session.runtime_input.lock().await;
    if !session.is_live() {
        return Err(PasteImageError::Unavailable);
    }
    let endpoint = session
        .runtime_endpoint()
        .ok_or(PasteImageError::Unavailable)?;
    let run_dir = session.runtime_dir().ok_or(PasteImageError::Unavailable)?;
    let endpoint_file = run_dir.join("pi-image-endpoint.json");
    let request_id = Uuid::new_v4().simple().to_string();
    for _ in 0..50 {
        if !session.is_live() {
            return Err(PasteImageError::Unavailable);
        }
        let port = std::fs::read(&endpoint_file)
            .ok()
            .filter(|bytes| bytes.len() <= 128)
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|value| value.get("port")?.as_u64())
            .and_then(|port| u16::try_from(port).ok())
            .filter(|port| *port != 0);
        let Some(port) = port else {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        };
        let url = format!("http://127.0.0.1:{port}/image-paste");
        match client
            .post(&url)
            .timeout(std::time::Duration::from_secs(18))
            .basic_auth("pi", Some(&endpoint.password))
            .header(reqwest::header::CONTENT_TYPE, "image/png")
            .header("x-devhatch-request-id", &request_id)
            .body(bytes.to_vec())
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) if response.status() == reqwest::StatusCode::CONFLICT => {
                return Err(PasteImageError::Busy);
            }
            Ok(response) if response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY => {
                return Err(PasteImageError::InvalidImage);
            }
            _ => return Err(PasteImageError::Unavailable),
        }
    }
    Err(PasteImageError::Unavailable)
}

async fn paste_opencode_image(
    client: &reqwest::Client,
    session: &Session,
    bytes: &[u8],
) -> Result<(), PasteImageError> {
    let _runtime_input = session.runtime_input.lock().await;
    let run_dir = session.runtime_dir().ok_or(PasteImageError::Unavailable)?;
    let endpoint = session
        .runtime_endpoint()
        .ok_or(PasteImageError::Unavailable)?;
    let clipboard_dir = run_dir.join(CLIPBOARD_DIRECTORY);
    if std::fs::read_dir(&clipboard_dir)
        .map_err(|_| PasteImageError::Unavailable)?
        .filter_map(Result::ok)
        .any(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension == "png")
        })
    {
        return Err(PasteImageError::Busy);
    }
    let sequence = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| PasteImageError::Unavailable)?
        .as_nanos();
    let name = format!("{sequence:032x}-{}", Uuid::new_v4().simple());
    let temporary = clipboard_dir.join(format!(".{name}.tmp"));
    let target = clipboard_dir.join(format!("{name}.png"));
    write_private_file(&temporary, bytes).map_err(|_| PasteImageError::Unavailable)?;
    let mut staged = StagedImage::new(temporary);
    std::fs::rename(staged.path(), &target).map_err(|_| PasteImageError::Unavailable)?;
    staged.path = target;
    let url = format!("http://127.0.0.1:{}/tui/publish", endpoint.port);
    let body = serde_json::json!({
        "type": "tui.command.execute",
        "properties": { "command": "prompt.paste" }
    });
    let mut published = false;
    for _ in 0..10 {
        if !session.is_live() {
            return Err(PasteImageError::Unavailable);
        }
        match client
            .post(&url)
            .basic_auth("opencode", Some(&endpoint.password))
            .json(&body)
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => {
                published = true;
                break;
            }
            _ => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
        }
    }
    if !published {
        return Err(PasteImageError::Unavailable);
    }
    for _ in 0..50 {
        if !session.is_live() {
            return Err(PasteImageError::Unavailable);
        }
        if !staged.path().exists() {
            staged.disarm();
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    Err(PasteImageError::Unavailable)
}

fn write_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    options.mode(0o600);
    let mut file = options.open(path)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    drop(file);
    if let Err(error) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

struct StagedImage {
    path: std::path::PathBuf,
    armed: bool,
}

impl StagedImage {
    fn new(path: std::path::PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn path(&self) -> &Path {
        &self.path
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StagedImage {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn validate_png(content_type: &str, bytes: &[u8]) -> Result<(), PasteImageError> {
    if content_type.split(';').next().map(str::trim) != Some("image/png") {
        return Err(PasteImageError::UnsupportedMediaType);
    }
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_UPLOAD_BYTES {
        return Err(PasteImageError::InvalidImage);
    }
    if bytes.len() < 24 || bytes[..8] != *b"\x89PNG\r\n\x1a\n" {
        return Err(PasteImageError::InvalidImage);
    }
    let mut offset = 8;
    let mut dimensions = None;
    let mut has_data = false;
    let mut has_end = false;
    while offset <= bytes.len().saturating_sub(12) {
        let length = u32::from_be_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .expect("PNG chunk length is present"),
        ) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
            .filter(|end| *end <= bytes.len())
            .ok_or(PasteImageError::InvalidImage)?;
        let kind = &bytes[offset + 4..offset + 8];
        let data = &bytes[offset + 8..offset + 8 + length];
        let expected_crc = u32::from_be_bytes(
            bytes[offset + 8 + length..end]
                .try_into()
                .expect("PNG chunk CRC is present"),
        );
        let mut crc = crc32fast::Hasher::new();
        crc.update(kind);
        crc.update(data);
        if crc.finalize() != expected_crc {
            return Err(PasteImageError::InvalidImage);
        }
        if offset == 8 {
            if kind != b"IHDR" || length != 13 {
                return Err(PasteImageError::InvalidImage);
            }
            dimensions = Some((
                u32::from_be_bytes(data[..4].try_into().expect("PNG width is present")),
                u32::from_be_bytes(data[4..8].try_into().expect("PNG height is present")),
            ));
            let bit_depth = data[8];
            let color_type = data[9];
            if !matches!(
                (color_type, bit_depth),
                (0, 1 | 2 | 4 | 8 | 16) | (2 | 4 | 6, 8 | 16) | (3, 1 | 2 | 4 | 8)
            ) || data[10] != 0
                || data[11] != 0
                || data[12] > 1
            {
                return Err(PasteImageError::InvalidImage);
            }
        }
        if kind == b"acTL" || kind == b"fcTL" || kind == b"fdAT" {
            return Err(PasteImageError::InvalidImage);
        }
        if kind == b"IDAT" {
            has_data = true;
        }
        if kind == b"IEND" {
            if length != 0 || end != bytes.len() {
                return Err(PasteImageError::InvalidImage);
            }
            has_end = true;
            break;
        }
        offset = end;
    }
    let (width, height) = dimensions.ok_or(PasteImageError::InvalidImage)?;
    if !has_data
        || !has_end
        || width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(PasteImageError::InvalidImage);
    }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|_| PasteImageError::InvalidImage)?;
    while reader
        .next_row()
        .map_err(|_| PasteImageError::InvalidImage)?
        .is_some()
    {}
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PasteImageError {
    Unsupported,
    UnsupportedMediaType,
    InvalidImage,
    Busy,
    Unavailable,
}

#[cfg(test)]
mod tests {
    use std::{os::unix::fs::PermissionsExt, path::Path, process::Command};

    use portable_pty::CommandBuilder;

    use super::{
        PasteImageError, configure_pi_endpoint, ensure_private_attachment_directory,
        prepare_opencode, terminal_attachment_usage, terminal_image_paste, validate_png,
    };

    fn png(width: u32, height: u32) -> Vec<u8> {
        if u64::from(width) * u64::from(height) > 40_000_000 {
            fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
                let mut bytes = (data.len() as u32).to_be_bytes().to_vec();
                bytes.extend(kind);
                bytes.extend(data);
                let mut crc = crc32fast::Hasher::new();
                crc.update(kind);
                crc.update(data);
                bytes.extend(crc.finalize().to_be_bytes());
                bytes
            }
            let mut header = width.to_be_bytes().to_vec();
            header.extend(height.to_be_bytes());
            header.extend([8, 6, 0, 0, 0]);
            let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
            bytes.extend(chunk(b"IHDR", &header));
            bytes.extend(chunk(b"IDAT", &[0]));
            bytes.extend(chunk(b"IEND", &[]));
            return bytes;
        }
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer
                .write_image_data(&vec![0; width as usize * height as usize * 4])
                .unwrap();
        }
        bytes
    }

    #[test]
    fn validates_png_header_and_dimensions() {
        assert_eq!(validate_png("image/png", &png(800, 600)), Ok(()));
        assert_eq!(
            validate_png("image/jpeg", &png(800, 600)),
            Err(PasteImageError::UnsupportedMediaType)
        );
        assert_eq!(
            validate_png("image/png", b"not a png"),
            Err(PasteImageError::InvalidImage)
        );
        let mut corrupt = png(800, 600);
        corrupt[30] ^= 1;
        assert_eq!(
            validate_png("image/png", &corrupt),
            Err(PasteImageError::InvalidImage)
        );
        assert_eq!(
            validate_png("image/png", &png(20_000, 1)),
            Err(PasteImageError::InvalidImage)
        );
        assert_eq!(
            validate_png("image/png", &png(10_000, 10_000)),
            Err(PasteImageError::InvalidImage)
        );
        let mut invalid_color = png(800, 600);
        invalid_color[25] = 1;
        let mut crc = crc32fast::Hasher::new();
        crc.update(b"IHDR");
        crc.update(&invalid_color[16..29]);
        invalid_color[29..33].copy_from_slice(&crc.finalize().to_be_bytes());
        assert_eq!(
            validate_png("image/png", &invalid_color),
            Err(PasteImageError::InvalidImage)
        );
    }

    #[test]
    fn configures_private_pi_image_endpoint() {
        let temp = tempfile::tempdir().unwrap();
        let mut command = CommandBuilder::new("pi");
        let endpoint = configure_pi_endpoint(temp.path(), &mut command).unwrap();
        assert_eq!(endpoint.port, 0);
        assert!(!endpoint.password.is_empty());
    }

    #[test]
    fn prepares_private_terminal_image_attachments_and_bracketed_paste() {
        let temp = tempfile::tempdir().unwrap();
        let attachments = temp.path().join("image-attachments");
        ensure_private_attachment_directory(&attachments).unwrap();
        assert_eq!(
            std::fs::metadata(&attachments)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        let image = attachments.join("001.png");
        std::fs::write(&image, b"first").unwrap();
        std::fs::set_permissions(&image, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(terminal_attachment_usage(&attachments), Ok((1, 5)));
        assert_eq!(
            terminal_image_paste(Path::new("relative.png")),
            Err(PasteImageError::Unavailable)
        );
        assert_eq!(
            terminal_image_paste(&image),
            Ok(format!("\u{1b}[200~{}\u{1b}[201~", image.to_string_lossy()))
        );
    }

    #[test]
    fn rejects_unsafe_terminal_attachment_directory() {
        let temp = tempfile::tempdir().unwrap();
        let attachments = temp.path().join("image-attachments");
        std::fs::create_dir(&attachments).unwrap();
        std::fs::set_permissions(&attachments, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            ensure_private_attachment_directory(&attachments),
            Err(PasteImageError::Unavailable)
        );
    }

    #[test]
    fn opencode_clipboard_shim_is_private_and_consumes_one_image() {
        let temp = tempfile::tempdir().unwrap();
        let mut command = CommandBuilder::new("opencode");
        prepare_opencode(temp.path(), &mut command).unwrap();
        let shim = temp.path().join("bin/wl-paste");
        let clipboard = temp.path().join("image-clipboard");
        assert_eq!(
            std::fs::metadata(&shim).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            std::fs::metadata(&clipboard).unwrap().permissions().mode() & 0o777,
            0o700
        );
        std::fs::write(clipboard.join("001.png"), b"first").unwrap();
        std::fs::write(clipboard.join("002.png"), b"second").unwrap();
        let output = Command::new(&shim)
            .args(["-t", "image/png"])
            .env("DEVHATCH_IMAGE_CLIPBOARD_DIR", &clipboard)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"first");
        assert!(!clipboard.join("001.png").exists());
        assert!(clipboard.join("002.png").exists());
    }
}
