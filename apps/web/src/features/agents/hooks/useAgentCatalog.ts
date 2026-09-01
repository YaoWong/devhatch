import { useCallback, useRef, useState } from "react";
import { agentPaths, agents as listAgents, createAgentLaunchPath, deleteAgentLaunchPath, updateAgentLaunchPath } from "../../../api/agents";
import type { Agent, AgentLaunchPath } from "../../../types/agents";
import { findAgentLaunchPath } from "../agentLaunchState";
import { readDefaultAgentId, writeDefaultAgentId } from "../defaultAgentPreference";
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
  const [defaultAgentId, setDefaultAgentIdState] = useState<string | null>(() => readDefaultAgentId());
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
    const preferred = data.agents.find((agent) => agent.id === readDefaultAgentId() && agent.enabled && agent.available);
    setSelectedAgentId(preferred?.id ?? data.agents[0]?.id ?? null);
  }, []);
  const setDefaultAgentId = useCallback((agentId: string) => {
    setDefaultAgentIdState(agentId);
    writeDefaultAgentId(agentId);
  }, []);
  const initializePaths = useCallback((data: Awaited<ReturnType<typeof agentPaths>>) => {
    refreshGeneration.current += 1;
    setPaths(data.agentLaunchPaths);
  }, []);

  const choosePath = useCallback(
    async (path: string) => {
      if (mutationRef.current) return false;
      mutationRef.current = true;
      refreshGeneration.current += 1;
      try {
        let item = findAgentLaunchPath(paths, path);
        if (!item) {
          const result = await createAgentLaunchPath({ path, alias: null, pinned: false });
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
    [closeSidebar, paths, reportError],
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
    defaultAgentId,
    selectedAgentId,
    selectedPathId,
    setPaths,
    setDefaultAgentId,
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
