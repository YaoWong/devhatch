import type { AgentActivity, AgentSession } from "../../types/agents";

export type AgentNotificationState = {
  lastStatus: AgentActivity["status"] | null;
  lastPhase: AgentActivity["phase"] | null;
  lastDetail: string | null;
  hasBeenBusy: boolean;
};

export function agentNotificationState(activity: AgentActivity, previous?: AgentNotificationState): AgentNotificationState {
  return {
    lastStatus: activity.status,
    lastPhase: activity.phase,
    lastDetail: activity.detail ?? null,
    hasBeenBusy: Boolean(previous?.hasBeenBusy) || activity.status === "busy" || activity.status === "retry" || activity.status === "waiting",
  };
}

export function sameAgentNotificationActivity(state: AgentNotificationState, activity: AgentActivity) {
  return state.lastStatus === activity.status
    && state.lastPhase === activity.phase
    && state.lastDetail === (activity.detail ?? null);
}

export function agentActivityNotification(session: AgentSession | undefined, activity: AgentActivity, state: AgentNotificationState) {
  const name = session ? `${session.agentName} · ${session.name}` : "Agent";
  if (activity.status === "waiting") return { title: `${name} needs input`, body: activity.detail ?? "Waiting for you" };
  if (activity.status === "retry") return { title: `${name} is retrying`, body: activity.detail ?? "Retrying request" };
  if (activity.status === "error") return { title: `${name} hit an error`, body: activity.detail ?? "Check DevHatch" };
  if (activity.status === "idle" && state.hasBeenBusy && state.lastStatus !== "idle") return { title: `${name} finished`, body: "Agent is idle" };
  return null;
}

export function isNewerAgentActivity(currentUpdatedAt: number | undefined, updatedAt: number) {
  return currentUpdatedAt === undefined || updatedAt > currentUpdatedAt;
}
