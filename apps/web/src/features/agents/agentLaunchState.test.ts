import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../types/agents";
import { selectedLaunchPath, type LaunchPath } from "../../types/workspaces";
import { launcherActiveSession } from "./agentLaunchState";

const paths: LaunchPath[] = [
  { id: "shared", path: "/repo", alias: null, pinned: false, lastUsedAt: 1, createdAt: 1, updatedAt: 1 },
];

const session = (id: string, agentId: string): AgentSession => ({
  id,
  agentId,
  agentName: agentId,
  kind: "agent",
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
  it("uses the shared selected launch path independently of the selected agent", () => {
    expect(["opencode", "pi"].map(() => selectedLaunchPath(paths, "shared")?.id)).toEqual(["shared", "shared"]);
    expect(selectedLaunchPath(paths, null)).toBeNull();
  });

  it("uses an active or fallback session from the launcher-selected agent", () => {
    const sessions = [session("open", "opencode"), session("pi-1", "pi"), session("pi-2", "pi")];
    expect(launcherActiveSession(sessions, "pi", "open")?.id).toBe("pi-1");
    expect(launcherActiveSession(sessions, "pi", "pi-2")?.id).toBe("pi-2");
    expect(launcherActiveSession(sessions, "codex", "open")).toBeNull();
  });
});
