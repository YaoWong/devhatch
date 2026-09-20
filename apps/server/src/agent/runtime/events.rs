use std::{
    sync::{Arc, Weak},
    time::Duration,
};

use futures_util::StreamExt;
use serde_json::Value;
use tokio::sync::broadcast;

use crate::{
    agent::OPENCODE_ID,
    session::{AgentActivityPhase, AgentActivityStatus, Session, SessionEvent},
    state::AppState,
};

struct ActivityUpdate {
    status: AgentActivityStatus,
    phase: AgentActivityPhase,
    detail: Option<String>,
}

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
            .tcp_keepalive(Duration::from_secs(30))
            .build()
        {
            Ok(client) => client,
            Err(_) => return,
        };
        let event_url = format!("http://127.0.0.1:{port}/global/event");
        let status_url = format!("http://127.0.0.1:{port}/session/status");
        loop {
            let deleting = weak.upgrade().is_none_or(|session| session.is_deleting());
            if deleting {
                return;
            }
            let request = client
                .get(&event_url)
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .basic_auth("opencode", Some(&password))
                .send();
            let response = tokio::select! {
                response = request => response,
                _ = tokio::time::sleep(Duration::from_secs(2)) => {
                    if retry_or_stop(&mut events).await {
                        return;
                    }
                    continue;
                }
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
            publish_status_snapshot(&client, &status_url, &password, &weak).await;
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
                    let Some(value) = parse_sse_event(&event) else {
                        continue;
                    };
                    let Some(session) = weak.upgrade() else {
                        return;
                    };
                    if session.is_deleting() {
                        return;
                    }
                    let identity_updated =
                        update_created_session(&value, &session, &app_state).await;
                    if identity_updated {
                        publish_status_snapshot(&client, &status_url, &password, &weak).await;
                    }
                    if let Some(upstream_id) = session.upstream_session_id()
                        && let Some(activity) = parse_activity_event(&value, &upstream_id)
                    {
                        session.publish_agent_activity(
                            activity.status,
                            activity.phase,
                            activity.detail,
                        );
                    }
                }
            }
            if retry_or_stop(&mut events).await {
                return;
            }
        }
    });
}

async fn publish_status_snapshot(
    client: &reqwest::Client,
    url: &str,
    password: &str,
    weak: &Weak<Session>,
) {
    let Some(session) = weak.upgrade() else {
        return;
    };
    if session.is_deleting() {
        return;
    }
    let Some(upstream_id) = session.upstream_session_id() else {
        return;
    };
    let Ok(response) = client
        .get(url)
        .basic_auth("opencode", Some(password))
        .timeout(Duration::from_secs(2))
        .send()
        .await
    else {
        return;
    };
    if !response.status().is_success() {
        return;
    }
    let Ok(value) = response.json::<Value>().await else {
        return;
    };
    let activity = value
        .get(&upstream_id)
        .and_then(activity_from_status)
        .unwrap_or(ActivityUpdate {
            status: AgentActivityStatus::Idle,
            phase: AgentActivityPhase::Idle,
            detail: None,
        });
    session.publish_agent_activity(activity.status, activity.phase, activity.detail);
}

async fn update_created_session(
    value: &Value,
    session: &Arc<Session>,
    app_state: &AppState,
) -> bool {
    let Some((directory, id)) = parse_created_session_value(value) else {
        return false;
    };
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
    if !belongs_to_session {
        return false;
    }
    let _reconciliation = app_state.history_reconciliation().lock().await;
    let reconciled = session.upstream_session_id();
    let identity_matches = match current.as_deref() {
        None => reconciled.is_none() && session.correlation_details().0 == directory,
        Some(expected) => reconciled.as_deref() == Some(expected),
    };
    if identity_matches
        && app_state.contains_session(session)
        && !session.is_deleting()
        && !app_state.history_deletion_pending(OPENCODE_ID, &id)
    {
        return session.compare_and_update_upstream_session_id(current.as_deref(), id);
    }
    false
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

fn parse_sse_event(event: &[u8]) -> Option<Value> {
    let event = std::str::from_utf8(event).ok()?.replace("\r\n", "\n");
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    serde_json::from_str::<Value>(&data).ok()
}

fn payload(value: &Value) -> &Value {
    value.get("payload").unwrap_or(value)
}

#[cfg(test)]
fn parse_created_session_event(event: &[u8]) -> Option<(String, String)> {
    let value = parse_sse_event(event)?;
    parse_created_session_value(&value)
}

fn parse_created_session_value(value: &Value) -> Option<(String, String)> {
    let payload = payload(value);
    if payload.get("type").and_then(Value::as_str) != Some("session.created") {
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
        .and_then(Value::as_str)
        .or_else(|| info.get("id").and_then(Value::as_str));
    let directory = value
        .get("directory")
        .and_then(Value::as_str)
        .or_else(|| info.get("directory").and_then(Value::as_str))?;
    id.filter(|id| valid_upstream_session_id(id))
        .map(|id| (directory.to_string(), id.to_string()))
}

fn parse_activity_event(value: &Value, upstream_session_id: &str) -> Option<ActivityUpdate> {
    let payload = payload(value);
    let event_type = payload.get("type")?.as_str()?;
    let properties = payload.get("properties")?;
    if event_session_id(properties) != Some(upstream_session_id) {
        return None;
    }
    match event_type {
        "session.status" => properties.get("status").and_then(activity_from_status),
        "session.idle" => Some(ActivityUpdate {
            status: AgentActivityStatus::Idle,
            phase: AgentActivityPhase::Idle,
            detail: None,
        }),
        "permission.asked" | "permission.v2.asked" => Some(ActivityUpdate {
            status: AgentActivityStatus::Waiting,
            phase: AgentActivityPhase::Permission,
            detail: Some("Waiting for permission".to_string()),
        }),
        "question.asked" | "question.v2.asked" => Some(ActivityUpdate {
            status: AgentActivityStatus::Waiting,
            phase: AgentActivityPhase::Question,
            detail: Some("Waiting for answer".to_string()),
        }),
        "permission.replied"
        | "permission.v2.replied"
        | "question.replied"
        | "question.v2.replied"
        | "question.rejected"
        | "question.v2.rejected" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: None,
        }),
        "session.error" | "session.next.step.failed" => Some(ActivityUpdate {
            status: AgentActivityStatus::Error,
            phase: AgentActivityPhase::Error,
            detail: error_detail(properties),
        }),
        "message.part.updated" | "message.part.delta" => properties
            .get("part")
            .and_then(activity_from_part)
            .or(Some(ActivityUpdate {
                status: AgentActivityStatus::Busy,
                phase: AgentActivityPhase::Thinking,
                detail: None,
            })),
        "session.next.tool.called"
        | "session.next.tool.input.started"
        | "session.next.tool.input.delta"
        | "session.next.tool.input.ended"
        | "session.next.tool.progress" => Some(tool_activity_from_properties(properties)),
        "session.next.shell.started" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Tool,
            detail: Some("Running shell".to_string()),
        }),
        "session.next.tool.success" | "session.next.shell.ended" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: None,
        }),
        "session.next.tool.failed" => Some(ActivityUpdate {
            status: AgentActivityStatus::Error,
            phase: AgentActivityPhase::Error,
            detail: error_detail(properties),
        }),
        "session.next.retried" => Some(ActivityUpdate {
            status: AgentActivityStatus::Retry,
            phase: AgentActivityPhase::Retry,
            detail: error_detail(properties),
        }),
        "session.next.prompt.admitted"
        | "session.next.prompted"
        | "session.next.step.started"
        | "session.next.step.ended"
        | "session.next.text.started"
        | "session.next.text.delta"
        | "session.next.text.ended"
        | "session.next.reasoning.started"
        | "session.next.reasoning.delta"
        | "session.next.reasoning.ended" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: None,
        }),
        "session.next.compaction.started"
        | "session.next.compaction.delta"
        | "session.compacted" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: Some("Compacting context".to_string()),
        }),
        "session.next.compaction.ended" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: Some("Compacted context".to_string()),
        }),
        _ => None,
    }
}

fn event_session_id(properties: &Value) -> Option<&str> {
    properties
        .get("sessionID")
        .and_then(Value::as_str)
        .or_else(|| properties.get("sessionId").and_then(Value::as_str))
        .or_else(|| {
            properties
                .get("info")
                .and_then(|info| info.get("id"))
                .and_then(Value::as_str)
        })
}

fn activity_from_status(status: &Value) -> Option<ActivityUpdate> {
    match status.get("type").and_then(Value::as_str)? {
        "busy" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: None,
        }),
        "idle" => Some(ActivityUpdate {
            status: AgentActivityStatus::Idle,
            phase: AgentActivityPhase::Idle,
            detail: None,
        }),
        "retry" => Some(ActivityUpdate {
            status: AgentActivityStatus::Retry,
            phase: AgentActivityPhase::Retry,
            detail: status
                .get("message")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        }),
        _ => None,
    }
}

fn activity_from_part(part: &Value) -> Option<ActivityUpdate> {
    match part.get("type").and_then(Value::as_str)? {
        "tool" => Some(tool_activity(part)),
        "subtask" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Tool,
            detail: string_field(part, &["title", "description", "tool"]),
        }),
        "retry" => Some(ActivityUpdate {
            status: AgentActivityStatus::Retry,
            phase: AgentActivityPhase::Retry,
            detail: string_field(part, &["message", "error"]),
        }),
        "reasoning" | "text" | "step-start" | "step-finish" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: None,
        }),
        "compaction" => Some(ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Thinking,
            detail: Some("Compacting context".to_string()),
        }),
        _ => None,
    }
}

fn tool_activity(part: &Value) -> ActivityUpdate {
    let state = part
        .get("state")
        .and_then(|state| state.get("status"))
        .and_then(Value::as_str);
    let detail = string_field(part, &["title", "tool", "name"])
        .or_else(|| {
            part.get("state")
                .and_then(|state| string_field(state, &["title"]))
        })
        .map(|value| format!("Running {value}"));
    match state {
        Some("error") => ActivityUpdate {
            status: AgentActivityStatus::Error,
            phase: AgentActivityPhase::Error,
            detail: string_field(part, &["error"]).or(detail),
        },
        _ => ActivityUpdate {
            status: AgentActivityStatus::Busy,
            phase: AgentActivityPhase::Tool,
            detail,
        },
    }
}

fn tool_activity_from_properties(properties: &Value) -> ActivityUpdate {
    ActivityUpdate {
        status: AgentActivityStatus::Busy,
        phase: AgentActivityPhase::Tool,
        detail: string_field(properties, &["tool", "name"]).map(|value| format!("Running {value}")),
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(key).and_then(Value::as_str))
        .find(|value| !value.trim().is_empty())
        .map(str::to_string)
}

fn error_detail(properties: &Value) -> Option<String> {
    string_field(properties, &["message", "error"]).or_else(|| {
        properties
            .get("error")
            .and_then(|error| string_field(error, &["message", "name"]))
    })
}

async fn session_stopped(events: &mut broadcast::Receiver<SessionEvent>) {
    loop {
        match events.recv().await {
            Ok(SessionEvent::Exit(_) | SessionEvent::Removed(_) | SessionEvent::Terminate) => {
                return;
            }
            Ok(
                SessionEvent::Output(_)
                | SessionEvent::UpstreamSessionChanged { .. }
                | SessionEvent::AgentActivity(_),
            )
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
    use super::{
        activity_from_status, parse_activity_event, parse_created_session_event, sse_event_end,
        valid_upstream_session_id,
    };
    use crate::session::{AgentActivityPhase, AgentActivityStatus};

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

    #[test]
    fn maps_status_events_to_activity() {
        let busy = serde_json::json!({ "type": "busy" });
        let activity = activity_from_status(&busy).unwrap();
        assert_eq!(activity.status, AgentActivityStatus::Busy);
        assert_eq!(activity.phase, AgentActivityPhase::Thinking);

        let retry = serde_json::json!({ "type": "retry", "message": "rate limited" });
        let activity = activity_from_status(&retry).unwrap();
        assert_eq!(activity.status, AgentActivityStatus::Retry);
        assert_eq!(activity.phase, AgentActivityPhase::Retry);
        assert_eq!(activity.detail.as_deref(), Some("rate limited"));
    }

    #[test]
    fn maps_sse_activity_events_for_matching_session() {
        let event = serde_json::json!({
            "directory": "/tmp",
            "payload": {
                "type": "message.part.updated",
                "properties": {
                    "sessionID": "ses_target",
                    "part": { "type": "tool", "tool": "bash", "state": { "status": "running" } }
                }
            }
        });
        let activity = parse_activity_event(&event, "ses_target").unwrap();
        assert_eq!(activity.status, AgentActivityStatus::Busy);
        assert_eq!(activity.phase, AgentActivityPhase::Tool);
        assert_eq!(activity.detail.as_deref(), Some("Running bash"));
        assert!(parse_activity_event(&event, "ses_other").is_none());
    }

    #[test]
    fn maps_next_activity_events_for_matching_session() {
        let tool = serde_json::json!({
            "directory": "/tmp",
            "payload": {
                "type": "session.next.tool.called",
                "properties": {
                    "sessionID": "ses_target",
                    "tool": "bash"
                }
            }
        });
        let activity = parse_activity_event(&tool, "ses_target").unwrap();
        assert_eq!(activity.status, AgentActivityStatus::Busy);
        assert_eq!(activity.phase, AgentActivityPhase::Tool);
        assert_eq!(activity.detail.as_deref(), Some("Running bash"));

        let idle = serde_json::json!({
            "payload": {
                "type": "session.idle",
                "properties": {
                    "sessionID": "ses_target"
                }
            }
        });
        let activity = parse_activity_event(&idle, "ses_target").unwrap();
        assert_eq!(activity.status, AgentActivityStatus::Idle);
        assert_eq!(activity.phase, AgentActivityPhase::Idle);

        let permission = serde_json::json!({
            "payload": {
                "type": "permission.v2.asked",
                "properties": {
                    "sessionID": "ses_target"
                }
            }
        });
        let activity = parse_activity_event(&permission, "ses_target").unwrap();
        assert_eq!(activity.status, AgentActivityStatus::Waiting);
        assert_eq!(activity.phase, AgentActivityPhase::Permission);
        assert!(parse_activity_event(&tool, "ses_other").is_none());
    }
}
