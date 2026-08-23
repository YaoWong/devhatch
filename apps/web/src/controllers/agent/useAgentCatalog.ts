import { useCallback, useState } from "react";
import { createAgentLaunchPath, deleteAgentLaunchPath, endpoints, updateAgentLaunchPath } from "../../api";
import type { Agent, AgentLaunchPath } from "../../types";
import { errorMessage } from "./shared";

export function useAgentCatalog({
  closeSidebar,
  reportError,
}: {
  closeSidebar: () => void;
  reportError: (message: string) => void;
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [paths, setPaths] = useState<AgentLaunchPath[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    const [agentData, pathData] = await Promise.all([endpoints.agents(), endpoints.agentPaths()]);
    setAgents(agentData.agents);
    setPaths(pathData.agentLaunchPaths);
  }, []);

  const initializeAgents = useCallback((data: Awaited<ReturnType<typeof endpoints.agents>>) => {
    setAgents(data.agents);
    setSelectedAgentId(data.agents[0]?.id ?? null);
  }, []);
  const initializePaths = useCallback((data: Awaited<ReturnType<typeof endpoints.agentPaths>>) => {
    setPaths(data.agentLaunchPaths);
  }, []);

  const choosePath = useCallback(
    async (path: string) => {
      try {
        let item = paths.find((entry) => entry.agentId === selectedAgentId && entry.path === path);
        if (!item) {
          const result = await createAgentLaunchPath({ agentId: selectedAgentId, path, alias: null, pinned: false });
          item = result.agentLaunchPath;
        }
        setSelectedPathId(item.id);
        setPaths((current) => (current.some((entry) => entry.id === item.id) ? current : [...current, item]));
        closeSidebar();
      } catch (reason) {
        reportError(errorMessage(reason));
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
        reportError(errorMessage(reason));
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
        reportError(errorMessage(reason));
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

  return {
    agents,
    paths,
    selectedAgentId,
    selectedPathId,
    setPaths,
    setSelectedAgentId,
    setSelectedPathId,
    refreshData,
    initializeAgents,
    initializePaths,
    choosePath,
    pinPath,
    renamePath,
    deletePath,
  };
}
