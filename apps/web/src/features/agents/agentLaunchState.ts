import type { AgentLaunchPath, AgentSession } from "../../types/agents";

export function findAgentLaunchPath(paths: AgentLaunchPath[], path: string) {
  return paths.find((entry) => entry.path === path) ?? null;
}

export function selectedAgentLaunchPath(paths: AgentLaunchPath[], selectedPathId: string | null) {
  return paths.find((path) => path.id === selectedPathId) ?? null;
}

export function launcherActiveSession(
  sessions: AgentSession[],
  selectedAgentId: string | null,
  preferredSessionId: string | null,
) {
  const selectedAgentSessions = sessions.filter((session) => session.agentId === selectedAgentId);
  return selectedAgentSessions.find((session) => session.id === preferredSessionId) ?? selectedAgentSessions[0] ?? null;
}
