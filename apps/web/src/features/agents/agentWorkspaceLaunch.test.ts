import { describe, expect, it, vi } from "vitest";
import type { AgentSession, AgentWorkspaceSnapshot } from "../../types/agents";
import { completeAgentSessionLaunch } from "./agentWorkspaceLaunch";

const session: AgentSession = {
  id: "session-1",
  agentId: "opencode",
  agentName: "OpenCode",
  kind: "opencode",
  name: "session-1",
  cwd: "/tmp",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
};
const workspace = {
  id: "workspace-1",
  name: null,
  activeAgentSessionId: session.id,
  members: [{ agentSessionId: session.id }],
  createdAt: 1,
  updatedAt: 1,
};
const result = { agentSession: session, agentWorkspace: workspace };
const snapshot: AgentWorkspaceSnapshot = { agentSessions: [session], agentWorkspaces: [workspace] };

function dependencies(authoritative = snapshot) {
  const events: string[] = [];
  const removeSession = vi.fn(() => events.push("rollback"));
  return {
    events,
    removeSession,
    options: {
      launch: Promise.resolve(result),
      readAuthoritative: vi.fn(async () => {
        events.push("refresh");
        return { generation: 1, value: authoritative };
      }),
      isLatest: () => true,
      onCreated: () => events.push("created"),
      currentWorkspaceId: () => workspace.id,
      targetWorkspaceId: workspace.id,
      applyCreatedWorkspace: () => events.push("workspace"),
      applyAuthoritative: () => events.push("apply"),
      removeSession,
    },
  };
}

describe("agent workspace launch", () => {
  it("publishes the session before requesting the authoritative snapshot", async () => {
    const { events, removeSession, options } = dependencies();
    await expect(completeAgentSessionLaunch(options)).resolves.toBe(result);
    expect(events).toEqual(["created", "workspace", "refresh", "apply"]);
    expect(removeSession).not.toHaveBeenCalled();
  });

  it("keeps the created session when the authoritative refresh fails", async () => {
    const failure = new Error("refresh failed");
    const { events, removeSession, options } = dependencies();
    options.readAuthoritative.mockRejectedValue(failure);
    await expect(completeAgentSessionLaunch(options)).resolves.toBe(result);
    expect(events).toEqual(["created", "workspace"]);
    expect(removeSession).not.toHaveBeenCalled();
  });

  it("rolls back when the authoritative snapshot does not retain the launch", async () => {
    const { events, removeSession, options } = dependencies({ agentSessions: [], agentWorkspaces: [workspace] });
    await expect(completeAgentSessionLaunch(options)).resolves.toBeNull();
    expect(events).toEqual(["created", "workspace", "refresh", "apply", "rollback"]);
    expect(removeSession).toHaveBeenCalledWith(session.id);
  });
});
