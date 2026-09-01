import { useCallback, useEffect, useRef, useState } from "react";
import { deleteAgentHistorySession, history as getHistory } from "../../../api/agents";
import { deleteRemoteSession, renameRemoteSession } from "../../../api/terminals";
import type { DeleteTarget } from "../../../types/app";
import type { AgentSession, HistoryResponse } from "../../../types/agents";
import { logicalPath } from "../../../shared/lib/utils";
import { errorMessage, type HomePaths } from "./shared";

const emptyHistory: HistoryResponse = { available: false, diagnostic: null, sessions: [] };

type HistoryState = {
  agentId: string | null;
  selection: number;
  response: HistoryResponse;
  loading: boolean;
  settled: boolean;
  loadError: string | null;
};

export function useAgentSessions({
  homePaths,
  active,
  reportError,
  closeSidebar,
  bumpFocus,
  historyAgentId,
}: {
  homePaths: HomePaths;
  active: boolean;
  reportError: (message: string) => void;
  closeSidebar: () => void;
  bumpFocus: () => void;
  historyAgentId: string | null;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>({
    agentId: null,
    selection: 0,
    response: emptyHistory,
    loading: false,
    settled: false,
    loadError: null,
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<AgentSession[]>([]);
  const mutationVersion = useRef(0);
  const historyAgentIdRef = useRef(historyAgentId);
  const historySelection = useRef(0);
  const historyVersions = useRef(new Map<string, number>());
  const historyRefreshes = useRef(new Map<string, { selection: number; request: Promise<void> }>());
  historyAgentIdRef.current = historyAgentId;
  const historyMatches =
    historyState.agentId === historyAgentId && historyState.selection === historySelection.current;
  const history = historyMatches ? historyState.response : emptyHistory;
  const historyLoading = historyMatches ? historyState.loading : Boolean(historyAgentId);
  const historySettled = historyMatches ? historyState.settled : false;
  const historyLoadError = historyMatches ? historyState.loadError : null;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const refreshHistory = useCallback(
    (foreground = false) => {
      const agentId = historyAgentId;
      if (!agentId) return Promise.resolve();
      const inFlight = historyRefreshes.current.get(agentId);
      if (inFlight?.selection === historySelection.current) return inFlight.request;
      const selection = historySelection.current;
      const version = historyVersions.current.get(agentId) ?? 0;
      if (foreground) {
        setHistoryState((current) =>
          current.agentId === agentId && current.selection === selection
            ? { ...current, loading: true }
            : current,
        );
      }
      const request = getHistory(agentId)
        .then((data) => {
          if (
            selection === historySelection.current &&
            historyAgentIdRef.current === agentId &&
            version === (historyVersions.current.get(agentId) ?? 0)
          ) {
            setHistoryState({ agentId, selection, response: data, loading: false, settled: true, loadError: null });
          }
        })
        .catch((reason) => {
          const message = errorMessage(reason);
          if (
            selection === historySelection.current &&
            historyAgentIdRef.current === agentId &&
            version === (historyVersions.current.get(agentId) ?? 0)
          ) {
            setHistoryState((current) =>
              current.agentId === agentId && current.selection === selection
                ? { ...current, loading: false, settled: true, loadError: message }
                : current,
            );
            reportError(message);
          }
        })
        .finally(() => {
          if (historyRefreshes.current.get(agentId)?.request === request) historyRefreshes.current.delete(agentId);
        });
      historyRefreshes.current.set(agentId, { selection, request });
      return request;
    },
    [historyAgentId, reportError],
  );
  const retryHistory = useCallback(() => refreshHistory(true), [refreshHistory]);

  useEffect(() => {
    historySelection.current += 1;
    setHistoryState({
      agentId: historyAgentId,
      selection: historySelection.current,
      response: emptyHistory,
      loading: Boolean(historyAgentId),
      settled: false,
      loadError: null,
    });
  }, [historyAgentId]);

  useEffect(() => {
    if (historyAgentId) void refreshHistory();
    const delay =
      historyAgentId &&
      sessions.some((session) => session.agentId === historyAgentId && !session.upstreamSessionId)
        ? 1000
        : 10000;
    const timer = window.setInterval(() => {
      if (active && historyAgentId) void refreshHistory();
    }, delay);
    return () => window.clearInterval(timer);
  }, [active, historyAgentId, refreshHistory, sessions]);

  const applySessions = useCallback(
    (nextSessions: AgentSession[], paths: HomePaths) => {
      mutationVersion.current += 1;
      const normalized = nextSessions.map((session) => ({
        ...session,
        cwd: logicalPath(session.cwd, paths?.home, paths?.resolvedHome),
      }));
      sessionsRef.current = normalized;
      setSessions(normalized);
      setActiveId((current) =>
        current && normalized.some((session) => session.id === current) ? current : (normalized[0]?.id ?? null),
      );
    },
    [],
  );

  const initializeSessions = useCallback(
    (nextSessions: AgentSession[], initialHomePaths: HomePaths) => {
      applySessions(nextSessions, initialHomePaths);
    },
    [applySessions],
  );

  const applyAuthoritativeSessions = useCallback(
    (nextSessions: AgentSession[]) => applySessions(nextSessions, homePaths),
    [applySessions, homePaths],
  );

  const removeSession = useCallback(
    (id: string) => {
      mutationVersion.current += 1;
      const next = sessionsRef.current.filter((item) => item.id !== id);
      sessionsRef.current = next;
      setSessions(next);
      setActiveId((current) => (current === id ? (next[0]?.id ?? null) : current));
      window.setTimeout(() => void refreshHistory(), 500);
    },
    [refreshHistory],
  );

  const updateUpstreamSession = useCallback(
    (id: string, upstreamSessionId: string, cwd?: string) => {
      const current = sessionsRef.current.find((session) => session.id === id);
      const normalizedCwd = cwd
        ? logicalPath(cwd, homePaths?.home, homePaths?.resolvedHome)
        : undefined;
      if (
        !current ||
        (current.upstreamSessionId === upstreamSessionId &&
          (!normalizedCwd || current.cwd === normalizedCwd))
      )
        return;
      const next = sessionsRef.current.map((session) =>
        session.id === id
          ? { ...session, upstreamSessionId, cwd: normalizedCwd ?? session.cwd }
          : session,
      );
      sessionsRef.current = next;
      setSessions(next);
      void refreshHistory();
    },
    [homePaths, refreshHistory],
  );

  const addSession = useCallback((session: AgentSession) => {
    mutationVersion.current += 1;
    if (!sessionsRef.current.some((item) => item.id === session.id)) {
      sessionsRef.current = [...sessionsRef.current, session];
    }
    setSessions(sessionsRef.current);
    setActiveId(session.id);
  }, []);

  const deleteHistorySession = useCallback(
    async (id: string) => {
      const agentId = historyAgentId;
      if (!agentId) return;
      await deleteAgentHistorySession(agentId, id);
      historyVersions.current.set(agentId, (historyVersions.current.get(agentId) ?? 0) + 1);
      historyRefreshes.current.delete(agentId);
      if (historyAgentIdRef.current === agentId) await refreshHistory();
    },
    [historyAgentId, refreshHistory],
  );

  const renameSession = useCallback(
    async (session: AgentSession, name: string) => {
      const nextName = name.trim();
      if (!nextName || nextName === session.name) return true;
      try {
        const result = await renameRemoteSession("/api/agent-sessions", session.id, nextName);
        const updated = Object.values(result)[0] as AgentSession;
        const normalized = {
          ...updated,
          cwd: logicalPath(updated.cwd, homePaths?.home, homePaths?.resolvedHome),
        };
        setSessions((current) => current.map((item) => (item.id === normalized.id ? normalized : item)));
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      }
    },
    [homePaths, reportError],
  );

  const deleteSession = useCallback(
    async (target: DeleteTarget): Promise<boolean> => {
      await deleteRemoteSession("/api/agent-sessions", target.id);
      removeSession(target.id);
      return true;
    },
    [removeSession],
  );

  const activateSession = useCallback(
    (id: string) => {
      setActiveId(id);
      closeSidebar();
      bumpFocus();
    },
    [bumpFocus, closeSidebar],
  );

  return {
    sessions,
    history,
    historyLoading,
    historySettled,
    historyLoadError,
    activeId,
    initializeSessions,
    applyAuthoritativeSessions,
    refreshHistory,
    retryHistory,
    removeSession,
    updateUpstreamSession,
    addSession,
    renameSession,
    deleteSession,
    deleteHistorySession,
    activateSession,
  };
}
