import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../types/agents";
import type { TerminalInfo } from "../../types/terminals";
import type { Workspace } from "../../types/workspaces";
import { launchPathSelection, mergeCreatedWorkspace, removeWorkspaceSession, workspaceSessions } from "./useWorkspaceController";

const base = {
  name: "session",
  cwd: "/repo",
  shell: "sh",
  status: "running" as const,
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
};
const terminal: TerminalInfo = { ...base, id: "same", kind: "terminal" };
const agent: AgentSession = { ...base, id: "same", kind: "agent", agentId: "opencode", agentName: "OpenCode" };
const workspace: Workspace = {
  id: "mixed",
  name: null,
  activeSession: { sessionId: "same", kind: "terminal" },
  members: [
    { sessionId: "same", kind: "agent" },
    { sessionId: "same", kind: "terminal" },
  ],
  createdAt: 1,
  updatedAt: 1,
};

describe("unified workspace state", () => {
  it("preserves a launch path selected while a refresh is pending", () => {
    const paths = [
      { id: "a", path: "/a", alias: null, pinned: false, lastUsedAt: 2, createdAt: 1, updatedAt: 2 },
      { id: "b", path: "/b", alias: null, pinned: false, lastUsedAt: 1, createdAt: 1, updatedAt: 1 },
    ];
    expect(launchPathSelection(paths, "b")).toBe("b");
    expect(launchPathSelection(paths, "b", "a")).toBe("a");
  });

  it("resolves mixed members in backend order", () => {
    expect(workspaceSessions(workspace, [terminal, agent])).toEqual([agent, terminal]);
  });

  it("falls back to the next mixed member after removal", () => {
    expect(removeWorkspaceSession([workspace], { sessionId: "same", kind: "terminal" })[0]).toMatchObject({
      activeSession: { sessionId: "same", kind: "agent" },
      members: [{ sessionId: "same", kind: "agent" }],
    });
  });

  it("merges a session from a stale create response without replacing newer workspace state", () => {
    const newer = {
      ...workspace,
      name: "Renamed",
      activeSession: { sessionId: "same", kind: "agent" as const },
      members: [{ sessionId: "same", kind: "agent" as const }],
      updatedAt: 3,
    };
    const stale = {
      ...workspace,
      name: null,
      activeSession: { sessionId: "new", kind: "terminal" as const },
      members: [{ sessionId: "same", kind: "agent" as const }, { sessionId: "new", kind: "terminal" as const }],
      updatedAt: 2,
    };

    expect(mergeCreatedWorkspace(
      [newer],
      stale,
      { sessionId: "new", kind: "terminal" },
      true,
    )).toEqual([{ ...newer, members: [...newer.members, { sessionId: "new", kind: "terminal" }] }]);
  });

  it("uses the authoritative create response when it is still current", () => {
    const returned = { ...workspace, name: "Created", updatedAt: 2 };
    expect(mergeCreatedWorkspace(
      [workspace],
      returned,
      { sessionId: "same", kind: "agent" },
      false,
    )).toEqual([returned]);
  });

  it("removes only the live agent member and leaves history outside workspace state", () => {
    const result = removeWorkspaceSession([workspace], { sessionId: "same", kind: "agent" });
    expect(result[0].members).toEqual([{ sessionId: "same", kind: "terminal" }]);
    expect(result[0]).not.toHaveProperty("history");
  });
});
