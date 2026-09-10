import type { LaunchPath, Workspace, WorkspaceSessionRef, WorkspaceSnapshot } from "../types/workspaces";
import { requestEmpty, requestJson } from "./client";

const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function workspaces() {
  return requestJson<WorkspaceSnapshot>("/api/workspaces", undefined, "Unable to load workspaces");
}

export function launchPaths() {
  return requestJson<{ launchPaths: LaunchPath[] }>(
    "/api/launch-paths",
    undefined,
    "Unable to load launch paths",
  );
}

export function createLaunchPath(path: string) {
  return requestJson<{ launchPath: LaunchPath }>(
    "/api/launch-paths",
    { method: "POST", ...json({ path }) },
    "Unable to add launch path",
  );
}

export function updateLaunchPath(id: string, update: { pinned?: boolean; alias?: string | null }) {
  return requestJson<{ launchPath: LaunchPath }>(
    `/api/launch-paths/${encodeURIComponent(id)}`,
    { method: "PATCH", ...json(update) },
    "Unable to update launch path",
  );
}

export function deleteLaunchPath(id: string) {
  return requestEmpty(
    `/api/launch-paths/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Unable to remove launch path",
  );
}

export function createWorkspace(options: { name?: string | null; members?: WorkspaceSessionRef[] } = {}) {
  return requestJson<{ workspace: Workspace }>(
    "/api/workspaces",
    { method: "POST", ...json({ ...options, members: options.members ?? [] }) },
    "Unable to create workspace",
  );
}

export function updateWorkspace(
  id: string,
  update: { name?: string | null; activeSession?: WorkspaceSessionRef | null },
) {
  return requestJson<{ workspace: Workspace }>(
    `/api/workspaces/${encodeURIComponent(id)}`,
    { method: "PATCH", ...json(update) },
    "Unable to update workspace",
  );
}

export function deleteWorkspace(id: string) {
  return requestEmpty(
    `/api/workspaces/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Unable to delete workspace",
  );
}
