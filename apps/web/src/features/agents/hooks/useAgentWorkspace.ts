import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentWorkspaces, createAgentSession, createAgentWorkspace, deleteAgentWorkspace, updateAgentWorkspace } from "../../../api/agents";
import type { AgentWorkspace, AgentWorkspaceSnapshot } from "../../../types/agents";
import { WorkspaceMutationQueue } from "../../terminals/workspaceMutationQueue";
import { launcherActiveSession, selectedAgentLaunchPath } from "../agentLaunchState";
import {
  agentWorkspaceSessions,
  mergeAgentWorkspace,
  mergeAgentWorkspaceMetadata,
  reconcileAgentWorkspaces,
  reconcileAgentWorkspaceSnapshot,
  selectedWorkspaceAfterDisband,
  workspaceOwningSession,
} from "../agentWorkspaceState";
import { completeAgentSessionLaunch } from "../agentWorkspaceLaunch";
import { mergeAgentSessions, substituteHistoryTitles } from "../selectors";
import { useAgentCatalog } from "./useAgentCatalog";
import { useAgentConfigs } from "./useAgentConfigs";
import { useAgentLaunch } from "./useAgentLaunch";
import { useAgentSessions } from "./useAgentSessions";
import { errorMessage, type HomePaths } from "./shared";

const AGENT_WORKSPACES_MUTATION_KEY = "agent-workspaces";

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
  const [selectedSkillProfileId, setSelectedSkillProfileId] = useState<string | null>(null);
  const [includeSubdirectories, setIncludeSubdirectories] = useState(false);
  const [search, setSearch] = useState("");
  const [workspaces, setWorkspaces] = useState<AgentWorkspace[]>([]);
  const [selectedAgentWorkspaceId, setSelectedAgentWorkspaceId] = useState<string | null>(null);
  const workspacesRef = useRef<AgentWorkspace[]>([]);
  const selectedAgentWorkspaceIdRef = useRef<string | null>(null);
  const workspaceMutationsRef = useRef(new WorkspaceMutationQueue());
  const workspaceRefreshRef = useRef<Promise<void> | null>(null);
  const removedSessionIdsRef = useRef(new Set<string>());
  const applyWorkspaces = useCallback((next: AgentWorkspace[], preferred?: string | null) => {
    const filtered = reconcileAgentWorkspaces(next, {
      has: (id) => !removedSessionIdsRef.current.has(id),
    });
    workspacesRef.current = filtered;
    setWorkspaces(filtered);
    setSelectedAgentWorkspaceId((current) => {
      const candidate = preferred === undefined ? current : preferred;
      const selected = candidate && filtered.some((workspace) => workspace.id === candidate) ? candidate : (filtered[0]?.id ?? null);
      selectedAgentWorkspaceIdRef.current = selected;
      return selected;
    });
  }, []);
  const catalog = useAgentCatalog({ closeSidebar, reportError });
  const selectedAgent =
    catalog.agents.find((agent) => agent.id === catalog.selectedAgentId) ?? catalog.agents[0] ?? null;
  const configs = useAgentConfigs(selectedAgent?.id ?? null, reportError);
  const { clearConfigs, refreshConfigs } = configs;
  const sessionState = useAgentSessions({
    homePaths,
    active,
    reportError,
    closeSidebar,
    bumpFocus,
    historyAgentId: selectedAgent?.supportsHistory ? selectedAgent.id : null,
  });
  const { applyAuthoritativeSessions, initializeSessions } = sessionState;
  const selectedConfig = configs.configs.find((config) => config.id === configs.selectedConfigId) ?? null;
  const selectedPath = selectedAgentLaunchPath(catalog.paths, catalog.selectedPathId);
  const setSelectedPathId = catalog.setSelectedPathId;

  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  useEffect(() => { selectedAgentWorkspaceIdRef.current = selectedAgentWorkspaceId; }, [selectedAgentWorkspaceId]);
  const initializeWorkspaces = useCallback((snapshot: AgentWorkspaceSnapshot, initialHomePaths: HomePaths) => {
    const reconciled = reconcileAgentWorkspaceSnapshot(snapshot);
    initializeSessions(reconciled.sessions, initialHomePaths);
    applyWorkspaces(reconciled.workspaces);
  }, [applyWorkspaces, initializeSessions]);
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedAgentWorkspaceId) ?? null,
    [selectedAgentWorkspaceId, workspaces],
  );
  const workspaceSessions = useMemo(
    () => agentWorkspaceSessions(selectedWorkspace, sessionState.sessions),
    [selectedWorkspace, sessionState.sessions],
  );
  const applyAuthoritativeSnapshot = useCallback((snapshot: AgentWorkspaceSnapshot) => {
    const reconciled = reconcileAgentWorkspaceSnapshot(snapshot);
    applyAuthoritativeSessions(reconciled.sessions);
    applyWorkspaces(reconciled.workspaces);
  }, [applyAuthoritativeSessions, applyWorkspaces]);
  const refreshAuthoritativeSnapshot = useCallback(() => {
    if (workspaceRefreshRef.current) return workspaceRefreshRef.current;
    const request = workspaceMutationsRef.current.readLatest(AGENT_WORKSPACES_MUTATION_KEY, agentWorkspaces)
      .then(applyAuthoritativeSnapshot)
      .catch((reason) => reportError(errorMessage(reason)))
      .finally(() => {
        if (workspaceRefreshRef.current === request) workspaceRefreshRef.current = null;
      });
    workspaceRefreshRef.current = request;
    return request;
  }, [applyAuthoritativeSnapshot, reportError]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (active) void refreshAuthoritativeSnapshot();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, refreshAuthoritativeSnapshot]);
  const refreshAuthoritativeWorkspaces = useCallback(async <T,>(apply: (authoritative: AgentWorkspace[]) => T): Promise<T> => {
    const snapshot = await workspaceMutationsRef.current.readLatest(AGENT_WORKSPACES_MUTATION_KEY, agentWorkspaces);
    const reconciled = reconcileAgentWorkspaceSnapshot(snapshot);
    applyAuthoritativeSessions(reconciled.sessions);
    return apply(reconciled.workspaces);
  }, [applyAuthoritativeSessions]);
  const launchSession = useCallback(async (
    options: Parameters<typeof createAgentSession>[0],
    targetWorkspaceId: string | null,
    onCreated: (session: Awaited<ReturnType<typeof createAgentSession>>["agentSession"]) => void,
  ) => {
    const launch = workspaceMutationsRef.current.run(AGENT_WORKSPACES_MUTATION_KEY, () => createAgentSession(options));
    return completeAgentSessionLaunch({
      launch: launch.result,
      readAuthoritative: () => workspaceMutationsRef.current.read(AGENT_WORKSPACES_MUTATION_KEY, agentWorkspaces),
      isLatest: (generation) => workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, generation),
      onCreated,
      currentWorkspaceId: () => selectedAgentWorkspaceIdRef.current,
      targetWorkspaceId,
      applyCreatedWorkspace: (workspace, preferred) => {
        applyWorkspaces(mergeAgentWorkspace(workspacesRef.current, workspace), preferred);
      },
      applyAuthoritative: (sessions, next, preferred) => {
        sessionState.applyAuthoritativeSessions(sessions);
        applyWorkspaces(next, preferred);
      },
      removeSession: sessionState.removeSession,
    });
  }, [applyWorkspaces, sessionState]);

  useEffect(() => {
    if (catalog.selectedPathId && !selectedPath) setSelectedPathId(null);
  }, [catalog.selectedPathId, selectedPath, setSelectedPathId]);

  useEffect(() => {
    clearConfigs();
    setSelectedSkillProfileId(null);
    setSearch("");
    if (selectedAgent?.id) void refreshConfigs().catch((reason) => reportError(errorMessage(reason)));
  }, [selectedAgent?.id, clearConfigs, refreshConfigs, reportError]);

  const selectedSessions = useMemo(
    () => sessionState.sessions.filter((session) => session.agentId === selectedAgent?.id),
    [selectedAgent?.id, sessionState.sessions],
  );
  const selectedDisplaySessions = useMemo(
    () => substituteHistoryTitles(selectedSessions, sessionState.history),
    [selectedSessions, sessionState.history],
  );
  const workspaceActiveId = selectedWorkspace?.activeAgentSessionId && workspaceSessions.some((session) => session.id === selectedWorkspace.activeAgentSessionId)
    ? selectedWorkspace.activeAgentSessionId
    : (workspaceSessions[0]?.id ?? null);
  const displaySessions = useMemo(() => {
    const selectedById = new Map(selectedDisplaySessions.map((session) => [session.id, session]));
    return sessionState.sessions.map((session) => selectedById.get(session.id) ?? session);
  }, [selectedDisplaySessions, sessionState.sessions]);
  const activeSession = displaySessions.find((session) => session.id === workspaceActiveId) ?? null;
  const selectedAgentActiveSession = launcherActiveSession(
    selectedDisplaySessions,
    selectedAgent?.id ?? null,
    workspaceActiveId,
  );
  const mergedSessions = useMemo(
    () =>
      mergeAgentSessions(
        selectedDisplaySessions,
        selectedAgent?.supportsHistory ? sessionState.history : { available: false, diagnostic: null, sessions: [] },
        search,
        selectedPath?.path ?? null,
        includeSubdirectories,
        homePaths?.home,
        homePaths?.resolvedHome,
      ),
    [
      selectedDisplaySessions,
      selectedAgent?.supportsHistory,
      sessionState.history,
      homePaths,
      includeSubdirectories,
      search,
      selectedPath?.path,
    ],
  );
  const { launch, launching } = useAgentLaunch({
    agents: catalog.agents,
    selectedAgentId: catalog.selectedAgentId,
    selectedConfigId: configs.selectedConfigId,
    selectedSkillProfileId,
    selectedAgentWorkspaceId,
    homePaths,
    reportError,
    closeSidebar,
    bumpFocus,
    onLaunched,
    addSession: sessionState.addSession,
    launchSession,
    refreshHistory: sessionState.refreshHistory,
    refreshData: catalog.refreshData,
  });

  const activateWorkspace = useCallback((id: string) => {
    selectedAgentWorkspaceIdRef.current = id;
    setSelectedAgentWorkspaceId(id);
    closeSidebar();
  }, [closeSidebar]);
  const createWorkspace = useCallback(async () => {
    const mutation = workspaceMutationsRef.current.run(
      AGENT_WORKSPACES_MUTATION_KEY,
      () => createAgentWorkspace({ agentSessionIds: [] }),
    );
    try {
      const { agentWorkspace } = await mutation.result;
      await refreshAuthoritativeWorkspaces((authoritative) => {
        applyWorkspaces(authoritative, agentWorkspace.id);
        closeSidebar();
      });
      return true;
    } catch (reason) {
      if (workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, mutation.generation)) reportError(errorMessage(reason));
      return false;
    }
  }, [applyWorkspaces, closeSidebar, refreshAuthoritativeWorkspaces, reportError]);
  const renameWorkspace = useCallback(async (workspace: AgentWorkspace, name: string) => {
    const normalizedName = name.trim();
    if (normalizedName === (workspace.name ?? "").trim()) return true;
    const mutation = workspaceMutationsRef.current.run(AGENT_WORKSPACES_MUTATION_KEY, () => updateAgentWorkspace(workspace.id, { name: normalizedName || null }));
    try {
      const { agentWorkspace } = await mutation.result;
      if (workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, mutation.generation)) applyWorkspaces(mergeAgentWorkspaceMetadata(workspacesRef.current, agentWorkspace));
      return true;
    } catch (reason) {
      if (workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, mutation.generation)) reportError(errorMessage(reason));
      return false;
    }
  }, [applyWorkspaces, reportError]);
  const removeWorkspace = useCallback(async (workspace: AgentWorkspace) => {
    const mutation = workspaceMutationsRef.current.run(AGENT_WORKSPACES_MUTATION_KEY, () => deleteAgentWorkspace(workspace.id));
    try {
      await mutation.result;
      await refreshAuthoritativeWorkspaces((authoritative) => {
        const preferred = selectedWorkspaceAfterDisband(selectedAgentWorkspaceIdRef.current, workspace, authoritative);
        applyWorkspaces(authoritative, preferred);
      });
      return true;
    } catch (reason) {
      if (workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, mutation.generation)) reportError(errorMessage(reason));
      return false;
    }
  }, [applyWorkspaces, refreshAuthoritativeWorkspaces, reportError]);
  const activateWorkspaceSession = useCallback((id: string) => {
    const workspace = workspaceOwningSession(workspacesRef.current, id);
    if (!workspace) {
      reportError("Unable to find the workspace for this agent session");
      return;
    }
    const previousWorkspaces = workspacesRef.current;
    const previousSelection = selectedAgentWorkspaceIdRef.current;
    sessionState.activateSession(id);
    const optimistic = { ...workspace, activeAgentSessionId: id };
    applyWorkspaces(mergeAgentWorkspace(previousWorkspaces, optimistic), workspace.id);
    if (workspace.activeAgentSessionId === id) return;
    const mutation = workspaceMutationsRef.current.run(AGENT_WORKSPACES_MUTATION_KEY, () => updateAgentWorkspace(workspace.id, { activeAgentSessionId: id }));
    void mutation.result.then(({ agentWorkspace }) => {
      if (workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, mutation.generation)) {
        applyWorkspaces(mergeAgentWorkspaceMetadata(workspacesRef.current, agentWorkspace));
      }
    }).catch(async (reason) => {
      if (!workspaceMutationsRef.current.isLatest(AGENT_WORKSPACES_MUTATION_KEY, mutation.generation)) return;
      try {
        await refreshAuthoritativeWorkspaces((authoritative) => {
          applyWorkspaces(authoritative, previousSelection);
        });
      } catch {
        applyWorkspaces(reconcileAgentWorkspaces(previousWorkspaces, new Set(sessionState.sessions.map((session) => session.id))), previousSelection);
      }
      reportError(errorMessage(reason));
    });
  }, [applyWorkspaces, refreshAuthoritativeWorkspaces, reportError, sessionState]);

  const removeAgentSession = useCallback((id: string) => {
    workspaceMutationsRef.current.invalidate(AGENT_WORKSPACES_MUTATION_KEY);
    removedSessionIdsRef.current.add(id);
    sessionState.removeSession(id);
    applyWorkspaces(reconcileAgentWorkspaces(workspacesRef.current, {
      has: (sessionId) => sessionId !== id && !removedSessionIdsRef.current.has(sessionId),
    }));
  }, [applyWorkspaces, sessionState]);
  const deleteSession = useCallback(async (target: Parameters<typeof sessionState.deleteSession>[0]) => {
    const deleted = await sessionState.deleteSession(target);
    if (deleted) removeAgentSession(target.id);
    return deleted;
  }, [removeAgentSession, sessionState]);

  return {
    sessions: sessionState.sessions,
    selectedSessions,
    workspaces,
    selectedWorkspace,
    selectedAgentWorkspaceId,
    workspaceSessions,
    agents: catalog.agents,
    paths: catalog.paths,
    configs: configs.configs,
    selectedConfigId: configs.selectedConfigId,
    selectedSkillProfileId,
    selectedConfig,
    history: sessionState.history,
    historyLoading: sessionState.historyLoading,
    historySettled: sessionState.historySettled,
    historyLoadError: sessionState.historyLoadError,
    activeId: workspaceActiveId,
    activeSession,
    launcherActiveSession: selectedAgentActiveSession,
    selectedAgentId: catalog.selectedAgentId,
    defaultAgentId: catalog.defaultAgentId,
    selectedAgent,
    selectedPathId: catalog.selectedPathId,
    includeSubdirectories,
    displaySessions,
    mergedSessions,
    search,
    setSearch,
    setDefaultAgentId: catalog.setDefaultAgentId,
    setSelectedPathId: catalog.setSelectedPathId,
    setSelectedConfigId: configs.setSelectedConfigId,
    setSelectedSkillProfileId,
    setIncludeSubdirectories,
    setSelectedAgentId: (id: string) => {
      configs.clearConfigs();
      catalog.setSelectedAgentId(id);
      setSelectedSkillProfileId(null);
    },
    setPaths: catalog.setPaths,
    initializeAgents: catalog.initializeAgents,
    initializePaths: catalog.initializePaths,
    initializeWorkspaces,
    onLaunched,
    refreshData: catalog.refreshData,
    refreshConfigs: configs.refreshConfigs,
    refreshHistory: selectedAgent?.supportsHistory ? sessionState.refreshHistory : async () => {},
    retryHistory: selectedAgent?.supportsHistory ? sessionState.retryHistory : async () => {},
    removeSession: removeAgentSession,
    updateUpstreamSession: sessionState.updateUpstreamSession,
    launch,
    launching,
    choosePath: catalog.choosePath,
    pinPath: catalog.pinPath,
    renamePath: catalog.renamePath,
    deletePath: catalog.deletePath,
    createConfig: configs.createConfig,
    updateConfig: configs.updateConfig,
    deleteConfig: configs.deleteConfig,
    deleteHistorySession: sessionState.deleteHistorySession,
    renameSession: sessionState.renameSession,
    deleteSession,
    activateSession: activateWorkspaceSession,
    activateWorkspace,
    createWorkspace,
    renameWorkspace,
    removeWorkspace,
  };
}
