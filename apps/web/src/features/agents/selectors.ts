import type { AgentSession, HistoryResponse } from "../../types/agents";
import { pathMatches } from "../../shared/lib/utils";

export function agentHistoryPollDelay(active: boolean, historyAgentId: string | null, hasPendingSession: boolean) {
  if (!active || !historyAgentId) return null;
  return hasPendingSession ? 1000 : 10000;
}

export function sameAgentSessions(current: AgentSession[], next: AgentSession[]) {
  return current.length === next.length && current.every((session, index) => {
    const candidate = next[index];
    return candidate !== undefined
      && session.id === candidate.id
      && session.agentId === candidate.agentId
      && session.agentName === candidate.agentName
      && session.kind === candidate.kind
      && session.upstreamSessionId === candidate.upstreamSessionId
      && session.name === candidate.name
      && session.cwd === candidate.cwd
      && session.shell === candidate.shell
      && session.status === candidate.status
      && session.cols === candidate.cols
      && session.rows === candidate.rows
      && session.createdAt === candidate.createdAt
      && session.exitCode === candidate.exitCode;
  });
}

export function shouldShowAgentSessionSearch(sessionCount: number, historyCount: number, search: string) {
  return sessionCount + historyCount > 7 || search.trim().length > 0;
}

export function substituteHistoryTitles(sessions: AgentSession[], history: HistoryResponse) {
  const titles = new Map(history.sessions.map((session) => [session.id, session.title]));
  return sessions.map((session) => ({
    ...session,
    name:
      session.name === session.agentName && session.upstreamSessionId
        ? (titles.get(session.upstreamSessionId) ?? session.name)
        : session.name,
  }));
}

export function mergeAgentSessions(
  sessions: AgentSession[],
  history: HistoryResponse,
  search: string,
  selectedPath: string | null,
  includeSubdirectories: boolean,
  home?: string,
  resolvedHome?: string,
) {
  const normalizedSearch = search.trim().toLowerCase();
  const liveByUpstream = new Map(
    sessions.filter((session) => session.upstreamSessionId).map((session) => [session.upstreamSessionId, session]),
  );
  const historyIds = new Set(history.sessions.map((session) => session.id));
  const rows = history.sessions.map((item) => ({ history: item, live: liveByUpstream.get(item.id) }));
  return [
    ...sessions
      .filter((session) => !session.upstreamSessionId || !historyIds.has(session.upstreamSessionId))
      .map((live) => ({ live, history: undefined })),
    ...rows,
  ]
    .filter(({ live, history: item }) => {
      if (!selectedPath) return true;
      return [live?.cwd, item?.directory].some(
        (directory) =>
          directory && pathMatches(directory, selectedPath, includeSubdirectories, home, resolvedHome),
      );
    })
    .filter(({ live, history: item }) =>
      `${live?.name ?? ""} ${live?.cwd ?? ""} ${item?.title ?? ""} ${item?.directory ?? ""}`
        .toLowerCase()
        .includes(normalizedSearch),
    )
    .slice(0, 30);
}
