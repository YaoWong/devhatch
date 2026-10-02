use std::sync::Arc;

use axum::{
    extract::{
        Extension, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

use crate::{
    auth::{AuthIdentity, validate_identity},
    session::AgentActivityEvent,
    state::AppState,
};

const MAX_WEBSOCKET_SIZE: usize = 128 * 1024;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMessage {
    Ping,
}

pub(crate) async fn socket(
    State(state): State<Arc<AppState>>,
    Extension(identity): Extension<AuthIdentity>,
    upgrade: WebSocketUpgrade,
) -> Response {
    upgrade
        .max_frame_size(MAX_WEBSOCKET_SIZE)
        .max_message_size(MAX_WEBSOCKET_SIZE)
        .on_upgrade(move |socket| handle_socket(socket, state, identity))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>, identity: AuthIdentity) {
    let lifecycle = state.auth().session_lifecycle().read().await;
    if !identity_valid(&state, &identity).await || identity.is_expired() {
        drop(lifecycle);
        close_unauthorized_socket(&mut socket).await;
        return;
    }
    let identity_lease = state.auth().session_lease(&identity);
    if !identity_lease.is_valid() {
        drop(lifecycle);
        close_unauthorized_socket(&mut socket).await;
        return;
    }
    let registry = state.session_registry();
    let mut events = registry.subscribe_agent_activity();
    let (snapshot_sequence, snapshot) = registry.agent_activity_snapshot();
    let (mut sender, mut receiver) = socket.split();
    if send_json(&mut sender, snapshot_message(snapshot))
        .await
        .is_err()
    {
        return;
    }
    drop(lifecycle);
    let expiration = tokio::time::sleep(identity.expiration_delay());
    tokio::pin!(expiration);
    loop {
        tokio::select! {
            _ = identity_lease.revoked() => {
                close_unauthorized(&mut sender).await;
                break;
            }
            _ = &mut expiration => {
                identity_lease.revoke();
                close_unauthorized(&mut sender).await;
                break;
            }
            message = receiver.next() => {
                let Some(Ok(message)) = message else { break };
                let lifecycle = state.auth().session_lifecycle().read().await;
                let valid = identity_lease.is_valid()
                    && !identity.is_expired()
                    && identity_valid(&state, &identity).await
                    && identity_lease.is_valid();
                if !valid {
                    identity_lease.revoke();
                    drop(lifecycle);
                    close_unauthorized(&mut sender).await;
                    break;
                }
                if !handle_client_message(&mut sender, message).await {
                    break;
                }
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if event.sequence <= snapshot_sequence {
                            continue;
                        }
                        let lifecycle = state.auth().session_lifecycle().read().await;
                        let valid = identity_lease.is_valid()
                            && !identity.is_expired()
                            && identity_valid(&state, &identity).await
                            && identity_lease.is_valid();
                        if !valid {
                            identity_lease.revoke();
                            drop(lifecycle);
                            close_unauthorized(&mut sender).await;
                            break;
                        }
                        if send_json(&mut sender, activity_message(event)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1011,
                            reason: "agent activity resync required".into(),
                        }))).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

fn snapshot_message(activities: Vec<AgentActivityEvent>) -> serde_json::Value {
    serde_json::json!({ "type": "snapshot", "activities": activities })
}

fn activity_message(event: AgentActivityEvent) -> serde_json::Value {
    serde_json::json!({
        "type": "agentActivity",
        "sessionId": event.session_id,
        "activity": event.activity,
        "updatedAt": event.updated_at,
    })
}

async fn identity_valid(state: &AppState, identity: &AuthIdentity) -> bool {
    validate_identity(state.pool(), identity)
        .await
        .unwrap_or(false)
}

async fn close_unauthorized_socket(socket: &mut WebSocket) {
    let _ = socket
        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code: 1008,
            reason: "authentication expired".into(),
        })))
        .await;
}

async fn close_unauthorized(sender: &mut futures_util::stream::SplitSink<WebSocket, Message>) {
    let _ = sender
        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
            code: 1008,
            reason: "authentication expired".into(),
        })))
        .await;
}

async fn handle_client_message(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    message: Message,
) -> bool {
    let Message::Text(text) = message else {
        return !matches!(message, Message::Close(_));
    };
    let Ok(message) = serde_json::from_str::<ClientMessage>(&text) else {
        return true;
    };
    match message {
        ClientMessage::Ping => send_json(sender, serde_json::json!({ "type": "pong" }))
            .await
            .is_ok(),
    }
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    value: serde_json::Value,
) -> Result<(), axum::Error> {
    sender.send(Message::Text(value.to_string().into())).await
}

#[cfg(test)]
mod tests {
    use super::{activity_message, snapshot_message};
    use crate::session::{
        AgentActivity, AgentActivityEvent, AgentActivityPhase, AgentActivityStatus,
    };

    fn event() -> AgentActivityEvent {
        AgentActivityEvent {
            sequence: 1,
            session_id: "session-1".to_string(),
            activity: Some(AgentActivity {
                status: AgentActivityStatus::Waiting,
                phase: AgentActivityPhase::Question,
                detail: Some("Choose an option".to_string()),
                updated_at: 42,
            }),
            updated_at: 42,
        }
    }

    #[test]
    fn serializes_snapshot_and_activity_messages() {
        assert_eq!(
            snapshot_message(vec![event()]),
            serde_json::json!({
                "type": "snapshot",
                "activities": [{
                    "sessionId": "session-1",
                    "activity": {
                        "status": "waiting",
                        "phase": "question",
                        "detail": "Choose an option",
                        "updatedAt": 42,
                    },
                    "updatedAt": 42,
                }],
            })
        );
        assert_eq!(
            activity_message(AgentActivityEvent {
                sequence: 2,
                session_id: "session-1".to_string(),
                activity: None,
                updated_at: 43,
            }),
            serde_json::json!({
                "type": "agentActivity",
                "sessionId": "session-1",
                "activity": null,
                "updatedAt": 43,
            })
        );
    }
}
