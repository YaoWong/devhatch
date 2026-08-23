import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteOpenCodeHistorySession,
  deleteRemoteSession,
  endpoints,
  renameRemoteSession,
} from "../../api";
import type { AgentSession, DeleteTarget, HistoryResponse } from "../../types";
import { logicalPath } from "../../utils";
import { errorMessage, type HomePaths } from "./shared";

export function useAgentSessions({
  homePaths,
  active,
  reportError,
  closeSidebar,
  bumpFocus,
}: {
  homePaths: HomePaths;
  active: boolean;
  reportError: (message: string) => void;
  closeSidebar: () => void;
  bumpFocus: () => void;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [history, setHistory] = useState<HistoryResponse>({ available: false, diagnostic: null, sessions: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<AgentSession[]>([]);
  const mutationVersion = useRef(0);
  const historyVersion = useRef(0);
  const historyRefresh = useRef<Promise<void> | null>(null);
  const sessionRefresh = useRef<Promise<void> | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const refreshHistory = useCallback(() => {
    if (historyRefresh.current) return historyRefresh.current;
    const version = historyVersion.current;
    const request = endpoints
      .history()
      .then((data) => {
        if (version === historyVersion.current) setHistory(data);
      })
      .catch((reason) => reportError(errorMessage(reason)))
      .finally(() => {
        if (historyRefresh.current === request) historyRefresh.current = null;
      });
    historyRefresh.current = request;
    return request;
  }, [reportError]);

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
    void refreshHistory();
    const delay = sessions.some((session) => !session.upstreamSessionId) ? 1000 : 10000;
    const timer = window.setInterval(() => {
      if (active) void Promise.all([refreshHistory(), refreshSessions()]);
    }, delay);
    return () => window.clearInterval(timer);
  }, [active, refreshHistory, refreshSessions, sessions]);

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
    (id: string, upstreamSessionId: string) => {
      const current = sessionsRef.current.find((session) => session.id === id);
      if (!current || current.upstreamSessionId === upstreamSessionId) return;
      const next = sessionsRef.current.map((session) =>
        session.id === id ? { ...session, upstreamSessionId } : session,
      );
      sessionsRef.current = next;
      setSessions(next);
      void refreshHistory();
    },
    [refreshHistory],
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
      await deleteOpenCodeHistorySession(id);
      historyVersion.current += 1;
      // Let an older in-flight response settle before starting the authoritative refresh.
      await historyRefresh.current;
      await refreshHistory();
    },
    [refreshHistory],
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
