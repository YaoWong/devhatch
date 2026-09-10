import type { AgentSession } from "../types/agents";
import type { Workspace } from "../types/workspaces";
import type {
  DirectoryListing,
  TerminalInfo,
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

export function listDirectories(directory?: string) {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  return requestJson<DirectoryListing>(`/api/filesystem/directories${query}`, undefined, "Unable to open this folder");
}

export function createTerminal(cwd?: string, workspaceId?: string | null) {
  return requestJson<{ terminal: TerminalInfo; workspace: Workspace }>(
    "/api/terminals",
    { method: "POST", ...json({ cwd, workspaceId }) },
    "Unable to create terminal session",
  );
}

export function renameRemoteSession(route: string, id: string, name: string) {
  return requestJson<Record<string, TerminalInfo | AgentSession>>(
    `${route}/${encodeURIComponent(id)}`,
    { method: "PATCH", ...json({ name }) },
    "Unable to rename session",
  );
}

export function deleteTerminalSession(id: string) {
  return requestJson<{ workspace: Workspace | null }>(
    `/api/terminals/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Unable to close session",
  );
}

export function deleteRemoteSession(route: string, id: string) {
  return requestEmpty(`${route}/${encodeURIComponent(id)}`, { method: "DELETE" }, "Unable to close session", true);
}
