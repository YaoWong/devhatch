import type { AgentSession } from "../types/agents";
import type { DirectoryListing, TerminalInfo, TerminalWorkspace } from "../types/terminals";
import { requestEmpty, requestJson } from "./client";

export function terminals() {
  return requestJson<{ terminals: TerminalInfo[]; home: string; resolvedHome: string }>(
    "/api/terminals",
    undefined,
    "Unable to load terminal sessions",
  );
}

export function terminalWorkspaces() {
  return requestJson<{ terminalWorkspaces: TerminalWorkspace[] }>(
    "/api/terminal-workspaces",
    undefined,
    "Unable to load terminal workspaces",
  );
}

export function listDirectories(directory?: string) {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  return requestJson<DirectoryListing>(`/api/filesystem/directories${query}`, undefined, "Unable to open this folder");
}

export function createTerminal(cwd?: string) {
  return requestJson<{ terminal: TerminalInfo }>(
    "/api/terminals",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd }) },
    "Unable to create terminal session",
  );
}

export function createTerminalWorkspace(path: string) {
  return requestJson<{ terminalWorkspace: TerminalWorkspace }>(
    "/api/terminal-workspaces",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) },
    "Unable to add terminal workspace",
  );
}

export function updateTerminalWorkspace(id: string, pinned: boolean) {
  return requestJson<{ terminalWorkspace: TerminalWorkspace }>(
    `/api/terminal-workspaces/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pinned }) },
    "Unable to update terminal workspace",
  );
}

export function deleteTerminalWorkspace(id: string) {
  return requestEmpty(`/api/terminal-workspaces/${id}`, { method: "DELETE" }, "Unable to remove terminal workspace");
}

export function renameRemoteSession(route: string, id: string, name: string) {
  return requestJson<Record<string, TerminalInfo | AgentSession>>(
    `${route}/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
    "Unable to rename session",
  );
}

export function deleteRemoteSession(route: string, id: string) {
  return requestEmpty(`${route}/${id}`, { method: "DELETE" }, "Unable to close session", true);
}
