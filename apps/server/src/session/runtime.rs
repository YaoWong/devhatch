use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use portable_pty::{NativePtySystem, PtySize, PtySystem};
use uuid::Uuid;

use super::model::{Session, SessionEvent, SessionKind, SessionSpawn, SessionState, SessionStatus};
use crate::{clock::now, filesystem::path_string, state::AppState};

const OUTPUT_LIMIT: usize = 512 * 1024;

impl Session {
    pub(crate) fn spawn<F>(
        app_state: Arc<AppState>,
        spawn: SessionSpawn,
        started: F,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error>>
    where
        F: FnOnce(&Arc<Self>),
    {
        let cleanup_path = spawn.cleanup_path.clone();
        let pair = NativePtySystem::default().openpty(PtySize {
            rows: spawn.rows,
            cols: spawn.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let child = pair.slave.spawn_command(spawn.command)?;
        let process_id = child.process_id().unwrap_or_default();
        let killer = child.clone_killer();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let timestamp = now();
        let (events, _) = tokio::sync::broadcast::channel(1024);
        let session = Arc::new(Self {
            id: Uuid::new_v4().to_string(),
            shell: spawn.shell,
            kind: spawn.kind,
            identity: std::sync::Mutex::new(super::model::SessionIdentity {
                upstream_session_id: spawn.upstream_session_id,
                upstream_session_file: None,
                cwd: path_string(spawn.cwd),
            }),
            process_id,
            state: std::sync::Mutex::new(SessionState {
                name: spawn.name,
                status: SessionStatus::Running,
                cols: spawn.cols,
                rows: spawn.rows,
                created_at: timestamp,
                updated_at: timestamp,
                exit_code: None,
                output: String::new(),
            }),
            master: std::sync::Mutex::new(pair.master),
            writer: std::sync::Mutex::new(writer),
            killer: std::sync::Mutex::new(killer),
            deleting: AtomicBool::new(false),
            events,
            agent_id: spawn.agent_id,
            agent_name: spawn.agent_name,
        });
        app_state.insert_session(session.clone());
        Self::start_reader(&session, reader);
        started(&session);
        Self::start_waiter(&session, child, app_state, cleanup_path);
        Ok(session)
    }

    pub(crate) fn is_deleting(&self) -> bool {
        self.deleting.load(Ordering::Acquire)
    }

    pub(crate) fn mark_deleting(&self) {
        self.deleting.store(true, Ordering::Release);
    }

    pub(crate) fn write_input(&self, data: &str) {
        if !self.is_deleting()
            && self.state.lock().expect("session lock poisoned").status == SessionStatus::Running
        {
            let _ = self
                .writer
                .lock()
                .expect("writer lock poisoned")
                .write_all(data.as_bytes());
        }
    }

    pub(crate) fn resize(&self, cols: u16, rows: u16) {
        let running = {
            let mut state = self.state.lock().expect("session lock poisoned");
            state.cols = cols;
            state.rows = rows;
            state.updated_at = now();
            !self.is_deleting() && state.status == SessionStatus::Running
        };
        if running {
            let _ = self
                .master
                .lock()
                .expect("master lock poisoned")
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                });
        }
    }

    pub(crate) fn dimensions(&self) -> (u16, u16) {
        let state = self.state.lock().expect("session lock poisoned");
        (state.cols, state.rows)
    }

    pub(crate) fn terminate(&self) {
        if self.state.lock().expect("session lock poisoned").status == SessionStatus::Running {
            let _ = self.killer.lock().expect("killer lock poisoned").kill();
        }
        let _ = self.events.send(SessionEvent::Terminate);
    }

    fn start_reader(session: &Arc<Self>, mut reader: Box<dyn Read + Send>) {
        let weak = Arc::downgrade(session);
        std::thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            let mut pending = Vec::new();
            while let Ok(length) = reader.read(&mut buffer) {
                if length == 0 {
                    if !pending.is_empty()
                        && let Some(session) = weak.upgrade()
                    {
                        session.publish_output(String::from_utf8_lossy(&pending).into_owned());
                    }
                    break;
                }
                pending.extend_from_slice(&buffer[..length]);
                let valid_length = match std::str::from_utf8(&pending) {
                    Ok(_) => pending.len(),
                    Err(error) if error.error_len().is_none() => error.valid_up_to(),
                    Err(error) => error
                        .valid_up_to()
                        .saturating_add(error.error_len().unwrap_or(0)),
                };
                if valid_length == 0 {
                    continue;
                }
                let Some(session) = weak.upgrade() else {
                    break;
                };
                let data = String::from_utf8_lossy(&pending[..valid_length]).into_owned();
                pending.drain(..valid_length);
                session.publish_output(data);
            }
        });
    }

    fn publish_output(&self, data: String) {
        let mut state = self.state.lock().expect("session lock poisoned");
        state.updated_at = now();
        state.output.push_str(&data);
        trim_output(&mut state.output);
        let _ = self.events.send(SessionEvent::Output(data));
    }

    fn start_waiter(
        session: &Arc<Self>,
        mut child: Box<dyn portable_pty::Child + Send>,
        app_state: Arc<AppState>,
        cleanup_path: Option<PathBuf>,
    ) {
        let weak = Arc::downgrade(session);
        let id = session.id.clone();
        let kind = session.kind;
        std::thread::spawn(move || {
            let status = child.wait();
            if let Some(path) = cleanup_path {
                let _ = std::fs::remove_dir_all(path);
            }
            let Some(session) = weak.upgrade() else {
                return;
            };
            let code = status.ok().map(|status| status.exit_code());
            {
                let mut state = session.state.lock().expect("session lock poisoned");
                state.status = SessionStatus::Exited;
                state.exit_code = code;
                state.updated_at = now();
            }
            let _ = session.events.send(SessionEvent::Exit(code));
            if kind == SessionKind::Agent {
                app_state.remove_session_if_same(&id, &session);
                session.mark_deleting();
                let _ = session.events.send(SessionEvent::Removed(code));
            }
        });
    }
}

fn trim_output(output: &mut String) {
    if output.len() <= OUTPUT_LIMIT {
        return;
    }
    let mut start = output.len() - OUTPUT_LIMIT;
    while !output.is_char_boundary(start) {
        start += 1;
    }
    output.drain(..start);
}

#[cfg(test)]
mod tests {
    use super::{OUTPUT_LIMIT, trim_output};

    #[test]
    fn trims_output_on_character_boundaries() {
        let mut output = format!("é{}", "x".repeat(OUTPUT_LIMIT));
        trim_output(&mut output);
        assert_eq!(output.len(), OUTPUT_LIMIT);
        assert!(output.is_char_boundary(0));
    }
}
