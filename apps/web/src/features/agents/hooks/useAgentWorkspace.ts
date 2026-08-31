import { useEffect, useMemo, useState } from "react";
import { mergeAgentSessions, substituteHistoryTitles } from "../selectors";
import { useAgentCatalog } from "./useAgentCatalog";
import { useAgentConfigs } from "./useAgentConfigs";
import { useAgentLaunch } from "./useAgentLaunch";
import { useAgentSessions } from "./useAgentSessions";
import type { HomePaths } from "./shared";

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
  const selectedConfig = configs.configs.find((config) => config.id === configs.selectedConfigId) ?? null;
  const selectedPaths = catalog.paths.filter((path) => path.agentId === selectedAgent?.id);
  const selectedPath = selectedPaths.find((path) => path.id === catalog.selectedPathId) ?? null;
  const setSelectedPathId = catalog.setSelectedPathId;

  useEffect(() => {
    if (catalog.selectedPathId && !selectedPath) setSelectedPathId(null);
  }, [catalog.selectedPathId, selectedPath, setSelectedPathId]);

  useEffect(() => {
    clearConfigs();
    setSelectedSkillProfileId(null);
    if (selectedAgent?.id) void refreshConfigs().catch((reason) => reportError(String(reason)));
  }, [selectedAgent?.id, clearConfigs, refreshConfigs, reportError]);

  const selectedSessions = useMemo(
    () => sessionState.sessions.filter((session) => session.agentId === selectedAgent?.id),
    [selectedAgent?.id, sessionState.sessions],
  );
  const selectedDisplaySessions = useMemo(
    () => substituteHistoryTitles(selectedSessions, sessionState.history),
    [selectedSessions, sessionState.history],
  );
  const selectedActiveId = sessionState.activeId && selectedSessions.some((session) => session.id === sessionState.activeId)
    ? sessionState.activeId
    : (selectedSessions[0]?.id ?? null);
  const activeSession = selectedDisplaySessions.find((session) => session.id === selectedActiveId) ?? null;
  const displaySessions = useMemo(() => {
    const selectedById = new Map(selectedDisplaySessions.map((session) => [session.id, session]));
    return sessionState.sessions.map((session) => selectedById.get(session.id) ?? session);
  }, [selectedDisplaySessions, sessionState.sessions]);
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
    selectedSessions,
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
    activeId: selectedActiveId,
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
      configs.clearConfigs();
      catalog.setSelectedAgentId(id);
      catalog.setSelectedPathId(null);
      setSelectedSkillProfileId(null);
    },
    setPaths: catalog.setPaths,
    initializeAgents: catalog.initializeAgents,
    initializePaths: catalog.initializePaths,
    initializeSessions: sessionState.initializeSessions,
    onLaunched,
    refreshData: catalog.refreshData,
    refreshConfigs: configs.refreshConfigs,
    refreshHistory: selectedAgent?.supportsHistory ? sessionState.refreshHistory : async () => {},
    retryHistory: selectedAgent?.supportsHistory ? sessionState.retryHistory : async () => {},
    removeSession: sessionState.removeSession,
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
    deleteSession: sessionState.deleteSession,
    activateSession: sessionState.activateSession,
  };
}
