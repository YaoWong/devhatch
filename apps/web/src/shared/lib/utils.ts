import type { TerminalInfo } from "../../types/terminals";

export function formatUptime(createdAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function logicalPath(value: string, home?: string, resolvedHome?: string) {
  if (!home || !resolvedHome) return value;
  if (value === resolvedHome) return home;
  if (value.startsWith(`${resolvedHome}/`)) return `${home}${value.slice(resolvedHome.length)}`;
  return value;
}

export function displayPath(value: string, home?: string, resolvedHome?: string) {
  for (const root of [home, resolvedHome]) {
    if (!root) continue;
    if (value === root) return "~";
    if (value.startsWith(`${root}/`)) return `~${value.slice(root.length)}`;
  }
  return value;
}

export function pathMatches(
  candidate: string,
  selected: string,
  includeSubdirectories: boolean,
  home?: string,
  resolvedHome?: string,
) {
  const normalize = (value: string) => {
    const logical = logicalPath(value, home, resolvedHome);
    return logical.length > 1 ? logical.replace(/\/+$/, "") : logical;
  };
  const candidatePath = normalize(candidate);
  const selectedPath = normalize(selected);
  if (candidatePath === selectedPath) return true;
  if (!includeSubdirectories) return false;
  return selectedPath === "/" ? candidatePath.startsWith("/") : candidatePath.startsWith(`${selectedPath}/`);
}

export function workspaceName(workspace: string) {
  return workspace.split("/").filter(Boolean).pop() || workspace;
}

export function uniquePaths(sessions: TerminalInfo[]) {
  return [...new Set(sessions.map((session) => session.cwd))];
}
