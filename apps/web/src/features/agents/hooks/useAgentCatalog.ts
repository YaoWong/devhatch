import { useCallback, useRef, useState } from "react";
import { agentPaths, agents as listAgents, createAgentLaunchPath, deleteAgentLaunchPath, updateAgentLaunchPath } from "../../../api/agents";
import type { Agent, AgentLaunchPath } from "../../../types/agents";
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
  const refreshGeneration = useRef(0);
  const mutationRef = useRef(false);

  const refreshData = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [agentData, pathData] = await Promise.all([listAgents(), agentPaths()]);
    if (refreshGeneration.current !== generation) return;
    setAgents(agentData.agents);
    setPaths(pathData.agentLaunchPaths);
  }, []);

  const initializeAgents = useCallback((data: Awaited<ReturnType<typeof listAgents>>) => {
    setAgents(data.agents);
    setSelectedAgentId(data.agents[0]?.id ?? null);
  }, []);
  const initializePaths = useCallback((data: Awaited<ReturnType<typeof agentPaths>>) => {
    refreshGeneration.current += 1;
    setPaths(data.agentLaunchPaths);
  }, []);

  const choosePath = useCallback(
    async (path: string) => {
      if (!selectedAgentId || mutationRef.current) return false;
      mutationRef.current = true;
      refreshGeneration.current += 1;
      try {
        let item = paths.find((entry) => entry.agentId === selectedAgentId && entry.path === path);
        if (!item) {
          const result = await createAgentLaunchPath({ agentId: selectedAgentId, path, alias: null, pinned: false });
          item = result.agentLaunchPath;
        }
        setSelectedPathId(item.id);
        setPaths((current) => (current.some((entry) => entry.id === item.id) ? current : [...current, item]));
        closeSidebar();
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      } finally {
        mutationRef.current = false;
      }
    },
    [closeSidebar, paths, reportError, selectedAgentId],
  );

  const pinPath = useCallback(
    async (path: AgentLaunchPath) => {
      if (mutationRef.current) return;
      mutationRef.current = true;
      refreshGeneration.current += 1;
      try {
        await updateAgentLaunchPath(path.id, { pinned: !path.pinned });
        await refreshData();
      } catch (reason) {
        reportError(errorMessage(reason));
      } finally {
        mutationRef.current = false;
      }
    },
    [refreshData, reportError],
  );

  const renamePath = useCallback(
    async (path: AgentLaunchPath, alias: string) => {
      if (mutationRef.current) return false;
      mutationRef.current = true;
      refreshGeneration.current += 1;
      try {
        await updateAgentLaunchPath(path.id, { alias: alias.trim() || null });
        await refreshData();
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      } finally {
        mutationRef.current = false;
      }
    },
    [refreshData, reportError],
  );

  const deletePath = useCallback(
    async (path: AgentLaunchPath) => {
      if (mutationRef.current) return;
      mutationRef.current = true;
      refreshGeneration.current += 1;
      try {
        await deleteAgentLaunchPath(path.id);
        await refreshData();
      } finally {
        mutationRef.current = false;
      }
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
