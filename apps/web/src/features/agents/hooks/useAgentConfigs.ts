import { useCallback, useEffect, useRef, useState } from "react";
import { createLaunchConfig, deleteLaunchConfig, launchConfigs, updateLaunchConfig } from "../../../api/agents";
import type { LaunchConfig, LaunchConfigInput } from "../../../types/agents";
import { readLaunchConfigId, writeLaunchConfigId } from "../launchSetupPreference";
import { errorMessage } from "./shared";

type ConfigState = {
  targetId: string | null;
  configs: LaunchConfig[];
  selectedConfigId: string | null;
  loading: boolean;
};

const emptyState: ConfigState = { targetId: null, configs: [], selectedConfigId: null, loading: false };

export function launchConfigSelection(configs: LaunchConfig[], preferred: string | null) {
  if (preferred && configs.some((config) => config.id === preferred)) return preferred;
  return configs.find((config) => config.isDefault)?.id ?? configs[0]?.id ?? null;
}

export function useLaunchConfigs(targetId: string | null, reportError: (message: string) => void) {
  const [state, setState] = useState<ConfigState>(emptyState);
  const targetIdRef = useRef(targetId);
  const requestGenerationsRef = useRef(new Map<string, number>());
  const selectionsRef = useRef(new Map<string, string>());
  targetIdRef.current = targetId;

  const applyConfigs = useCallback((target: string, next: LaunchConfig[]) => {
    if (target !== targetIdRef.current) return;
    setState((current) => {
      const preferred = selectionsRef.current.get(target)
        ?? readLaunchConfigId(target)
        ?? (current.targetId === target ? current.selectedConfigId : null);
      const selectedConfigId = launchConfigSelection(next, preferred);
      if (selectedConfigId) {
        selectionsRef.current.set(target, selectedConfigId);
        writeLaunchConfigId(target, selectedConfigId);
      }
      return { targetId: target, configs: next, selectedConfigId, loading: false };
    });
  }, []);

  const refreshConfigs = useCallback(async () => {
    if (!targetId) return;
    const target = targetId;
    const generation = (requestGenerationsRef.current.get(target) ?? 0) + 1;
    requestGenerationsRef.current.set(target, generation);
    try {
      const data = await launchConfigs(target);
      if (generation !== requestGenerationsRef.current.get(target)) return;
      applyConfigs(target, data.agentLaunchConfigs);
    } catch (reason) {
      if (generation !== requestGenerationsRef.current.get(target) || target !== targetIdRef.current) return;
      throw reason;
    }
  }, [applyConfigs, targetId]);

  useEffect(() => {
    if (!targetId) {
      setState(emptyState);
      return;
    }
    setState({ targetId, configs: [], selectedConfigId: null, loading: true });
    void refreshConfigs().catch((reason) => {
      if (targetIdRef.current !== targetId) return;
      setState({ targetId, configs: [], selectedConfigId: null, loading: false });
      reportError(errorMessage(reason));
    });
  }, [refreshConfigs, reportError, targetId]);

  const setSelectedConfigId = useCallback((id: string) => {
    const target = targetIdRef.current;
    if (!target) return;
    selectionsRef.current.set(target, id);
    writeLaunchConfigId(target, id);
    setState((current) => current.targetId === target ? { ...current, selectedConfigId: id } : current);
  }, []);

  const createConfig = useCallback(async (input: LaunchConfigInput) => {
    const target = targetId;
    if (!target || input.agentId !== target) return false;
    try {
      const { agentLaunchConfig } = await createLaunchConfig(input);
      selectionsRef.current.set(target, agentLaunchConfig.id);
      writeLaunchConfigId(target, agentLaunchConfig.id);
      await refreshConfigs();
      return true;
    } catch (reason) {
      reportError(errorMessage(reason));
      return false;
    }
  }, [refreshConfigs, reportError, targetId]);

  const updateConfig = useCallback(async (id: string, input: Partial<LaunchConfigInput>) => {
    const target = targetId;
    if (!target || input.agentId !== target) return false;
    try {
      await updateLaunchConfig(id, input);
      selectionsRef.current.set(target, id);
      writeLaunchConfigId(target, id);
      await refreshConfigs();
      return true;
    } catch (reason) {
      reportError(errorMessage(reason));
      return false;
    }
  }, [refreshConfigs, reportError, targetId]);

  const deleteConfig = useCallback(async (id: string) => {
    try {
      await deleteLaunchConfig(id);
      await refreshConfigs();
      return true;
    } catch (reason) {
      reportError(errorMessage(reason));
      return false;
    }
  }, [refreshConfigs, reportError]);

  const current = state.targetId === targetId ? state : { ...emptyState, loading: Boolean(targetId) };
  return {
    configs: current.configs,
    selectedConfigId: current.selectedConfigId,
    loading: current.loading,
    setSelectedConfigId,
    refreshConfigs,
    createConfig,
    updateConfig,
    deleteConfig,
  };
}

export const useAgentConfigs = useLaunchConfigs;
