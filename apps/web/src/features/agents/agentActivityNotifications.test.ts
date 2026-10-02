import { describe, expect, it } from "vitest";
import type { AgentActivity, AgentSession } from "../../types/agents";
import { agentActivityNotification, agentNotificationState, isNewerAgentActivity, sameAgentNotificationActivity } from "./agentActivityNotifications";

const session: AgentSession = {
  id: "agent-1",
  agentId: "opencode",
  agentName: "OpenCode",
  kind: "agent",
  name: "Build",
  cwd: "/repo",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
};

const activity = (status: AgentActivity["status"], updatedAt: number, detail?: string): AgentActivity => ({
  status,
  phase: status === "waiting" ? "question" : status === "retry" ? "retry" : status === "error" ? "error" : status === "idle" ? "idle" : "thinking",
  detail,
  updatedAt,
});

describe("agent activity notifications", () => {
  it("rejects duplicate and older activity timestamps", () => {
    expect(isNewerAgentActivity(undefined, 10)).toBe(true);
    expect(isNewerAgentActivity(10, 11)).toBe(true);
    expect(isNewerAgentActivity(10, 10)).toBe(false);
    expect(isNewerAgentActivity(10, 9)).toBe(false);
  });

  it("preserves busy history and only reports completion after work", () => {
    const initial = { lastStatus: null, lastPhase: null, lastDetail: null, hasBeenBusy: false };
    const busy = agentNotificationState(activity("busy", 1), initial);
    expect(agentActivityNotification(session, activity("idle", 2), busy)).toEqual({
      title: "OpenCode · Build finished",
      body: "Agent is idle",
    });
    expect(agentActivityNotification(session, activity("idle", 2), initial)).toBeNull();
  });

  it("reports same-status changes when phase or detail changes", () => {
    const waiting = activity("waiting", 2, "Permission");
    const state = agentNotificationState(waiting);
    expect(sameAgentNotificationActivity(state, waiting)).toBe(true);
    expect(sameAgentNotificationActivity(state, activity("waiting", 3, "Question"))).toBe(false);
    expect(sameAgentNotificationActivity(state, { ...activity("waiting", 3, "Permission"), phase: "permission" })).toBe(false);
  });

  it("reports waiting, retry, and error transitions with details", () => {
    const initial = { lastStatus: "busy" as const, lastPhase: "thinking" as const, lastDetail: null, hasBeenBusy: true };
    expect(agentActivityNotification(session, activity("waiting", 2, "Answer this"), initial)).toEqual({
      title: "OpenCode · Build needs input",
      body: "Answer this",
    });
    expect(agentActivityNotification(session, activity("retry", 3), initial)?.title).toBe("OpenCode · Build is retrying");
    expect(agentActivityNotification(session, activity("error", 4), initial)?.title).toBe("OpenCode · Build hit an error");
  });
});
