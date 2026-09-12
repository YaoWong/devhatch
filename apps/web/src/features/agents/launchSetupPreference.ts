import type { Agent } from "../../types/agents";

export const TERMINAL_LAUNCH_TARGET_ID = "terminal";
export const LAUNCH_TARGET_ID_KEY = "devhatch-launch-target-id";
const LAUNCH_CONFIG_ID_PREFIX = "devhatch-launch-config-id:";

export function readStoredLaunchTargetId(storage?: Pick<Storage, "getItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return target?.getItem(LAUNCH_TARGET_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function readLaunchTargetId(storage?: Pick<Storage, "getItem"> | null) {
  return readStoredLaunchTargetId(storage) ?? TERMINAL_LAUNCH_TARGET_ID;
}

export function resolveInitialLaunchTargetId(
  agents: readonly Agent[],
  storedTargetId: string | null,
  defaultAgentId: string | null,
) {
  if (storedTargetId === TERMINAL_LAUNCH_TARGET_ID) return TERMINAL_LAUNCH_TARGET_ID;
  const storedAgent = agents.find((agent) => agent.id === storedTargetId);
  if (storedAgent?.enabled && storedAgent.availability !== "coming-soon") return storedAgent.id;
  const defaultAgent = agents.find((agent) => agent.id === defaultAgentId);
  return defaultAgent?.enabled && defaultAgent.available ? defaultAgent.id : TERMINAL_LAUNCH_TARGET_ID;
}

export function writeLaunchTargetId(targetId: string, storage?: Pick<Storage, "setItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem(LAUNCH_TARGET_ID_KEY, targetId);
  } catch {
    return;
  }
}

export function readLaunchConfigId(targetId: string, storage?: Pick<Storage, "getItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return target?.getItem(`${LAUNCH_CONFIG_ID_PREFIX}${targetId}`) || null;
  } catch {
    return null;
  }
}

export function writeLaunchConfigId(targetId: string, configId: string, storage?: Pick<Storage, "setItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem(`${LAUNCH_CONFIG_ID_PREFIX}${targetId}`, configId);
  } catch {
    return;
  }
}
