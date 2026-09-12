import { useCallback, useEffect, useRef, useState } from "react";
import { deleteAgentHistorySession, history as getHistory } from "../../../api/agents";
import type { AgentSession, HistoryResponse } from "../../../types/agents";
import { agentHistoryPollDelay, runWhenVisible, subscribeVisiblePolling } from "../selectors";
import { errorMessage } from "./shared";

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
  sessions,
  active,
  reportError,
  historyAgentId,
}: {
  sessions: AgentSession[];
  active: boolean;
  reportError: (message: string) => void;
  historyAgentId: string | null;
}) {
  const [historyState, setHistoryState] = useState<HistoryState>({
    agentId: null,
    selection: 0,
    response: emptyHistory,
    loading: false,
    settled: false,
    loadError: null,
  });
  const historyAgentIdRef = useRef(historyAgentId);
  const historySelection = useRef(0);
  const historyVersions = useRef(new Map<string, number>());
  const historyRefreshes = useRef(new Map<string, { selection: number; request: Promise<void> }>());
  historyAgentIdRef.current = historyAgentId;
  const historyMatches = historyState.agentId === historyAgentId && historyState.selection === historySelection.current;
  const history = historyMatches ? historyState.response : emptyHistory;
  const historyLoading = historyMatches ? historyState.loading : Boolean(historyAgentId);
  const historySettled = historyMatches ? historyState.settled : false;
  const historyLoadError = historyMatches ? historyState.loadError : null;

  const refreshHistory = useCallback((foreground = false) => {
    const agentId = historyAgentId;
    if (!agentId) return Promise.resolve();
    const inFlight = historyRefreshes.current.get(agentId);
    if (inFlight?.selection === historySelection.current) return inFlight.request;
    const selection = historySelection.current;
    const version = historyVersions.current.get(agentId) ?? 0;
    if (foreground) {
      setHistoryState((current) => current.agentId === agentId && current.selection === selection
        ? { ...current, loading: true }
        : current);
    }
    const request = getHistory(agentId)
      .then((data) => {
        if (selection === historySelection.current && historyAgentIdRef.current === agentId && version === (historyVersions.current.get(agentId) ?? 0)) {
          setHistoryState({ agentId, selection, response: data, loading: false, settled: true, loadError: null });
        }
      })
      .catch((reason) => {
        const message = errorMessage(reason);
        if (selection === historySelection.current && historyAgentIdRef.current === agentId && version === (historyVersions.current.get(agentId) ?? 0)) {
          setHistoryState((current) => current.agentId === agentId && current.selection === selection
            ? { ...current, loading: false, settled: true, loadError: message }
            : current);
          reportError(message);
        }
      })
      .finally(() => {
        if (historyRefreshes.current.get(agentId)?.request === request) historyRefreshes.current.delete(agentId);
      });
    historyRefreshes.current.set(agentId, { selection, request });
    return request;
  }, [historyAgentId, reportError]);

  const refreshVisibleHistory = useCallback(
    () => runWhenVisible(document, refreshHistory) ?? Promise.resolve(),
    [refreshHistory],
  );

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

  const hasPendingHistorySession = Boolean(historyAgentId) && sessions.some(
    (session) => session.agentId === historyAgentId && !session.upstreamSessionId,
  );
  const historyPollDelay = agentHistoryPollDelay(active, historyAgentId, hasPendingHistorySession);

  useEffect(() => {
    if (historyPollDelay === null) return;
    return subscribeVisiblePolling(document, window, () => void refreshVisibleHistory(), historyPollDelay, true);
  }, [historyPollDelay, refreshVisibleHistory]);

  const deleteHistorySession = useCallback(async (id: string) => {
    const agentId = historyAgentId;
    if (!agentId) return;
    await deleteAgentHistorySession(agentId, id);
    historyVersions.current.set(agentId, (historyVersions.current.get(agentId) ?? 0) + 1);
    historyRefreshes.current.delete(agentId);
    if (historyAgentIdRef.current === agentId) await refreshHistory();
  }, [historyAgentId, refreshHistory]);

  return {
    history,
    historyLoading,
    historySettled,
    historyLoadError,
    refreshHistory,
    retryHistory: () => refreshHistory(true),
    deleteHistorySession,
  };
}
