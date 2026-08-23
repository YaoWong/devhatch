import { useCallback, useState } from "react";
import { createAgentLaunchConfig, deleteAgentLaunchConfig, endpoints, updateAgentLaunchConfig } from "../../api";
import type { AgentLaunchConfig, AgentLaunchConfigInput } from "../../types";
import { errorMessage } from "./shared";

export function useAgentConfigs(reportError: (message: string) => void) {
  const [configs, setConfigs] = useState<AgentLaunchConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  const applyConfigs = useCallback((next: AgentLaunchConfig[]) => {
    setConfigs(next);
    setSelectedConfigId((current) => {
      if (current && next.some((config) => config.id === current)) return current;
      return next.find((config) => config.isDefault)?.id ?? next[0]?.id ?? null;
    });
  }, []);

  const refreshConfigs = useCallback(async () => {
    const data = await endpoints.agentLaunchConfigs("opencode");
    applyConfigs(data.agentLaunchConfigs);
  }, [applyConfigs]);

  const initializeConfigs = useCallback(
    (data: Awaited<ReturnType<typeof endpoints.agentLaunchConfigs>>) => applyConfigs(data.agentLaunchConfigs),
    [applyConfigs],
  );

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
    refreshConfigs,
    initializeConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
  };
}
