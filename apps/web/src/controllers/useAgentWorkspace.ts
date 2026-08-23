import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAgentLaunchConfig,
  createAgentLaunchPath,
  createAgentSession,
  deleteAgentLaunchConfig,
  deleteAgentLaunchPath,
  deleteOpenCodeHistorySession,
  deleteRemoteSession,
  endpoints,
  renameRemoteSession,
  touchAgentLaunchPath,
  updateAgentLaunchConfig,
  updateAgentLaunchPath,
} from "../api";
import { mergeAgentSessions, substituteHistoryTitles } from "../agentSelectors";
import type {
  Agent,
  AgentLaunchConfig,
  AgentLaunchConfigInput,
  AgentLaunchPath,
  AgentSession,
  DeleteTarget,
  HistoryResponse,
} from "../types";
import { logicalPath } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function useAgentWorkspace({
  homePaths,
  active,
  reportError,
  closeSidebar,
  bumpFocus,
  onLaunched,
}: {
  homePaths: HomePaths;
  active: boolean;
  reportError: (message: string) => void;
  closeSidebar: () => void;
  bumpFocus: () => void;
  onLaunched: () => void;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [paths, setPaths] = useState<AgentLaunchPath[]>([]);
  const [configs, setConfigs] = useState<AgentLaunchConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryResponse>({ available: false, diagnostic: null, sessions: [] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [includeSubdirectories, setIncludeSubdirectories] = useState(false);
  const [search, setSearch] = useState("");
  const sessionsRef = useRef<AgentSession[]>([]);
  const mutationVersion = useRef(0);
  const historyVersion = useRef(0);
  const historyRefresh = useRef<Promise<void> | null>(null);
  const sessionRefresh = useRef<Promise<void> | null>(null);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const applyConfigs = useCallback((next: AgentLaunchConfig[]) => {
    setConfigs(next);
    setSelectedConfigId((current) => {
      if (current && next.some((config) => config.id === current)) return current;
      return next.find((config) => config.isDefault)?.id ?? next[0]?.id ?? null;
    });
  }, []);

  const refreshConfigs = useCallback(async () => {
    const data = await endpoints.agentLaunchConfigs("opencode");
    applyConfigs(data.agentLaunchConfigs);
  }, [applyConfigs]);

  const refreshData = useCallback(async () => {
    const [agentData, pathData] = await Promise.all([endpoints.agents(), endpoints.agentPaths()]);
    setAgents(agentData.agents);
    setPaths(pathData.agentLaunchPaths);
  }, []);

  const refreshHistory = useCallback(() => {
    if (historyRefresh.current) return historyRefresh.current;
    const version = historyVersion.current;
    const request = endpoints
      .history()
      .then((data) => {
        if (version === historyVersion.current) setHistory(data);
      })
      .catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)))
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
      .catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)))
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

  const initializeAgents = useCallback((data: Awaited<ReturnType<typeof endpoints.agents>>) => {
    setAgents(data.agents);
    setSelectedAgentId(data.agents[0]?.id ?? null);
  }, []);
  const initializePaths = useCallback((data: Awaited<ReturnType<typeof endpoints.agentPaths>>) => {
    setPaths(data.agentLaunchPaths);
  }, []);
  const initializeConfigs = useCallback(
    (data: Awaited<ReturnType<typeof endpoints.agentLaunchConfigs>>) => applyConfigs(data.agentLaunchConfigs),
    [applyConfigs],
  );
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

  const launch = useCallback(
    async ({ cwd, upstreamSessionId, pathId }: { cwd?: string; upstreamSessionId?: string; pathId?: string }) => {
      const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
      if (!selectedAgent?.available) {
        reportError(`${selectedAgent?.name ?? "Agent"} is unavailable`);
        return;
      }
      try {
        if (pathId) await touchAgentLaunchPath(pathId);
        const launchOptions = upstreamSessionId
          ? { upstreamSessionId, launchConfigId: selectedConfigId ?? undefined }
          : { cwd, launchConfigId: selectedConfigId ?? undefined };
        const { agentSession } = await createAgentSession(launchOptions);
        const normalized = {
          ...agentSession,
          cwd: logicalPath(agentSession.cwd, homePaths?.home, homePaths?.resolvedHome),
        };
        mutationVersion.current += 1;
        if (!sessionsRef.current.some((item) => item.id === normalized.id)) {
          sessionsRef.current = [...sessionsRef.current, normalized];
        }
        setSessions(sessionsRef.current);
        setActiveId(normalized.id);
        onLaunched();
        closeSidebar();
        bumpFocus();
        await Promise.all([refreshHistory(), refreshData()]);
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [
      agents,
      bumpFocus,
      closeSidebar,
      homePaths,
      onLaunched,
      refreshData,
      refreshHistory,
      reportError,
      selectedAgentId,
      selectedConfigId,
    ],
  );

  const choosePath = useCallback(
    async (path: string) => {
      try {
        let item = paths.find((entry) => entry.agentId === selectedAgentId && entry.path === path);
        if (!item) {
          const result = await createAgentLaunchPath({
            agentId: selectedAgentId,
            path,
            alias: null,
            pinned: false,
          });
          item = result.agentLaunchPath;
        }
        setSelectedPathId(item.id);
        setPaths((current) =>
          current.some((entry) => entry.id === item.id) ? current : [...current, item],
        );
        closeSidebar();
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [closeSidebar, paths, reportError, selectedAgentId],
  );

  const pinPath = useCallback(
    async (path: AgentLaunchPath) => {
      try {
        await updateAgentLaunchPath(path.id, { pinned: !path.pinned });
        await refreshData();
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshData, reportError],
  );

  const renamePath = useCallback(
    async (path: AgentLaunchPath, alias: string) => {
      try {
        await updateAgentLaunchPath(path.id, { alias: alias.trim() || null });
        await refreshData();
        return true;
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [refreshData, reportError],
  );

  const deletePath = useCallback(
    async (path: AgentLaunchPath) => {
      await deleteAgentLaunchPath(path.id);
      await refreshData();
    },
    [refreshData],
  );

  const createConfig = useCallback(
    async (input: AgentLaunchConfigInput) => {
      try {
        const { agentLaunchConfig } = await createAgentLaunchConfig(input);
        await refreshConfigs();
        setSelectedConfigId(agentLaunchConfig.id);
        return true;
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [refreshConfigs, reportError],
  );

  const updateConfig = useCallback(
    async (id: string, input: Partial<AgentLaunchConfigInput>) => {
      try {
        await updateAgentLaunchConfig(id, input);
        await refreshConfigs();
        setSelectedConfigId(id);
        return true;
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [refreshConfigs, reportError],
  );

  const deleteConfig = useCallback(
    async (id: string) => {
      try {
        await deleteAgentLaunchConfig(id);
        await refreshConfigs();
        return true;
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [refreshConfigs, reportError],
  );

  const deleteHistorySession = useCallback(
    async (id: string) => {
      await deleteOpenCodeHistorySession(id);
      historyVersion.current += 1;
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
        reportError(reason instanceof Error ? reason.message : String(reason));
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

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
  const activeSession = sessions.find((session) => session.id === activeId) ?? null;
  const selectedPaths = paths.filter((path) => path.agentId === selectedAgent?.id);
  const selectedPath = selectedPaths.find((path) => path.id === selectedPathId) ?? null;
  useEffect(() => {
    if (selectedPathId && !selectedPath) setSelectedPathId(null);
  }, [selectedPath, selectedPathId]);
  const displaySessions = useMemo(() => substituteHistoryTitles(sessions, history), [history, sessions]);
  const mergedSessions = useMemo(
    () =>
      mergeAgentSessions(
        displaySessions,
        history,
        search,
        selectedPath?.path ?? null,
        includeSubdirectories,
        homePaths?.home,
        homePaths?.resolvedHome,
      ),
    [displaySessions, history, homePaths, includeSubdirectories, search, selectedPath?.path],
  );

  return {
    sessions,
    agents,
    paths,
    configs,
    selectedConfigId,
    selectedConfig,
    history,
    activeId,
    activeSession,
    selectedAgentId,
    selectedAgent,
    selectedPaths,
    selectedPathId,
    includeSubdirectories,
    displaySessions,
    mergedSessions,
    search,
    setSearch,
    setSelectedPathId,
    setSelectedConfigId,
    setIncludeSubdirectories,
    setSelectedAgentId: (id: string) => {
      setSelectedAgentId(id);
      setSelectedPathId(null);
    },
    setPaths,
    initializeAgents,
    initializePaths,
    initializeConfigs,
    initializeSessions,
    onLaunched,
    refreshData,
    refreshConfigs,
    refreshHistory,
    removeSession,
    updateUpstreamSession,
    launch,
    choosePath,
    pinPath,
    renamePath,
    deletePath,
    createConfig,
    updateConfig,
    deleteConfig,
    deleteHistorySession,
    renameSession,
    deleteSession,
    activateSession,
  };
}
