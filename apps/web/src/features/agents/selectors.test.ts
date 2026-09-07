import { describe, expect, it } from "vitest";
import type { AgentSession } from "../../types/agents";
import { agentHistoryPollDelay, sameAgentSessions, shouldShowAgentSessionSearch } from "./selectors";

const session = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: "session-1",
  agentId: "opencode",
  agentName: "OpenCode",
  kind: "opencode",
  name: "Session",
  cwd: "/tmp",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
  ...overrides,
});

describe("agent session selectors", () => {
  it("shows search for large session collections", () => {
    expect(shouldShowAgentSessionSearch(5, 3, "")).toBe(true);
  });

  it("keeps an active search visible below the collection threshold", () => {
    expect(shouldShowAgentSessionSearch(2, 1, "  query  ")).toBe(true);
  });

  it("chooses history polling from semantic session state", () => {
    expect(agentHistoryPollDelay(false, "opencode", true)).toBeNull();
    expect(agentHistoryPollDelay(true, null, true)).toBeNull();
    expect(agentHistoryPollDelay(true, "opencode", false)).toBe(10000);
    expect(agentHistoryPollDelay(true, "opencode", true)).toBe(1000);
  });

  it("preserves equivalent session snapshots despite output timestamps", () => {
    const current = [session()];
    expect(sameAgentSessions(current, [{ ...current[0], updatedAt: 2 }])).toBe(true);
    expect(sameAgentSessions(current, [{ ...current[0], upstreamSessionId: "upstream" }])).toBe(false);
    expect(sameAgentSessions(current, [session({ id: "session-2" })])).toBe(false);
  });

  it("hides an empty search for small session collections", () => {
    expect(shouldShowAgentSessionSearch(3, 4, "   ")).toBe(false);
  });
});
