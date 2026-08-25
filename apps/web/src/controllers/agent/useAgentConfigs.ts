import { useCallback, useEffect, useRef, useState } from "react";
import { createAgentLaunchConfig, deleteAgentLaunchConfig, endpoints, updateAgentLaunchConfig } from "../../api";
import type { AgentLaunchConfig, AgentLaunchConfigInput } from "../../types";
import { errorMessage } from "./shared";

export function useAgentConfigs(selectedAgentId: string | null, reportError: (message: string) => void) {
  const [configs, setConfigs] = useState<AgentLaunchConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const selectedAgentIdRef = useRef(selectedAgentId);
  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  const applyConfigs = useCallback((agentId: string, next: AgentLaunchConfig[]) => {
    if (agentId !== selectedAgentIdRef.current) return;
    setConfigs(next);
    setSelectedConfigId((current) => {
      if (current && next.some((config) => config.id === current)) return current;
      return next.find((config) => config.isDefault)?.id ?? next[0]?.id ?? null;
    });
  }, []);

  const refreshConfigs = useCallback(async () => {
    if (!selectedAgentId) return;
    const agentId = selectedAgentId;
    const data = await endpoints.agentLaunchConfigs(agentId);
    applyConfigs(agentId, data.agentLaunchConfigs);
  }, [applyConfigs, selectedAgentId]);

  const clearConfigs = useCallback(() => {
    setConfigs([]);
    setSelectedConfigId(null);
  }, []);

  const createConfig = useCallback(
    async (input: AgentLaunchConfigInput) => {
      try {
        const { agentLaunchConfig } = await createAgentLaunchConfig(input);
        await refreshConfigs();
        setSelectedConfigId(agentLaunchConfig.id);
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      }
    },
    [refreshConfigs, reportError],
  );

  const updateConfig = useCallback(
    async (id: string, input: Partial<AgentLaunchConfigInput>) => {
      try {
        await updateAgentLaunchConfig(id, input);
        await refreshConfigs();
        setSelectedConfigId(id);
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      }
    },
    [refreshConfigs, reportError],
  );

  const deleteConfig = useCallback(
    async (id: string) => {
      try {
        await deleteAgentLaunchConfig(id);
        await refreshConfigs();
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      }
    },
    [refreshConfigs, reportError],
  );

  return {
    configs,
    selectedConfigId,
    setSelectedConfigId,
    clearConfigs,
    refreshConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
  };
}
