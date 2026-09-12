import type { AgentSession } from "../../types/agents";

export function launcherActiveSession(
  sessions: AgentSession[],
  selectedAgentId: string | null,
  preferredSessionId: string | null,
) {
  const selectedAgentSessions = sessions.filter((session) => session.agentId === selectedAgentId);
  return selectedAgentSessions.find((session) => session.id === preferredSessionId) ?? selectedAgentSessions[0] ?? null;
}
