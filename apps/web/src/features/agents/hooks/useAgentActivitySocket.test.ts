import { describe, expect, it } from "vitest";
import { activitySocketCloseCode, parseAgentActivityMessage } from "./useAgentActivitySocket";

describe("agent activity socket messages", () => {
  it("treats clean server closes as reconnectable", () => {
    expect(activitySocketCloseCode(1000)).toBe(1006);
    expect(activitySocketCloseCode(1008)).toBe(1008);
    expect(activitySocketCloseCode(1011)).toBe(1011);
  });

  it("parses snapshots and nullable updates", () => {
    expect(parseAgentActivityMessage({
      type: "snapshot",
      activities: [{
        sessionId: "agent-1",
        activity: { status: "waiting", phase: "question", detail: "Choose", updatedAt: 10 },
        updatedAt: 10,
      }],
    })).toEqual({
      type: "snapshot",
      activities: [{
        sessionId: "agent-1",
        activity: { status: "waiting", phase: "question", detail: "Choose", updatedAt: 10 },
        updatedAt: 10,
      }],
    });
    expect(parseAgentActivityMessage({
      type: "agentActivity",
      sessionId: "agent-1",
      activity: null,
      updatedAt: 11,
    })).toEqual({
      type: "agentActivity",
      sessionId: "agent-1",
      activity: null,
      updatedAt: 11,
    });
  });

  it("rejects malformed and timestamp-mismatched messages", () => {
    expect(parseAgentActivityMessage({ type: "snapshot", activities: [{ sessionId: "agent-1" }] })).toBeNull();
    expect(parseAgentActivityMessage({
      type: "agentActivity",
      sessionId: "agent-1",
      activity: { status: "busy", phase: "thinking", updatedAt: 9 },
      updatedAt: 10,
    })).toBeNull();
    expect(parseAgentActivityMessage({
      type: "agentActivity",
      sessionId: "agent-1",
      activity: { status: "unknown", phase: "thinking", updatedAt: 10 },
      updatedAt: 10,
    })).toBeNull();
    expect(parseAgentActivityMessage({
      type: "agentActivity",
      sessionId: "",
      activity: null,
      updatedAt: -1,
    })).toBeNull();
  });
});
