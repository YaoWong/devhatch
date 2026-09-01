import { describe, expect, it } from "vitest";
import type { AgentSession, AgentWorkspace } from "../../types/agents";
import {
  agentWorkspaceKey,
  agentWorkspaceSessions,
  launchedWorkspaceSelection,
  mergeAgentWorkspace,
  mergeAgentWorkspaceMetadata,
  reconcileAgentWorkspaces,
  reconcileAgentWorkspaceSnapshot,
  reconcileLaunchedAgentWorkspaces,
  selectedWorkspaceAfterDisband,
  workspaceOwningSession,
} from "./agentWorkspaceState";

const session = (id: string, agentId: string): AgentSession => ({
  id,
  agentId,
  agentName: agentId === "pi" ? "Pi" : "OpenCode",
  kind: agentId,
  name: id,
  cwd: "/tmp",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
});

const workspace = (members: string[]): AgentWorkspace => ({
  id: "workspace-1",
  name: null,
  activeAgentSessionId: members[0] ?? null,
  members: members.map((agentSessionId) => ({ agentSessionId })),
  createdAt: 1,
  updatedAt: 1,
});

describe("agent workspace state", () => {
  it("reconciles mixed OpenCode and Pi members against all sessions", () => {
    const sessions = [session("open", "opencode"), session("pi", "pi"), session("other", "opencode")];
    expect(agentWorkspaceSessions(workspace(["pi", "missing", "open"]), sessions).map(({ id, agentId }) => [id, agentId])).toEqual([
      ["pi", "pi"],
      ["open", "opencode"],
    ]);
  });

  it("reconciles removed members and replaces a stale active session", () => {
    const first = workspace(["removed", "live"]);
    const second = { ...workspace(["gone"]), id: "workspace-2" };
    expect(reconcileAgentWorkspaces([first, second], new Set(["live"]))).toEqual([
      { ...first, activeAgentSessionId: "live", members: [{ agentSessionId: "live" }] },
      { ...second, activeAgentSessionId: null, members: [] },
    ]);
  });

  it("reconciles an atomic snapshot without mixing session generations", () => {
    const live = session("live", "opencode");
    const authoritative = workspace(["live", "missing"]);
    expect(reconcileAgentWorkspaceSnapshot({
      agentWorkspaces: [authoritative],
      agentSessions: [live],
    })).toEqual({
      sessions: [live],
      workspaces: [{
        ...authoritative,
        members: [{ agentSessionId: "live" }],
      }],
    });
  });

  it("preserves workspace references when all members and active IDs are live", () => {
    const current = [workspace(["open", "pi"])];
    expect(reconcileAgentWorkspaces(current, new Set(["open", "pi"]))).toBe(current);
  });

  it("filters a deleted session from a delayed authoritative workspace", () => {
    const authoritative = workspace(["deleted", "live"]);
    expect(reconcileAgentWorkspaces([authoritative], { has: (id) => id !== "deleted" })).toEqual([{
      ...authoritative,
      activeAgentSessionId: "live",
      members: [{ agentSessionId: "live" }],
    }]);
  });

  it("keeps the canvas key independent from the launcher agent", () => {
    const keys = ["opencode", "pi"].map(() => agentWorkspaceKey("workspace-1"));
    expect(keys).toEqual(["workspace-1", "workspace-1"]);
  });

  it("keeps a user-changed selection when a launch returns", () => {
    expect(launchedWorkspaceSelection("workspace-2", "workspace-1", "workspace-1")).toBe("workspace-2");
    expect(launchedWorkspaceSelection("workspace-1", "workspace-1", "workspace-1")).toBe("workspace-1");
    expect(launchedWorkspaceSelection(null, null, "workspace-1")).toBe("workspace-1");
  });

  it("retains a launched session only when both authoritative snapshots contain it", () => {
    const authoritative = workspace(["live", "new"]);
    expect(reconcileLaunchedAgentWorkspaces([authoritative], new Set(["live", "new"]), "new")).toEqual({
      workspaces: [authoritative],
      retainLaunch: true,
    });
  });

  it("does not resurrect a launch from a stale workspace snapshot", () => {
    const authoritative = workspace(["live", "new"]);
    expect(reconcileLaunchedAgentWorkspaces([authoritative], new Set(["live"]), "new")).toEqual({
      workspaces: [{
        ...authoritative,
        members: [{ agentSessionId: "live" }],
      }],
      retainLaunch: false,
    });
  });

  it("does not resurrect a launch from a stale independent session snapshot", () => {
    const authoritative = workspace(["live"]);
    expect(reconcileLaunchedAgentWorkspaces([authoritative], new Set(["live", "new"]), "new")).toEqual({
      workspaces: [authoritative],
      retainLaunch: false,
    });
  });

  it("finds a session owner across workspaces", () => {
    const owner = { ...workspace(["pi"]), id: "workspace-2" };
    expect(workspaceOwningSession([workspace(["open"]), owner], "pi")).toBe(owner);
    expect(workspaceOwningSession([owner], "missing")).toBeNull();
  });

  it("selects the rehomed active session after disband", () => {
    const removed = workspace(["open", "pi"]);
    const openOwner = { ...workspace(["open"]), id: "workspace-open" };
    const piOwner = { ...workspace(["pi"]), id: "workspace-pi" };
    expect(selectedWorkspaceAfterDisband(removed.id, removed, [piOwner, openOwner])).toBe("workspace-open");
  });

  it("preserves an unaffected selection after disband", () => {
    const removed = workspace(["open"]);
    const selected = { ...workspace(["pi"]), id: "workspace-2" };
    expect(selectedWorkspaceAfterDisband(selected.id, removed, [selected])).toBe(selected.id);
  });

  it("applies delayed workspace metadata without dropping attached members or restoring a deleted workspace", () => {
    const current = { ...workspace(["open", "pi"]), name: "old", updatedAt: 3 };
    const returned = { ...workspace(["open"]), name: "renamed", updatedAt: 2 };
    expect(mergeAgentWorkspaceMetadata([current], returned)).toEqual([{ ...returned, members: current.members }]);
    expect(mergeAgentWorkspaceMetadata([], returned)).toEqual([]);
  });

  it("replaces returned workspace state without dropping other workspaces", () => {
    const previous = workspace(["open"]);
    const returned = { ...previous, members: [{ agentSessionId: "open" }, { agentSessionId: "pi" }], updatedAt: 2 };
    expect(mergeAgentWorkspace([previous, { ...workspace([]), id: "workspace-2" }], returned)).toEqual([
      returned,
      { ...workspace([]), id: "workspace-2" },
    ]);
  });
});
