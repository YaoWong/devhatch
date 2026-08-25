import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAgentHistorySession,
  deleteRemoteSession,
  endpoints,
  renameRemoteSession,
} from "../../api";
import type { AgentSession, DeleteTarget, HistoryResponse } from "../../types";
import { logicalPath } from "../../utils";
import { errorMessage, type HomePaths } from "./shared";

const emptyHistory: HistoryResponse = { available: false, diagnostic: null, sessions: [] };

type HistoryState = { agentId: string | null; selection: number; response: HistoryResponse };

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
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<AgentSession[]>([]);
  const mutationVersion = useRef(0);
  const historyAgentIdRef = useRef(historyAgentId);
  const historySelection = useRef(0);
  const historyVersions = useRef(new Map<string, number>());
  const historyRefreshes = useRef(new Map<string, { selection: number; request: Promise<void> }>());
  const sessionRefresh = useRef<Promise<void> | null>(null);
  historyAgentIdRef.current = historyAgentId;
  const history =
    historyState.agentId === historyAgentId && historyState.selection === historySelection.current
      ? historyState.response
      : emptyHistory;

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const refreshHistory = useCallback(() => {
    const agentId = historyAgentId;
    if (!agentId) return Promise.resolve();
    const inFlight = historyRefreshes.current.get(agentId);
    if (inFlight?.selection === historySelection.current) return inFlight.request;
    const selection = historySelection.current;
    const version = historyVersions.current.get(agentId) ?? 0;
    const request = endpoints
      .history(agentId)
      .then((data) => {
        if (
          selection === historySelection.current &&
          version === (historyVersions.current.get(agentId) ?? 0)
        ) {
          setHistoryState({ agentId, selection, response: data });
        }
      })
      .catch((reason) => reportError(errorMessage(reason)))
      .finally(() => {
        if (historyRefreshes.current.get(agentId)?.request === request) historyRefreshes.current.delete(agentId);
      });
    historyRefreshes.current.set(agentId, { selection, request });
    return request;
  }, [historyAgentId, reportError]);

  const refreshSessions = useCallback(() => {
    if (sessionRefresh.current) return sessionRefresh.current;
    const version = mutationVersion.current;
    const request = endpoints
      .agentSessions()
      .then(({ agentSessions }) => {
        if (version !== mutationVersion.current) return;
        const normalized = agentSessions.map((session) => ({
          ...session,
          cwd: logicalPath(session.cwd, homePaths?.home, homePaths?.resolvedHome),
        }));
        sessionsRef.current = normalized;
        setSessions(normalized);
        setActiveId((current) =>
          current && normalized.some((session) => session.id === current) ? current : (normalized[0]?.id ?? null),
        );
      })
      .catch((reason) => reportError(errorMessage(reason)))
      .finally(() => {
        if (sessionRefresh.current === request) sessionRefresh.current = null;
      });
    sessionRefresh.current = request;
    return request;
  }, [homePaths, reportError]);

  useEffect(() => {
    historySelection.current += 1;
    setHistoryState({ agentId: historyAgentId, selection: historySelection.current, response: emptyHistory });
  }, [historyAgentId]);

  useEffect(() => {
    if (historyAgentId) void refreshHistory();
    const delay =
      historyAgentId &&
      sessions.some((session) => session.agentId === historyAgentId && !session.upstreamSessionId)
        ? 1000
        : 10000;
    const timer = window.setInterval(() => {
      if (active) {
        if (historyAgentId) void Promise.all([refreshHistory(), refreshSessions()]);
        else void refreshSessions();
      }
    }, delay);
    return () => window.clearInterval(timer);
  }, [active, historyAgentId, refreshHistory, refreshSessions, sessions]);

  const initializeSessions = useCallback(
    (data: Awaited<ReturnType<typeof endpoints.agentSessions>>, initialHomePaths: HomePaths) => {
      const normalized = data.agentSessions.map((session) => ({
        ...session,
        cwd: logicalPath(session.cwd, initialHomePaths?.home, initialHomePaths?.resolvedHome),
      }));
      sessionsRef.current = normalized;
      setSessions(normalized);
      setActiveId(normalized[0]?.id ?? null);
    },
    [],
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
      await historyRefreshes.current.get(agentId)?.request;
      if (historyAgentIdRef.current === agentId) await refreshHistory();
    },
    [historyAgentId, refreshHistory],
  );

  const renameSession = useCallback(
    async (session: AgentSession) => {
      const name = window.prompt("Session name", session.name)?.trim();
      if (!name || name === session.name) return;
      try {
        const result = await renameRemoteSession("/api/agent-sessions", session.id, name);
        const updated = Object.values(result)[0] as AgentSession;
        const normalized = {
          ...updated,
          cwd: logicalPath(updated.cwd, homePaths?.home, homePaths?.resolvedHome),
        };
        setSessions((current) => current.map((item) => (item.id === normalized.id ? normalized : item)));
      } catch (reason) {
        reportError(errorMessage(reason));
      }
    },
    [homePaths, reportError],
  );

  const deleteSession = useCallback(
    async (target: DeleteTarget) => {
      await deleteRemoteSession("/api/agent-sessions", target.id);
      removeSession(target.id);
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
    activeId,
    initializeSessions,
    refreshHistory,
    removeSession,
    updateUpstreamSession,
    addSession,
    renameSession,
    deleteSession,
    deleteHistorySession,
    activateSession,
  };
}
