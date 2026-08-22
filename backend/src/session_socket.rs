use std::sync::Arc;

use axum::{
    extract::{
        WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

use crate::{
    session::{Session, SessionEvent, SessionKind, SessionStatus, dimension},
    state::AppState,
};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMessage {
    Input {
        data: serde_json::Value,
    },
    Resize {
        cols: serde_json::Value,
        rows: serde_json::Value,
    },
    Ping,
}

pub(crate) fn upgrade(
    state: Arc<AppState>,
    id: String,
    _headers: HeaderMap,
    upgrade: WebSocketUpgrade,
    kind: SessionKind,
) -> Response {
    let Some(session) = state.session(&id, kind) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let socket_state = state.clone();
    upgrade.on_upgrade(move |socket| handle_socket(socket, session, socket_state))
}

async fn handle_socket(mut socket: WebSocket, session: Arc<Session>, app_state: Arc<AppState>) {
    if !app_state.contains_session(&session) || session.is_deleting() {
        let _ = socket
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: 1000,
                reason: "session terminated".into(),
            })))
            .await;
        return;
    }
    let (mut sender, mut receiver) = socket.split();
    let (snapshot, mut events) = session.snapshot_and_subscribe();
    if send_json(
        &mut sender,
        serde_json::json!({ "type": "ready", "terminal": snapshot.view }),
    )
    .await
    .is_err()
    {
        return;
    }
    if send_json(
        &mut sender,
        serde_json::json!({ "type": "snapshot", "data": snapshot.output }),
    )
    .await
    .is_err()
    {
        return;
    }
    if snapshot.status == SessionStatus::Exited
        && send_json(
            &mut sender,
            serde_json::json!({ "type": "exit", "code": snapshot.exit_code }),
        )
        .await
        .is_err()
    {
        return;
    }
    loop {
        tokio::select! {
            message = receiver.next() => {
                let Some(Ok(message)) = message else { break };
                if !handle_client_message(&session, &mut sender, message).await { break; }
            }
            event = events.recv() => {
                match event {
                    Ok(SessionEvent::Output(data)) => {
                        if send_json(&mut sender, serde_json::json!({ "type": "output", "data": data })).await.is_err() { break; }
                    }
                    Ok(SessionEvent::UpstreamSessionChanged(id)) => {
                        if send_json(&mut sender, serde_json::json!({ "type": "upstreamSessionChanged", "upstreamSessionId": id })).await.is_err() { break; }
                    }
                    Ok(SessionEvent::Exit(code)) => {
                        if send_json(&mut sender, serde_json::json!({ "type": "exit", "code": code })).await.is_err() { break; }
                    }
                    Ok(SessionEvent::Removed(code)) => {
                        let _ = send_json(&mut sender, serde_json::json!({ "type": "removed", "reason": "processExited", "code": code })).await;
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame { code: 1000, reason: "process exited".into() }))).await;
                        break;
                    }
                    Ok(SessionEvent::Terminate) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1000,
                            reason: "session terminated".into(),
                        }))).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let _ = sender.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 1011,
                            reason: "terminal output resync required".into(),
                        }))).await;
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

async fn handle_client_message(
    session: &Session,
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
        ClientMessage::Input { data } => {
            if let Some(data) = data.as_str().filter(|data| data.len() <= 64 * 1024) {
                session.write_input(data);
            }
        }
        ClientMessage::Resize { cols, rows } => {
            let (current_cols, current_rows) = session.dimensions();
            session.resize(
                dimension(Some(&cols), current_cols),
                dimension(Some(&rows), current_rows),
            );
        }
        ClientMessage::Ping => {
            return send_json(sender, serde_json::json!({ "type": "pong" }))
                .await
                .is_ok();
        }
    }
    true
}

async fn send_json(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    value: serde_json::Value,
) -> Result<(), axum::Error> {
    sender.send(Message::Text(value.to_string().into())).await
}
