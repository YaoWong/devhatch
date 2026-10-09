import { displayPath, logicalPath } from "../../shared/lib/utils";

export const AGENT_HISTORY_RELATIVE_PATHS_KEY = "devhatch-agent-history-relative-paths";

function normalizePath(value: string, home?: string, resolvedHome?: string) {
  const logical = logicalPath(value, home, resolvedHome);
  return logical.length > 1 ? logical.replace(/\/+$/, "") : logical;
}

export function displayAgentHistoryPath(
  value: string,
  selectedPath: string | null,
  relativePaths: boolean,
  home?: string,
  resolvedHome?: string,
) {
  if (!relativePaths || !selectedPath) return displayPath(value, home, resolvedHome);

  const candidate = normalizePath(value, home, resolvedHome);
  const selected = normalizePath(selectedPath, home, resolvedHome);
  if (candidate === selected) return ".";

  const prefix = selected === "/" ? "/" : `${selected}/`;
  return candidate.startsWith(prefix)
    ? candidate.slice(prefix.length)
    : displayPath(value, home, resolvedHome);
}

export function readAgentHistoryRelativePaths(storage?: Pick<Storage, "getItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return target?.getItem(AGENT_HISTORY_RELATIVE_PATHS_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeAgentHistoryRelativePaths(
  enabled: boolean,
  storage?: Pick<Storage, "setItem"> | null,
) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem(AGENT_HISTORY_RELATIVE_PATHS_KEY, enabled ? "1" : "0");
  } catch {
    return;
  }
}
