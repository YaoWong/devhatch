import type { AgentSession } from "./agents";
import type { TerminalInfo } from "./terminals";

export type SessionKind = "terminal" | "agent";

export type WorkspaceSessionRef = {
  sessionId: string;
  kind: SessionKind;
};

export type Workspace = {
  id: string;
  name: string | null;
  activeSession: WorkspaceSessionRef | null;
  members: WorkspaceSessionRef[];
  createdAt: number;
  updatedAt: number;
};

export type LaunchPath = {
  id: string;
  path: string;
  alias: string | null;
  pinned: boolean;
  lastUsedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceSession = TerminalInfo | AgentSession;

export type WorkspaceSnapshot = {
  workspaces: Workspace[];
  sessions: WorkspaceSession[];
  home: string;
  resolvedHome: string;
};

export function selectedLaunchPath(paths: LaunchPath[], selectedPathId: string | null) {
  return paths.find((path) => path.id === selectedPathId) ?? null;
}

export function sessionKey(value: WorkspaceSessionRef | WorkspaceSession) {
  const id = "sessionId" in value ? value.sessionId : value.id;
  return `${value.kind}:${id}`;
}

export function sessionRef(session: WorkspaceSession): WorkspaceSessionRef {
  return { sessionId: session.id, kind: session.kind };
}

export function sameSessionRef(left: WorkspaceSessionRef | null, right: WorkspaceSessionRef | null) {
  return left === right || Boolean(left && right && left.kind === right.kind && left.sessionId === right.sessionId);
}

export function isAgentSession(session: WorkspaceSession): session is AgentSession {
  return session.kind === "agent";
}
