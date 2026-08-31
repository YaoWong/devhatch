import type { AgentSession } from "../types/agents";
import type {
  DirectoryListing,
  TerminalInfo,
  TerminalLaunchPath,
  TerminalWorkspace,
} from "../types/terminals";
import { requestEmpty, requestJson } from "./client";

const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function terminals() {
  return requestJson<{ terminals: TerminalInfo[]; home: string; resolvedHome: string }>(
    "/api/terminals",
    undefined,
    "Unable to load terminal sessions",
  );
}

export function terminalLaunchPaths() {
  return requestJson<{ terminalLaunchPaths: TerminalLaunchPath[] }>(
    "/api/terminal-launch-paths",
    undefined,
    "Unable to load terminal launch paths",
  );
}

export function terminalWorkspaces() {
  return requestJson<{ terminalWorkspaces: TerminalWorkspace[] }>(
    "/api/terminal-workspaces",
    undefined,
    "Unable to load terminal workspaces",
  );
}

export function createTerminalWorkspace() {
  return requestJson<{ terminalWorkspace: TerminalWorkspace }>(
    "/api/terminal-workspaces",
    { method: "POST", ...json({ terminalIds: [] }) },
    "Unable to create terminal workspace",
  );
}

export function listDirectories(directory?: string) {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  return requestJson<DirectoryListing>(`/api/filesystem/directories${query}`, undefined, "Unable to open this folder");
}

export function createTerminal(cwd?: string, workspaceId?: string) {
  return requestJson<{ terminal: TerminalInfo; terminalWorkspace: TerminalWorkspace }>(
    "/api/terminals",
    { method: "POST", ...json({ cwd, workspaceId }) },
    "Unable to create terminal session",
  );
}

export function createTerminalLaunchPath(path: string) {
  return requestJson<{ terminalLaunchPath: TerminalLaunchPath }>(
    "/api/terminal-launch-paths",
    { method: "POST", ...json({ path }) },
    "Unable to add terminal launch path",
  );
}

export function updateTerminalLaunchPath(id: string, update: { pinned?: boolean; alias?: string | null }) {
  return requestJson<{ terminalLaunchPath: TerminalLaunchPath }>(
    `/api/terminal-launch-paths/${id}`,
    { method: "PATCH", ...json(update) },
    "Unable to update terminal launch path",
  );
}

export function deleteTerminalLaunchPath(id: string) {
  return requestEmpty(`/api/terminal-launch-paths/${id}`, { method: "DELETE" }, "Unable to remove terminal launch path");
}

export function updateTerminalWorkspace(id: string, update: { name?: string | null; activeTerminalId?: string }) {
  return requestJson<{ terminalWorkspace: TerminalWorkspace }>(
    `/api/terminal-workspaces/${id}`,
    { method: "PATCH", ...json(update) },
    "Unable to update terminal workspace",
  );
}

export function deleteTerminalWorkspace(id: string) {
  return requestEmpty(`/api/terminal-workspaces/${id}`, { method: "DELETE" }, "Unable to disband terminal workspace");
}

export function renameRemoteSession(route: string, id: string, name: string) {
  return requestJson<Record<string, TerminalInfo | AgentSession>>(
    `${route}/${id}`,
    { method: "PATCH", ...json({ name }) },
    "Unable to rename session",
  );
}

export function deleteTerminalSession(id: string) {
  return requestJson<{ terminalWorkspace: TerminalWorkspace | null }>(
    `/api/terminals/${id}`,
    { method: "DELETE" },
    "Unable to close session",
  );
}

export function deleteRemoteSession(route: string, id: string) {
  return requestEmpty(`${route}/${id}`, { method: "DELETE" }, "Unable to close session", true);
}
