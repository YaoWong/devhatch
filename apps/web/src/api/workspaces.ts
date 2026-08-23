import type { AgentSession, DirectoryListing, TerminalInfo } from "../types";
import { requestEmpty, requestJson } from "./client";

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
