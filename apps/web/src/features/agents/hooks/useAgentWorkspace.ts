import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSession } from "../../../types/agents";
import { selectedLaunchPath, type LaunchPath, type WorkspaceSession } from "../../../types/workspaces";
import { launcherActiveSession } from "../agentLaunchState";
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
  launchAgent: (options: {
    agentId: string;
    cwd?: string;
    upstreamSessionId?: string;
    launchConfigId?: string;
    skillProfileId?: string;
  }) => Promise<AgentSession | null>;
  activateSession: (id: string) => void;
  refreshLaunchPaths: (preferred?: string | null) => Promise<void>;
}) {
  const [selectedSkillProfileId, setSelectedSkillProfileId] = useState<string | null>(null);
  const [includeSubdirectories, setIncludeSubdirectories] = useState(false);
  const [search, setSearch] = useState("");
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const catalog = useAgentCatalog();
  const selectedAgent = catalog.agents.find((agent) => agent.id === catalog.selectedAgentId) ?? catalog.agents[0] ?? null;
  const configs = useAgentConfigs(selectedAgent?.id ?? null, reportError);
  const { clearConfigs, refreshConfigs } = configs;
  const history = useAgentSessions({
    sessions,
    active,
    reportError,
    historyAgentId: selectedAgent?.supportsHistory ? selectedAgent.id : null,
  });
  const selectedConfig = configs.configs.find((config) => config.id === configs.selectedConfigId) ?? null;
  const selectedPath = selectedLaunchPath(paths, selectedPathId);

  useEffect(() => {
    clearConfigs();
    setSelectedSkillProfileId(null);
    setSearch("");
    if (selectedAgent?.id) void refreshConfigs().catch((reason) => reportError(errorMessage(reason)));
  }, [selectedAgent?.id, clearConfigs, refreshConfigs, reportError]);

  const selectedSessions = useMemo(
    () => sessions.filter((session) => session.agentId === selectedAgent?.id),
    [selectedAgent?.id, sessions],
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

  const launch = useCallback(async ({ cwd, upstreamSessionId }: { cwd?: string; upstreamSessionId?: string }) => {
    if (launchingRef.current) return false;
    launchingRef.current = true;
    setLaunching(true);
    const agent = catalog.agents.find((item) => item.id === catalog.selectedAgentId) ?? null;
    try {
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
        await Promise.all([history.refreshHistory(), catalog.refreshData(), refreshLaunchPaths()]);
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
  }, [catalog, configs.selectedConfigId, history, launchAgent, onLaunched, refreshLaunchPaths, reportError, selectedSkillProfileId]);

  return {
    sessions,
    selectedSessions,
    agents: catalog.agents,
    paths,
    configs: configs.configs,
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
    selectedAgentId: catalog.selectedAgentId,
    defaultAgentId: catalog.defaultAgentId,
    selectedAgent,
    selectedPathId,
    selectedPath,
    selectPath,
    choosePath,
    installStates: catalog.installStates,
    installingAgentId: catalog.installingAgentId,
    installAnnouncement: catalog.installAnnouncement,
    includeSubdirectories,
    displaySessions,
    mergedSessions,
    search,
    setSearch,
    setDefaultAgentId: catalog.setDefaultAgentId,
    setSelectedConfigId: configs.setSelectedConfigId,
    setSelectedSkillProfileId,
    setIncludeSubdirectories,
    setSelectedAgentId: (id: string) => {
      configs.clearConfigs();
      catalog.setSelectedAgentId(id);
      setSelectedSkillProfileId(null);
    },
    initializeAgents: catalog.initializeAgents,
    refreshData: catalog.refreshData,
    refreshConfigs: configs.refreshConfigs,
    refreshHistory: selectedAgent?.supportsHistory ? history.refreshHistory : async () => {},
    retryHistory: selectedAgent?.supportsHistory ? history.retryHistory : async () => {},
    launch,
    launching,
    installAgent: catalog.installAgent,
    createConfig: configs.createConfig,
    updateConfig: configs.updateConfig,
    deleteConfig: configs.deleteConfig,
    deleteHistorySession: history.deleteHistorySession,
    activateSession,
  };
}
