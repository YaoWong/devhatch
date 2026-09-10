export const TERMINAL_LAUNCH_TARGET_ID = "terminal";
export const LAUNCH_TARGET_ID_KEY = "devhatch-launch-target-id";
const LAUNCH_CONFIG_ID_PREFIX = "devhatch-launch-config-id:";

export function readLaunchTargetId(storage?: Pick<Storage, "getItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return target?.getItem(LAUNCH_TARGET_ID_KEY) || TERMINAL_LAUNCH_TARGET_ID;
  } catch {
    return TERMINAL_LAUNCH_TARGET_ID;
  }
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
