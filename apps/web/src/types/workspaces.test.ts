import { describe, expect, it } from "vitest";
import type { AgentSession } from "./agents";
import type { TerminalInfo } from "./terminals";
import { sessionKey, sessionRef } from "./workspaces";

const terminal: TerminalInfo = {
  id: "same",
  kind: "terminal",
  name: "shell",
  cwd: "/repo",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
};

const agent: AgentSession = {
  ...terminal,
  kind: "agent",
  agentId: "opencode",
  agentName: "OpenCode",
};

describe("workspace session identity", () => {
  it("keeps equal raw ids distinct across kinds", () => {
    expect(sessionKey(terminal)).toBe("terminal:same");
    expect(sessionKey(agent)).toBe("agent:same");
    expect(new Set([sessionKey(terminal), sessionKey(agent)])).toHaveLength(2);
  });

  it("converts sessions to API refs without composite ids", () => {
    expect(sessionRef(agent)).toEqual({ sessionId: "same", kind: "agent" });
  });
});
