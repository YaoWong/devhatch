use std::{sync::Arc, time::Duration};

use futures_util::StreamExt;
use tokio::sync::broadcast;

use crate::{
    agent::OPENCODE_ID,
    session::{Session, SessionEvent},
    state::AppState,
};

pub(in crate::agent) fn start_event_watcher(
    session: &Arc<Session>,
    app_state: Arc<AppState>,
    port: u16,
    password: String,
) {
    let weak = Arc::downgrade(session);
    let mut events = session.subscribe();
    tokio::spawn(async move {
        let client = match reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(1))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        let url = format!("http://127.0.0.1:{port}/global/event");
        loop {
            let deleting = weak.upgrade().is_none_or(|session| session.is_deleting());
            if deleting {
                return;
            }
            let request = client
                .get(&url)
                .basic_auth("opencode", Some(&password))
                .send();
            let response = tokio::select! {
                response = request => response,
                _ = session_stopped(&mut events) => return,
            };
            let Ok(response) = response else {
                if retry_or_stop(&mut events).await {
                    return;
                }
                continue;
            };
            if !response.status().is_success() {
                if retry_or_stop(&mut events).await {
                    return;
                }
                continue;
            }
            let mut stream = response.bytes_stream();
            let mut pending = Vec::new();
            loop {
                let chunk = tokio::select! {
                    chunk = stream.next() => chunk,
                    _ = session_stopped(&mut events) => return,
                };
                let Some(Ok(chunk)) = chunk else { break };
                pending.extend_from_slice(&chunk);
                if pending.len() > 1024 * 1024 {
                    break;
                }
                while let Some((end, delimiter_len)) = sse_event_end(&pending) {
                    let event = pending.drain(..end + delimiter_len).collect::<Vec<_>>();
                    let Some((directory, id)) = parse_created_session_event(&event) else {
                        continue;
                    };
                    let Some(session) = weak.upgrade() else {
                        return;
                    };
                    if session.is_deleting() {
                        return;
                    }
                    let current = session.upstream_session_id();
                    let belongs_to_session = match current.as_deref() {
                        None => true,
                        Some(current) => {
                            let handle = app_state.history_pool().await;
                            let result = crate::history::fork_successor(
                                handle.as_ref().map(|handle| &handle.pool),
                                current,
                                &id,
                                &directory,
                            )
                            .await;
                            if result.is_err()
                                && let Some(handle) = &handle
                            {
                                app_state.invalidate_history_pool(handle).await;
                            }
                            result.unwrap_or(false)
                        }
                    };
                    if belongs_to_session {
                        let _reconciliation = app_state.history_reconciliation().lock().await;
                        let reconciled = session.upstream_session_id();
                        let identity_matches = match current.as_deref() {
                            None => {
                                reconciled.is_none() && session.correlation_details().0 == directory
                            }
                            Some(expected) => reconciled.as_deref() == Some(expected),
                        };
                        if identity_matches
                            && app_state.contains_session(&session)
                            && !session.is_deleting()
                            && !app_state.history_deletion_pending(OPENCODE_ID, &id)
                        {
                            session.compare_and_update_upstream_session_id(current.as_deref(), id);
                        }
                    }
                }
            }
            if retry_or_stop(&mut events).await {
                return;
            }
        }
    });
}

fn sse_event_end(pending: &[u8]) -> Option<(usize, usize)> {
    pending
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|end| (end, 4))
        .or_else(|| {
            pending
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|end| (end, 2))
        })
}

fn parse_created_session_event(event: &[u8]) -> Option<(String, String)> {
    let event = std::str::from_utf8(event).ok()?.replace("\r\n", "\n");
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    let value = serde_json::from_str::<serde_json::Value>(&data).ok()?;
    let payload = value.get("payload").unwrap_or(&value);
    if payload.get("type").and_then(serde_json::Value::as_str) != Some("session.created") {
        return None;
    }
    let info = payload
        .get("properties")
        .and_then(|properties| properties.get("info"))?;
    if info
        .get("parentID")
        .is_some_and(|parent_id| !parent_id.is_null())
    {
        return None;
    }
    let id = payload
        .get("properties")
        .and_then(|properties| properties.get("sessionID"))
        .and_then(serde_json::Value::as_str)
        .or_else(|| info.get("id").and_then(serde_json::Value::as_str));
    let directory = value
        .get("directory")
        .and_then(serde_json::Value::as_str)
        .or_else(|| info.get("directory").and_then(serde_json::Value::as_str))?;
    id.filter(|id| valid_upstream_session_id(id))
        .map(|id| (directory.to_string(), id.to_string()))
}

async fn session_stopped(events: &mut broadcast::Receiver<SessionEvent>) {
    loop {
        match events.recv().await {
            Ok(SessionEvent::Exit(_) | SessionEvent::Removed(_) | SessionEvent::Terminate) => {
                return;
            }
            Ok(SessionEvent::Output(_) | SessionEvent::UpstreamSessionChanged { .. })
            | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

async fn retry_or_stop(events: &mut broadcast::Receiver<SessionEvent>) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(100)) => false,
        _ = session_stopped(events) => true,
    }
}

pub(super) fn valid_upstream_session_id(value: &str) -> bool {
    let suffix = value.strip_prefix("ses_");
    matches!(suffix, Some(value) if !value.is_empty() && value.len() <= 124 && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'))
}

#[cfg(test)]
mod tests {
    use super::{parse_created_session_event, sse_event_end, valid_upstream_session_id};

    #[test]
    fn parses_root_session_created_events() {
        let event = b"data: {\"type\":\"session.created\",\"properties\":{\"info\":{\"id\":\"ses_abc-123_X\",\"directory\":\"/tmp\",\"parentID\":null}}}\r\n\r\n";
        assert_eq!(
            parse_created_session_event(event),
            Some(("/tmp".to_string(), "ses_abc-123_X".to_string()))
        );
        assert_eq!(sse_event_end(event), Some((event.len() - 4, 4)));

        let child = b"data: {\"type\":\"session.created\",\"properties\":{\"info\":{\"id\":\"ses_child\",\"parentID\":\"ses_parent\"}}}\n\n";
        assert_eq!(parse_created_session_event(child), None);

        let current = b"data: {\"directory\":\"/tmp\",\"payload\":{\"type\":\"session.created\",\"properties\":{\"sessionID\":\"ses_current\",\"info\":{\"directory\":\"/tmp\",\"parentID\":null}}}}\n\n";
        assert_eq!(
            parse_created_session_event(current),
            Some(("/tmp".to_string(), "ses_current".to_string()))
        );
    }

    #[test]
    fn validates_upstream_session_ids_strictly() {
        assert!(valid_upstream_session_id("ses_abc-123_X"));
        assert!(!valid_upstream_session_id("ses_"));
        assert!(!valid_upstream_session_id("ses_abc def"));
        assert!(!valid_upstream_session_id("other_abc"));
        assert!(!valid_upstream_session_id(&format!(
            "ses_{}",
            "x".repeat(125)
        )));
    }
}
