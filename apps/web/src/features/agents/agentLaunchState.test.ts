import { describe, expect, it } from "vitest";
import type { AgentLaunchPath, AgentSession } from "../../types/agents";
import { findAgentLaunchPath, launcherActiveSession, selectedAgentLaunchPath } from "./agentLaunchState";

const paths: AgentLaunchPath[] = [
  { id: "shared", path: "/repo", alias: null, pinned: false, lastUsedAt: 1, createdAt: 1, updatedAt: 1 },
];

const session = (id: string, agentId: string): AgentSession => ({
  id,
  agentId,
  agentName: agentId,
  kind: agentId,
  name: id,
  cwd: "/repo",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
});

describe("agent launch state", () => {
  it("finds shared paths without an agent selection", () => {
    expect(findAgentLaunchPath(paths, "/repo")).toBe(paths[0]);
    expect(selectedAgentLaunchPath(paths, "shared")).toBe(paths[0]);
  });

  it("keeps path selection independent from launcher agent changes", () => {
    expect(["opencode", "pi"].map(() => selectedAgentLaunchPath(paths, "shared")?.id)).toEqual(["shared", "shared"]);
  });

  it("uses an active or fallback session from the launcher-selected agent", () => {
    const sessions = [session("open", "opencode"), session("pi-1", "pi"), session("pi-2", "pi")];
    expect(launcherActiveSession(sessions, "pi", "open")?.id).toBe("pi-1");
    expect(launcherActiveSession(sessions, "pi", "pi-2")?.id).toBe("pi-2");
    expect(launcherActiveSession(sessions, "codex", "open")).toBeNull();
  });
});
