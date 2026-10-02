import { useEffect, useRef } from "react";
import { verifyAuth } from "../../../api/auth";
import { notifyUnauthorized } from "../../../api/client";
import type { AgentActivity } from "../../../types/agents";
import { SocketConnection } from "../../../shared/terminal/socketConnection";

export type AgentActivityEvent = {
  sessionId: string;
  activity: AgentActivity | null;
  updatedAt: number;
};

type AgentActivityMessage =
  | { type: "snapshot"; activities: AgentActivityEvent[] }
  | ({ type: "agentActivity" } & AgentActivityEvent);

const statuses = new Set(["idle", "busy", "retry", "waiting", "error"]);
const phases = new Set(["idle", "thinking", "tool", "permission", "question", "retry", "error"]);

function activityEvent(value: unknown): AgentActivityEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AgentActivityEvent>;
  if (
    typeof candidate.sessionId !== "string" || candidate.sessionId.length === 0
    || typeof candidate.updatedAt !== "number" || !Number.isSafeInteger(candidate.updatedAt) || candidate.updatedAt < 0
  ) return null;
  if (candidate.activity === null) return { sessionId: candidate.sessionId, activity: null, updatedAt: candidate.updatedAt };
  if (!candidate.activity || typeof candidate.activity !== "object") return null;
  const activity = candidate.activity as Partial<AgentActivity>;
  if (
    typeof activity.status !== "string" || !statuses.has(activity.status)
    || typeof activity.phase !== "string" || !phases.has(activity.phase)
    || typeof activity.updatedAt !== "number" || activity.updatedAt !== candidate.updatedAt
    || (activity.detail !== undefined && activity.detail !== null && typeof activity.detail !== "string")
  ) return null;
  return { sessionId: candidate.sessionId, activity: activity as AgentActivity, updatedAt: candidate.updatedAt };
}

export function parseAgentActivityMessage(value: unknown): AgentActivityMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; activities?: unknown };
  if (candidate.type === "snapshot" && Array.isArray(candidate.activities)) {
    const activities = candidate.activities.map(activityEvent);
    if (activities.some((event) => event === null)) return null;
    return { type: "snapshot", activities: activities as AgentActivityEvent[] };
  }
  if (candidate.type === "agentActivity") {
    const event = activityEvent(value);
    return event ? { type: "agentActivity", ...event } : null;
  }
  return null;
}

export function activitySocketCloseCode(code: number) {
  return code === 1000 ? 1006 : code;
}

export function useAgentActivitySocket({
  onSnapshot,
  onActivity,
}: {
  onSnapshot: (events: AgentActivityEvent[]) => void;
  onActivity: (event: AgentActivityEvent) => void;
}) {
  const onSnapshotRef = useRef(onSnapshot);
  const onActivityRef = useRef(onActivity);
  onSnapshotRef.current = onSnapshot;
  onActivityRef.current = onActivity;

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let snapshotTimer: number | null = null;
    let protocolReady = false;
    const connection = new SocketConnection(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle as number),
      verifyAuth,
      notifyUnauthorized,
    );
    const connect = () => {
      if (disposed) return;
      const started = connection.begin();
      if (!started) return;
      const { generation } = started;
      protocolReady = false;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const nextSocket = new WebSocket(`${protocol}//${window.location.host}/api/agents/activity`);
      socket = nextSocket;
      snapshotTimer = window.setTimeout(() => {
        if (!protocolReady && socket === nextSocket && connection.isCurrent(generation)) {
          nextSocket.close(1011, "activity snapshot timeout");
        }
      }, 10000);
      nextSocket.addEventListener("message", (messageEvent) => {
        if (disposed || socket !== nextSocket || !connection.isCurrent(generation)) return;
        let parsed: AgentActivityMessage | null = null;
        try {
          parsed = parseAgentActivityMessage(JSON.parse(String(messageEvent.data)));
        } catch {
          if (!protocolReady) nextSocket.close(1011, "invalid activity snapshot");
          return;
        }
        if (!parsed) {
          if (!protocolReady) nextSocket.close(1011, "invalid activity snapshot");
          return;
        }
        if (parsed.type === "snapshot") {
          if (!connection.snapshot(generation)) return;
          if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
          snapshotTimer = null;
          protocolReady = true;
          onSnapshotRef.current(parsed.activities);
          return;
        }
        if (protocolReady) onActivityRef.current(parsed);
      });
      nextSocket.addEventListener("close", (event) => {
        if (disposed || socket !== nextSocket) return;
        protocolReady = false;
        if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
        snapshotTimer = null;
        socket = null;
        connection.close(generation, activitySocketCloseCode(event.code), connect);
      });
    };
    connect();
    return () => {
      disposed = true;
      connection.stop();
      if (snapshotTimer !== null) window.clearTimeout(snapshotTimer);
      snapshotTimer = null;
      const activeSocket = socket;
      socket = null;
      activeSocket?.close(1000, "activity listener closed");
    };
  }, []);
}
