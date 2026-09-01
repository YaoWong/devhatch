use std::{
    io::{Read, Write},
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, SyncSender, TrySendError},
    },
};

use portable_pty::{Child, NativePtySystem, PtySize, PtySystem};
use uuid::Uuid;

use super::model::{
    Session, SessionCompletion, SessionEvent, SessionKind, SessionSpawn, SessionState,
    SessionStatus,
};
use crate::{clock::now, filesystem::path_string, state::SessionRegistry};

const OUTPUT_LIMIT: usize = 512 * 1024;
const INPUT_QUEUE_CAPACITY: usize = 64;

type PtyChild = Box<dyn Child + Send>;

trait ChildCleanup {
    fn kill_child(&mut self);
    fn wait_for_child(&mut self);
}

impl ChildCleanup for dyn Child + Send {
    fn kill_child(&mut self) {
        let _ = self.kill();
    }

    fn wait_for_child(&mut self) {
        let _ = self.wait();
    }
}

fn cleanup_child<T: ChildCleanup + ?Sized>(child: &mut T) {
    child.kill_child();
    child.wait_for_child();
}

struct SpawnedChild(Option<PtyChild>);

impl SpawnedChild {
    fn new(child: PtyChild) -> Self {
        Self(Some(child))
    }

    fn child(&self) -> &PtyChild {
        self.0.as_ref().expect("child must be present")
    }

    fn commit(mut self) -> PtyChild {
        self.0.take().expect("child must be present")
    }
}

impl Drop for SpawnedChild {
    fn drop(&mut self) {
        if let Some(child) = self.0.as_mut() {
            cleanup_child(child.as_mut());
        }
    }
}

impl Session {
    pub(crate) fn spawn<F>(
        sessions: Arc<SessionRegistry>,
        spawn: SessionSpawn,
        started: F,
    ) -> Result<Arc<Self>, Box<dyn std::error::Error>>
    where
        F: FnOnce(&Arc<Self>),
    {
        let cleanup_path = spawn.cleanup_path.clone();
        let exit_cleanup = spawn.exit_cleanup;
        let pair = NativePtySystem::default().openpty(PtySize {
            rows: spawn.rows,
            cols: spawn.cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        let child = pair.slave.spawn_command(spawn.command)?;
        let child = SpawnedChild::new(child);
        let process_id = child.child().process_id().unwrap_or_default();
        let process_identity = crate::process::ChildIdentity::capture(process_id);
        let killer = child.child().clone_killer();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let (input, input_receiver) = std::sync::mpsc::sync_channel(INPUT_QUEUE_CAPACITY);
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
            process_identity,
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
            input: std::sync::Mutex::new(Some(input)),
            killer: std::sync::Mutex::new(killer),
            deleting: AtomicBool::new(false),
            completion: SessionCompletion::default(),
            events,
            agent_id: spawn.agent_id,
            agent_name: spawn.agent_name,
        });
        if !sessions.insert(session.clone()) {
            return Err("server is shutting down".into());
        }
        if let Err(error) = Self::start_reader(&session, reader) {
            sessions.remove_if_same(session.id(), &session);
            return Err(error.into());
        }
        if let Err(error) = Self::start_writer(&session, writer, input_receiver) {
            sessions.remove_if_same(session.id(), &session);
            return Err(error.into());
        }
        let waiter = match Self::start_waiter(
            &session,
            child,
            sessions.clone(),
            cleanup_path,
            exit_cleanup,
        ) {
            Ok(waiter) => waiter,
            Err(error) => {
                sessions.remove_if_same(session.id(), &session);
                session.input.lock().expect("input lock poisoned").take();
                return Err(error.into());
            }
        };
        started(&session);
        if waiter.send(()).is_err() {
            sessions.remove_if_same(session.id(), &session);
            session.input.lock().expect("input lock poisoned").take();
            return Err("session waiter stopped before startup completed".into());
        }
        Ok(session)
    }

    pub(crate) fn is_deleting(&self) -> bool {
        self.deleting.load(Ordering::Acquire)
    }

    pub(crate) fn is_live(&self) -> bool {
        !self.is_deleting()
            && self.state.lock().expect("session lock poisoned").status == SessionStatus::Running
    }

    pub(crate) fn mark_deleting(&self) {
        self.deleting.store(true, Ordering::Release);
    }

    pub(crate) fn finish_exit(&self, code: Option<u32>) {
        self.input.lock().expect("input lock poisoned").take();
        {
            let mut state = self.state.lock().expect("session lock poisoned");
            state.status = SessionStatus::Exited;
            state.exit_code = code;
            state.updated_at = now();
        }
        let _ = self.events.send(SessionEvent::Exit(code));
        self.mark_deleting();
    }

    pub(crate) fn write_input(&self, data: &str) -> bool {
        if self.is_deleting()
            || self.state.lock().expect("session lock poisoned").status != SessionStatus::Running
        {
            return false;
        }
        let input = self.input.lock().expect("input lock poisoned");
        let Some(input) = input.as_ref() else {
            return false;
        };
        enqueue_input(input, data.as_bytes().to_vec())
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
        self.input.lock().expect("input lock poisoned").take();
        if self.state.lock().expect("session lock poisoned").status == SessionStatus::Running {
            #[cfg(unix)]
            if let Some(identity) = self.process_identity {
                let _ = crate::process::signal_owned_child(identity, libc::SIGTERM);
                std::thread::sleep(std::time::Duration::from_millis(250));
                let _ = crate::process::signal_owned_child(identity, libc::SIGKILL);
            }
            let _ = self.killer.lock().expect("killer lock poisoned").kill();
        }
        let _ = self.events.send(SessionEvent::Terminate);
    }

    fn start_writer(
        session: &Arc<Self>,
        mut writer: Box<dyn Write + Send>,
        input: Receiver<Vec<u8>>,
    ) -> std::io::Result<()> {
        let weak = Arc::downgrade(session);
        std::thread::Builder::new()
            .name(format!("session-writer-{}", session.id))
            .spawn(move || {
                while let Ok(data) = input.recv() {
                    if writer.write_all(&data).is_err() {
                        break;
                    }
                }
                if let Some(session) = weak.upgrade() {
                    session.input.lock().expect("input lock poisoned").take();
                }
            })?;
        Ok(())
    }

    fn start_reader(session: &Arc<Self>, mut reader: Box<dyn Read + Send>) -> std::io::Result<()> {
        let weak = Arc::downgrade(session);
        std::thread::Builder::new()
            .name(format!("session-reader-{}", session.id))
            .spawn(move || {
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
            })?;
        Ok(())
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
        child: SpawnedChild,
        sessions: Arc<SessionRegistry>,
        cleanup_path: Option<PathBuf>,
        exit_cleanup: Option<super::model::SessionExitCleanup>,
    ) -> std::io::Result<std::sync::mpsc::Sender<()>> {
        let weak = Arc::downgrade(session);
        let completion = session.completion.clone();
        let id = session.id.clone();
        let kind = session.kind;
        let (commit, committed) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name(format!("session-waiter-{}", session.id))
            .spawn(move || {
                if committed.recv().is_err() {
                    drop(child);
                    if let Some(path) = cleanup_path {
                        let _ = std::fs::remove_dir_all(path);
                    }
                    completion.complete();
                    return;
                }
                let mut child = child.commit();
                let status = child.wait();
                if let Some(path) = cleanup_path {
                    let _ = std::fs::remove_dir_all(path);
                }
                if let Some(session) = weak.upgrade() {
                    let code = status.ok().map(|status| status.exit_code());
                    if kind == SessionKind::Agent {
                        if let Some(cleanup) = exit_cleanup {
                            cleanup(session.clone(), code);
                        } else {
                            session.finish_exit(code);
                            sessions.remove_if_same(&id, &session);
                            session.publish_removed(code);
                        }
                    } else {
                        session.input.lock().expect("input lock poisoned").take();
                        {
                            let mut state = session.state.lock().expect("session lock poisoned");
                            state.status = SessionStatus::Exited;
                            state.exit_code = code;
                            state.updated_at = now();
                        }
                        let _ = session.events.send(SessionEvent::Exit(code));
                    }
                }
                completion.complete();
            })?;
        Ok(commit)
    }
}

fn enqueue_input(input: &SyncSender<Vec<u8>>, data: Vec<u8>) -> bool {
    match input.try_send(data) {
        Ok(()) => true,
        Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => false,
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
    use std::sync::mpsc::TryRecvError;

    use super::{ChildCleanup, OUTPUT_LIMIT, cleanup_child, enqueue_input, trim_output};

    #[derive(Default)]
    struct CleanupState {
        killed: bool,
        waited: bool,
    }

    impl ChildCleanup for CleanupState {
        fn kill_child(&mut self) {
            self.killed = true;
        }

        fn wait_for_child(&mut self) {
            assert!(self.killed);
            self.waited = true;
        }
    }

    #[test]
    fn bounded_input_queue_rejects_when_full_or_closed() {
        let (input, receiver) = std::sync::mpsc::sync_channel(1);
        assert!(enqueue_input(&input, vec![1]));
        assert!(!enqueue_input(&input, vec![2]));
        assert_eq!(receiver.recv().unwrap(), vec![1]);
        drop(receiver);
        assert!(!enqueue_input(&input, vec![3]));
    }

    #[test]
    fn failed_spawn_cleanup_kills_before_waiting() {
        let mut state = CleanupState::default();
        cleanup_child(&mut state);
        assert!(state.killed);
        assert!(state.waited);
    }

    #[test]
    fn waiter_commit_controls_child_ownership() {
        let (commit, committed) = std::sync::mpsc::channel();
        assert!(matches!(committed.try_recv(), Err(TryRecvError::Empty)));
        commit.send(()).unwrap();
        assert_eq!(committed.recv().unwrap(), ());
    }

    #[test]
    fn trims_output_on_character_boundaries() {
        let mut output = format!("é{}", "x".repeat(OUTPUT_LIMIT));
        trim_output(&mut output);
        assert_eq!(output.len(), OUTPUT_LIMIT);
        assert!(output.is_char_boundary(0));
    }
}
