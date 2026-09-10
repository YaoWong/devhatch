import type { AgentSession } from "../../types/agents";
import type { LaunchPath } from "../../types/workspaces";

export function selectedAgentLaunchOptions(path: LaunchPath | null) {
  return path ? { cwd: path.path } : null;
}

export function launcherActiveSession(
  sessions: AgentSession[],
  selectedAgentId: string | null,
  preferredSessionId: string | null,
) {
  const selectedAgentSessions = sessions.filter((session) => session.agentId === selectedAgentId);
  return selectedAgentSessions.find((session) => session.id === preferredSessionId) ?? selectedAgentSessions[0] ?? null;
}
