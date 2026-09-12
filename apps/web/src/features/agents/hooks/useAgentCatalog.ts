import { useCallback, useRef, useState } from "react";
import { agents as listAgents, installAgent as installAgentCli } from "../../../api/agents";
import type { Agent } from "../../../types/agents";
import { readDefaultAgentId, writeDefaultAgentId } from "../defaultAgentPreference";
import { errorMessage } from "./shared";

export type AgentInstallState = {
  installing: boolean;
  installed: boolean;
  error: string | null;
};

export function useAgentCatalog() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [defaultAgentId, setDefaultAgentIdState] = useState<string | null>(() => readDefaultAgentId());
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [installStates, setInstallStates] = useState<Record<string, AgentInstallState>>({});
  const [installingAgentId, setInstallingAgentId] = useState<string | null>(null);
  const [installAnnouncement, setInstallAnnouncement] = useState("");
  const agentRefreshGeneration = useRef(0);
  const installingRef = useRef<string | null>(null);

  const refreshAgents = useCallback(async () => {
    const generation = ++agentRefreshGeneration.current;
    const data = await listAgents();
    if (agentRefreshGeneration.current === generation) setAgents(data.agents);
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

  return {
    agents,
    defaultAgentId,
    selectedAgentId,
    installStates,
    installingAgentId,
    installAnnouncement,
    setDefaultAgentId,
    setSelectedAgentId,
    refreshData: refreshAgents,
    installAgent,
    initializeAgents,
  };
}
