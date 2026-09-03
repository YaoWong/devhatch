import type { AgentSession, AgentWorkspace, AgentWorkspaceSnapshot } from "../../types/agents";
import {
  launchedWorkspaceSelection,
  reconcileAgentWorkspaceSnapshot,
  reconcileLaunchedAgentWorkspaces,
} from "./agentWorkspaceState";

export interface AgentSessionLaunchResult {
  agentSession: AgentSession;
  agentWorkspace: AgentWorkspace;
}

export async function completeAgentSessionLaunch({
  launch,
  readAuthoritative,
  isLatest,
  onCreated,
  currentWorkspaceId,
  targetWorkspaceId,
  applyCreatedWorkspace,
  applyAuthoritative,
  removeSession,
}: {
  launch: Promise<AgentSessionLaunchResult>;
  readAuthoritative: () => Promise<{ generation: number; value: AgentWorkspaceSnapshot }>;
  isLatest: (generation: number) => boolean;
  onCreated: (session: AgentSession) => void;
  currentWorkspaceId: () => string | null;
  targetWorkspaceId: string | null;
  applyCreatedWorkspace: (workspace: AgentWorkspace, preferred: string | null) => void;
  applyAuthoritative: (sessions: AgentSession[], workspaces: AgentWorkspace[], preferred: string | null) => void;
  removeSession: (id: string) => void;
}): Promise<AgentSessionLaunchResult | null> {
  const result = await launch;
  const preferred = launchedWorkspaceSelection(
    currentWorkspaceId(),
    targetWorkspaceId,
    result.agentWorkspace.id,
  );
  onCreated(result.agentSession);
  applyCreatedWorkspace(result.agentWorkspace, preferred);
  try {
    for (;;) {
      const { generation, value: snapshot } = await readAuthoritative();
      if (!isLatest(generation)) continue;
      const reconciled = reconcileAgentWorkspaceSnapshot(snapshot);
      const { workspaces, retainLaunch } = reconcileLaunchedAgentWorkspaces(
        snapshot.agentWorkspaces,
        new Set(reconciled.sessions.map((session) => session.id)),
        result.agentSession.id,
      );
      const preferred = launchedWorkspaceSelection(
        currentWorkspaceId(),
        targetWorkspaceId,
        result.agentWorkspace.id,
      );
      applyAuthoritative(reconciled.sessions, workspaces, preferred);
      if (retainLaunch) return result;
      removeSession(result.agentSession.id);
      return null;
    }
  } catch {
    return result;
  }
}
