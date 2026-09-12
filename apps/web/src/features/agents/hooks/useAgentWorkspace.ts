import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentSession } from "../../../types/agents";
import { selectedLaunchPath, type LaunchPath, type WorkspaceSession } from "../../../types/workspaces";
import { launcherActiveSession } from "../agentLaunchState";
import { readDefaultAgentId } from "../defaultAgentPreference";
import { readStoredLaunchTargetId, resolveInitialLaunchTargetId, TERMINAL_LAUNCH_TARGET_ID, writeLaunchTargetId } from "../launchSetupPreference";
import { mergeAgentSessions, replaceAgentSessions, substituteHistoryTitles } from "../selectors";
import { useAgentCatalog } from "./useAgentCatalog";
import { useAgentConfigs } from "./useAgentConfigs";
import { useAgentSessions } from "./useAgentSessions";
import { errorMessage, type HomePaths } from "./shared";

export function useAgentWorkspace({
  homePaths,
  active,
  sessions,
  activeSession,
  paths,
  selectedPathId,
  selectPath,
  choosePath,
  reportError,
  onLaunched,
  launchTerminal,
  launchAgent,
  activateSession,
  refreshLaunchPaths,
}: {
  homePaths: HomePaths;
  active: boolean;
  sessions: AgentSession[];
  activeSession: WorkspaceSession | null;
  paths: LaunchPath[];
  selectedPathId: string | null;
  selectPath: (id: string) => void;
  choosePath: (path: string) => Promise<boolean>;
  reportError: (message: string) => void;
  onLaunched: () => void;
  launchTerminal: (cwd?: string, forceNewWorkspace?: boolean, launchConfigId?: string) => Promise<WorkspaceSession | null>;
  launchAgent: (options: {
    agentId: string;
    cwd?: string;
    upstreamSessionId?: string;
    launchConfigId?: string;
    skillProfileId?: string;
  }) => Promise<AgentSession | null>;
  activateSession: (id: string) => void;
  refreshLaunchPaths: () => Promise<void>;
}) {
  const [selectedTargetId, setSelectedTargetIdState] = useState(TERMINAL_LAUNCH_TARGET_ID);
  const [selectedSkillProfileId, setSelectedSkillProfileId] = useState<string | null>(null);
  const [includeSubdirectories, setIncludeSubdirectories] = useState(false);
  const [search, setSearch] = useState("");
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const catalog = useAgentCatalog();
  const {
    agents,
    defaultAgentId,
    initializeAgents: initializeAgentCatalog,
    installAgent,
    installAnnouncement,
    installStates,
    installingAgentId,
    refreshData: refreshAgentData,
    setDefaultAgentId,
    setSelectedAgentId: setCatalogSelectedAgentId,
  } = catalog;
  const selectedAgent = selectedTargetId === TERMINAL_LAUNCH_TARGET_ID
    ? null
    : (agents.find((agent) => agent.id === selectedTargetId) ?? null);
  const configs = useAgentConfigs(selectedTargetId, reportError);
  const history = useAgentSessions({
    sessions,
    active,
    reportError,
    historyAgentId: selectedAgent?.supportsHistory ? selectedAgent.id : null,
  });
  const selectedConfig = configs.configs.find((config) => config.id === configs.selectedConfigId) ?? null;
  const selectedPath = selectedLaunchPath(paths, selectedPathId);

  const selectedSessions = useMemo(
    () => selectedAgent ? sessions.filter((session) => session.agentId === selectedAgent.id) : [],
    [selectedAgent, sessions],
  );
  const selectedDisplaySessions = useMemo(
    () => substituteHistoryTitles(selectedSessions, history.history),
    [history.history, selectedSessions],
  );
  const displaySessions = useMemo(
    () => replaceAgentSessions(sessions, selectedAgent?.id ?? null, selectedDisplaySessions),
    [selectedAgent?.id, selectedDisplaySessions, sessions],
  );
  const activeId = activeSession?.kind === "agent" ? activeSession.id : null;
  const launcherSession = launcherActiveSession(selectedDisplaySessions, selectedAgent?.id ?? null, activeId);
  const mergedSessions = useMemo(
    () => mergeAgentSessions(
      selectedDisplaySessions,
      selectedAgent?.supportsHistory ? history.history : { available: false, diagnostic: null, sessions: [] },
      search,
      selectedPath?.path ?? null,
      includeSubdirectories,
      homePaths?.home,
      homePaths?.resolvedHome,
    ),
    [history.history, homePaths, includeSubdirectories, search, selectedAgent?.supportsHistory, selectedDisplaySessions, selectedPath?.path],
  );

  const setSelectedTargetId = useCallback((id: string) => {
    if (id !== TERMINAL_LAUNCH_TARGET_ID) {
      const agent = agents.find((item) => item.id === id);
      if (!agent?.enabled || agent.availability === "coming-soon") return;
      setCatalogSelectedAgentId(id);
    }
    setSelectedTargetIdState(id);
    writeLaunchTargetId(id);
    setSelectedSkillProfileId(null);
    setSearch("");
  }, [agents, setCatalogSelectedAgentId]);

  const initializeAgents = useCallback((data: Parameters<typeof initializeAgentCatalog>[0]) => {
    initializeAgentCatalog(data);
    const targetId = resolveInitialLaunchTargetId(data.agents, readStoredLaunchTargetId(), readDefaultAgentId());
    setSelectedTargetIdState(targetId);
    if (targetId !== TERMINAL_LAUNCH_TARGET_ID) setCatalogSelectedAgentId(targetId);
  }, [initializeAgentCatalog, setCatalogSelectedAgentId]);

  const launch = useCallback(async ({ cwd, upstreamSessionId }: { cwd?: string; upstreamSessionId?: string }) => {
    if (launchingRef.current) return false;
    launchingRef.current = true;
    setLaunching(true);
    const targetId = selectedTargetId;
    const agent = targetId === TERMINAL_LAUNCH_TARGET_ID
      ? null
      : (agents.find((item) => item.id === targetId) ?? null);
    try {
      if (configs.loading || !configs.selectedConfigId) {
        reportError("Launch config is not ready");
        return false;
      }
      if (targetId === TERMINAL_LAUNCH_TARGET_ID) {
        if (upstreamSessionId) {
          reportError("Terminal sessions cannot resume agent history");
          return false;
        }
        const created = await launchTerminal(cwd, false, configs.selectedConfigId);
        if (!created) return false;
        onLaunched();
        return true;
      }
      if (!agent?.available) {
        reportError(`${agent?.name ?? "Agent"} is unavailable`);
        return false;
      }
      if (upstreamSessionId && !agent.supportsResume) {
        reportError(`${agent.name} does not support resuming sessions`);
        return false;
      }
      const created = await launchAgent({
        agentId: agent.id,
        ...(upstreamSessionId ? { upstreamSessionId } : { cwd }),
        ...(configs.selectedConfigId ? { launchConfigId: configs.selectedConfigId } : {}),
        ...(agent.supportsSkills && selectedSkillProfileId ? { skillProfileId: selectedSkillProfileId } : {}),
      });
      if (!created) return false;
      onLaunched();
      try {
        await Promise.all([history.refreshHistory(), refreshAgentData(), refreshLaunchPaths()]);
      } catch (reason) {
        reportError(errorMessage(reason));
      }
      return true;
    } catch (reason) {
      reportError(errorMessage(reason));
      return false;
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  }, [agents, configs.loading, configs.selectedConfigId, history, launchAgent, launchTerminal, onLaunched, refreshAgentData, refreshLaunchPaths, reportError, selectedSkillProfileId, selectedTargetId]);

  return {
    sessions,
    selectedSessions,
    agents,
    paths,
    configs: configs.configs,
    configsLoading: configs.loading,
    selectedConfigId: configs.selectedConfigId,
    selectedSkillProfileId,
    selectedConfig,
    history: history.history,
    historyLoading: history.historyLoading,
    historySettled: history.historySettled,
    historyLoadError: history.historyLoadError,
    activeId,
    activeSession: activeSession?.kind === "agent" ? activeSession : null,
    launcherActiveSession: launcherSession,
    selectedTargetId,
    selectedAgentId: selectedAgent?.id ?? null,
    defaultAgentId,
    selectedAgent,
    selectedPathId,
    selectedPath,
    selectPath,
    choosePath,
    installStates,
    installingAgentId,
    installAnnouncement,
    includeSubdirectories,
    displaySessions,
    mergedSessions,
    search,
    setSearch,
    setDefaultAgentId,
    setSelectedConfigId: configs.setSelectedConfigId,
    setSelectedSkillProfileId,
    setIncludeSubdirectories,
    setSelectedTargetId,
    setSelectedAgentId: setSelectedTargetId,
    initializeAgents,
    refreshData: refreshAgentData,
    refreshConfigs: configs.refreshConfigs,
    refreshHistory: selectedAgent?.supportsHistory ? history.refreshHistory : async () => {},
    retryHistory: selectedAgent?.supportsHistory ? history.retryHistory : async () => {},
    launch,
    launching,
    installAgent,
    createConfig: configs.createConfig,
    updateConfig: configs.updateConfig,
    deleteConfig: configs.deleteConfig,
    deleteHistorySession: history.deleteHistorySession,
    activateSession,
  };
}
