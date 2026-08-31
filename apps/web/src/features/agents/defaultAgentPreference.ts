export const DEFAULT_AGENT_ID_KEY = "devhatch-default-agent-id";

export function readDefaultAgentId(storage?: Pick<Storage, "getItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return target?.getItem(DEFAULT_AGENT_ID_KEY) || null;
  } catch {
    return null;
  }
}

export function writeDefaultAgentId(agentId: string, storage?: Pick<Storage, "setItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem(DEFAULT_AGENT_ID_KEY, agentId);
  } catch {
    return;
  }
}
