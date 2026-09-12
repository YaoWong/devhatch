import type { WorkspaceSession } from "../../types/workspaces";

export type WorkspaceSessionTransport = {
  socketBase: "/api/terminals" | "/api/agent-sessions";
  supportsRuntimeEvents: boolean;
};

export function workspaceSessionTransport(session: WorkspaceSession): WorkspaceSessionTransport {
  return session.kind === "agent"
    ? { socketBase: "/api/agent-sessions", supportsRuntimeEvents: true }
    : { socketBase: "/api/terminals", supportsRuntimeEvents: false };
}
