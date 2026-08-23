import { useEffect, useMemo, useState } from "react";
import { mergeAgentSessions, substituteHistoryTitles } from "../agentSelectors";
import { useAgentCatalog } from "./agent/useAgentCatalog";
import { useAgentConfigs } from "./agent/useAgentConfigs";
import { useAgentLaunch } from "./agent/useAgentLaunch";
import { useAgentSessions } from "./agent/useAgentSessions";
import type { HomePaths } from "./agent/shared";

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
  const catalog = useAgentCatalog({ closeSidebar, reportError });
  const configs = useAgentConfigs(reportError);
  const sessionState = useAgentSessions({ homePaths, active, reportError, closeSidebar, bumpFocus });
  const selectedAgent =
    catalog.agents.find((agent) => agent.id === catalog.selectedAgentId) ?? catalog.agents[0] ?? null;
  const selectedConfig = configs.configs.find((config) => config.id === configs.selectedConfigId) ?? null;
  const activeSession = sessionState.sessions.find((session) => session.id === sessionState.activeId) ?? null;
  const selectedPaths = catalog.paths.filter((path) => path.agentId === selectedAgent?.id);
  const selectedPath = selectedPaths.find((path) => path.id === catalog.selectedPathId) ?? null;
  const setSelectedPathId = catalog.setSelectedPathId;

  useEffect(() => {
    if (catalog.selectedPathId && !selectedPath) setSelectedPathId(null);
  }, [catalog.selectedPathId, selectedPath, setSelectedPathId]);

  const displaySessions = useMemo(
    () => substituteHistoryTitles(sessionState.sessions, sessionState.history),
    [sessionState.history, sessionState.sessions],
  );
  const mergedSessions = useMemo(
    () =>
      mergeAgentSessions(
        displaySessions,
        sessionState.history,
        search,
        selectedPath?.path ?? null,
        includeSubdirectories,
        homePaths?.home,
        homePaths?.resolvedHome,
      ),
    [displaySessions, sessionState.history, homePaths, includeSubdirectories, search, selectedPath?.path],
  );
  const launch = useAgentLaunch({
    agents: catalog.agents,
    selectedAgentId: catalog.selectedAgentId,
    selectedConfigId: configs.selectedConfigId,
    selectedSkillProfileId,
    homePaths,
    reportError,
    closeSidebar,
    bumpFocus,
    onLaunched,
    addSession: sessionState.addSession,
    refreshHistory: sessionState.refreshHistory,
    refreshData: catalog.refreshData,
  });

  return {
    sessions: sessionState.sessions,
    agents: catalog.agents,
    paths: catalog.paths,
    configs: configs.configs,
    selectedConfigId: configs.selectedConfigId,
    selectedSkillProfileId,
    selectedConfig,
    history: sessionState.history,
    activeId: sessionState.activeId,
    activeSession,
    selectedAgentId: catalog.selectedAgentId,
    selectedAgent,
    selectedPaths,
    selectedPathId: catalog.selectedPathId,
    includeSubdirectories,
    displaySessions,
    mergedSessions,
    search,
    setSearch,
    setSelectedPathId: catalog.setSelectedPathId,
    setSelectedConfigId: configs.setSelectedConfigId,
    setSelectedSkillProfileId,
    setIncludeSubdirectories,
    setSelectedAgentId: (id: string) => {
      catalog.setSelectedAgentId(id);
      catalog.setSelectedPathId(null);
    },
    setPaths: catalog.setPaths,
    initializeAgents: catalog.initializeAgents,
    initializePaths: catalog.initializePaths,
    initializeConfigs: configs.initializeConfigs,
    initializeSessions: sessionState.initializeSessions,
    onLaunched,
    refreshData: catalog.refreshData,
    refreshConfigs: configs.refreshConfigs,
    refreshHistory: sessionState.refreshHistory,
    removeSession: sessionState.removeSession,
    updateUpstreamSession: sessionState.updateUpstreamSession,
    launch,
    choosePath: catalog.choosePath,
    pinPath: catalog.pinPath,
    renamePath: catalog.renamePath,
    deletePath: catalog.deletePath,
    createConfig: configs.createConfig,
    updateConfig: configs.updateConfig,
    deleteConfig: configs.deleteConfig,
    deleteHistorySession: sessionState.deleteHistorySession,
    renameSession: sessionState.renameSession,
    deleteSession: sessionState.deleteSession,
    activateSession: sessionState.activateSession,
  };
}
