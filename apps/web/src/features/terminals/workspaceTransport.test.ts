import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../types/agents";
import type { TerminalInfo } from "../../types/terminals";
import { workspaceSessionTransport } from "./workspaceTransport";

const common = {
  id: "raw/id",
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

describe("workspace pane transports", () => {
  it("resolves each kind independently", () => {
    const terminal: TerminalInfo = { ...common, kind: "terminal" };
    const agent: AgentSession = { ...common, kind: "agent", agentId: "opencode", agentName: "OpenCode" };
    expect(workspaceSessionTransport(terminal)).toEqual({ socketBase: "/api/terminals", supportsRuntimeEvents: false });
    expect(workspaceSessionTransport(agent)).toEqual({ socketBase: "/api/agent-sessions", supportsRuntimeEvents: true });
  });
});
