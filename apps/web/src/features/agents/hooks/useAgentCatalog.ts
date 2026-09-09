import { useCallback, useRef, useState } from "react";
import {
  agentPaths,
  agents as listAgents,
  createAgentLaunchPath,
  deleteAgentLaunchPath,
  installAgent as installAgentCli,
  updateAgentLaunchPath,
} from "../../../api/agents";
import type { Agent, AgentLaunchPath } from "../../../types/agents";
import { findAgentLaunchPath } from "../agentLaunchState";
import { readDefaultAgentId, writeDefaultAgentId } from "../defaultAgentPreference";
import { errorMessage } from "./shared";

export type AgentInstallState = {
  installing: boolean;
  installed: boolean;
  error: string | null;
};

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
  const [installStates, setInstallStates] = useState<Record<string, AgentInstallState>>({});
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const [installAnnouncement, setInstallAnnouncement] = useState("");
  const agentRefreshGeneration = useRef(0);
  const pathRefreshGeneration = useRef(0);
  const mutationRef = useRef(false);
  const installingRef = useRef<string | null>(null);

  const refreshAgents = useCallback(async () => {
    const generation = ++agentRefreshGeneration.current;
    const data = await listAgents();
    if (agentRefreshGeneration.current !== generation) return;
    setAgents(data.agents);
  }, []);

  const refreshData = useCallback(async () => {
    const agentGeneration = ++agentRefreshGeneration.current;
    const pathGeneration = ++pathRefreshGeneration.current;
    const [agentData, pathData] = await Promise.all([listAgents(), agentPaths()]);
    if (agentRefreshGeneration.current === agentGeneration) setAgents(agentData.agents);
    if (pathRefreshGeneration.current === pathGeneration) setPaths(pathData.agentLaunchPaths);
  }, []);

  const installAgent = useCallback(async (agentId: string) => {
    if (installingRef.current) return false;
    const agentName = agents.find((agent) => agent.id === agentId)?.name ?? "Agent CLI";
    installingRef.current = agentId;
    setInstallingAgentId(agentId);
    setInstallAnnouncement(`Installing ${agentName}…`);
    setInstallStates((current) => ({ ...current, [agentId]: { installing: true, installed: false, error: null } }));
    try {
      await installAgentCli(agentId);
      try {
        await refreshAgents();
        setInstallStates((current) => ({ ...current, [agentId]: { installing: false, installed: true, error: null } }));
        setInstallAnnouncement(`${agentName} installed.`);
        return true;
      } catch {
        setInstallStates((current) => ({
          ...current,
          [agentId]: { installing: false, installed: true, error: "Installation completed, but agent status could not be refreshed." },
        }));
        setInstallAnnouncement(`${agentName} installed, but its status could not be refreshed.`);
        return false;
      }
    } catch (reason) {
      const message = errorMessage(reason);
      setInstallStates((current) => ({
        ...current,
        [agentId]: { installing: false, installed: false, error: message },
      }));
      setInstallAnnouncement(`${agentName} installation failed: ${message}`);
      return false;
    } finally {
      installingRef.current = null;
      setInstallingAgentId(null);
    }
  }, [agents, refreshAgents]);

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
    pathRefreshGeneration.current += 1;
    setPaths(data.agentLaunchPaths);
  }, []);

  const choosePath = useCallback(
    async (path: string) => {
      if (mutationRef.current) return false;
      mutationRef.current = true;
      pathRefreshGeneration.current += 1;
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
      pathRefreshGeneration.current += 1;
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
      pathRefreshGeneration.current += 1;
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
      pathRefreshGeneration.current += 1;
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
    installStates,
    installingAgentId,
    installAnnouncement,
    setPaths,
    setDefaultAgentId,
    setSelectedAgentId,
    setSelectedPathId,
    refreshData,
    installAgent,
    initializeAgents,
    initializePaths,
    choosePath,
    pinPath,
    renamePath,
    deletePath,
  };
}
