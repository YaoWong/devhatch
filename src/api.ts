import type { Agent, AgentLaunchPath, AgentSession, DirectoryListing, HistoryResponse, TerminalInfo } from "./types";

export async function requestJson<T>(url: string, options?: RequestInit, fallback = "Request failed") {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || fallback);
  }
  return response.json() as Promise<T>;
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

export function createAgentSession(options: { cwd?: string; upstreamSessionId?: string }) {
  return requestJson<{ agentSession: AgentSession }>(
    "/api/agent-sessions",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options) },
    "Unable to launch agent session",
  );
}

export function createAgentLaunchPath(options: { agentId: string | null; path: string; alias: null; pinned: false }) {
  return requestJson<{ agentLaunchPath: AgentLaunchPath }>(
    "/api/agent-launch-paths",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options) },
    "Unable to create launch path",
  );
}

export function updateAgentLaunchPath(id: string, update: { alias?: string | null; pinned?: boolean }) {
  return requestJson<{ agentLaunchPath: AgentLaunchPath }>(
    `/api/agent-launch-paths/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update) },
    "Unable to update launch path",
  );
}

export function touchAgentLaunchPath(id: string) {
  return requestJson<unknown>(`/api/agent-launch-paths/${id}/touch`, { method: "POST" });
}

export async function deleteAgentLaunchPath(id: string) {
  const response = await fetch(`/api/agent-launch-paths/${id}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Unable to delete path");
}

export async function deleteOpenCodeHistorySession(id: string) {
  const response = await fetch(`/api/agents/opencode/history/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
    } | null;
    throw new Error(payload?.message || payload?.error || "Unable to delete OpenCode session");
  }
}

export function renameRemoteSession(route: string, id: string, name: string) {
  return requestJson<Record<string, TerminalInfo | AgentSession>>(
    `${route}/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) },
    "Unable to rename session",
  );
}

export async function deleteRemoteSession(route: string, id: string) {
  const response = await fetch(`${route}/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error("Unable to close session");
}

export const endpoints = {
  agents: () => requestJson<{ agents: Agent[] }>("/api/agents"),
  agentPaths: () => requestJson<{ agentLaunchPaths: AgentLaunchPath[] }>("/api/agent-launch-paths"),
  agentSessions: () => requestJson<{ agentSessions: AgentSession[] }>("/api/agent-sessions"),
  history: () => requestJson<HistoryResponse>("/api/agents/opencode/history"),
  terminals: () =>
    requestJson<{ terminals: TerminalInfo[]; home: string; resolvedHome: string }>(
      "/api/terminals",
      undefined,
      "Unable to load terminal sessions",
    ),
};
