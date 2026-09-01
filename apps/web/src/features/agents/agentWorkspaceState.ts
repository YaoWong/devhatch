import type { AgentSession, AgentWorkspace, AgentWorkspaceSnapshot } from "../../types/agents";

export function agentWorkspaceSessions(workspace: AgentWorkspace | null, sessions: AgentSession[]) {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return (workspace?.members ?? []).flatMap(({ agentSessionId }) => {
    const session = sessionsById.get(agentSessionId);
    return session ? [session] : [];
  });
}

export function reconcileAgentWorkspaces(
  workspaces: AgentWorkspace[],
  liveSessionIds: Pick<ReadonlySet<string>, "has">,
) {
  let changed = false;
  const next = workspaces.map((workspace) => {
    const members = workspace.members.filter((member) => liveSessionIds.has(member.agentSessionId));
    const activeAgentSessionId = workspace.activeAgentSessionId && members.some(
      (member) => member.agentSessionId === workspace.activeAgentSessionId,
    ) ? workspace.activeAgentSessionId : (members[0]?.agentSessionId ?? null);
    if (members.length === workspace.members.length && activeAgentSessionId === workspace.activeAgentSessionId) return workspace;
    changed = true;
    return { ...workspace, members, activeAgentSessionId };
  });
  return changed ? next : workspaces;
}

export function reconcileAgentWorkspaceSnapshot(snapshot: AgentWorkspaceSnapshot) {
  return {
    sessions: snapshot.agentSessions,
    workspaces: reconcileAgentWorkspaces(
      snapshot.agentWorkspaces,
      new Set(snapshot.agentSessions.map((session) => session.id)),
    ),
  };
}

export function agentWorkspaceKey(selectedAgentWorkspaceId: string | null) {
  return selectedAgentWorkspaceId;
}

export function mergeAgentWorkspace(current: AgentWorkspace[], returned: AgentWorkspace) {
  return current.some((workspace) => workspace.id === returned.id)
    ? current.map((workspace) => workspace.id === returned.id ? returned : workspace)
    : [...current, returned];
}

export function mergeAgentWorkspaceMetadata(current: AgentWorkspace[], returned: AgentWorkspace) {
  const existing = current.find((workspace) => workspace.id === returned.id);
  if (!existing) return current;
  return current.map((workspace) => workspace.id === returned.id ? { ...returned, members: existing.members } : workspace);
}

export function launchedWorkspaceSelection(
  currentWorkspaceId: string | null,
  targetWorkspaceId: string | null,
  returnedWorkspaceId: string,
) {
  return targetWorkspaceId === null || currentWorkspaceId === targetWorkspaceId
    ? returnedWorkspaceId
    : currentWorkspaceId;
}

export function workspaceOwningSession(workspaces: AgentWorkspace[], sessionId: string) {
  return workspaces.find((workspace) => workspace.members.some((member) => member.agentSessionId === sessionId)) ?? null;
}

export function selectedWorkspaceAfterDisband(
  selectedWorkspaceId: string | null,
  removed: AgentWorkspace,
  authoritative: AgentWorkspace[],
) {
  if (selectedWorkspaceId !== removed.id && authoritative.some((workspace) => workspace.id === selectedWorkspaceId)) {
    return selectedWorkspaceId;
  }
  const sessionIds = [removed.activeAgentSessionId, ...removed.members.map((member) => member.agentSessionId)];
  for (const sessionId of sessionIds) {
    if (!sessionId) continue;
    const owner = workspaceOwningSession(authoritative, sessionId);
    if (owner) return owner.id;
  }
  return authoritative[0]?.id ?? null;
}

export function reconcileLaunchedAgentWorkspaces(
  authoritative: AgentWorkspace[],
  liveSessionIds: ReadonlySet<string>,
  launchedSessionId: string,
) {
  const retainLaunch = liveSessionIds.has(launchedSessionId) && authoritative.some((workspace) =>
    workspace.members.some((member) => member.agentSessionId === launchedSessionId),
  );
  return {
    workspaces: reconcileAgentWorkspaces(authoritative, liveSessionIds),
    retainLaunch,
  };
}
