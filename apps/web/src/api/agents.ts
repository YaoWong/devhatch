import type {
  Agent,
  AgentLaunchConfig,
  AgentLaunchConfigInput,
  AgentLaunchPath,
  AgentSession,
  AgentWorkspace,
  AgentWorkspaceSnapshot,
  HistoryResponse,
} from "../types/agents";
import { requestEmpty, requestJson } from "./client";

export function agents() {
  return requestJson<{ agents: Agent[] }>("/api/agents");
}

export function agentPaths() {
  return requestJson<{ agentLaunchPaths: AgentLaunchPath[] }>("/api/agent-launch-paths");
}

export function agentLaunchConfigs(agentId = "opencode") {
  return requestJson<{ agentLaunchConfigs: AgentLaunchConfig[] }>(
    `/api/agent-launch-configs?agentId=${encodeURIComponent(agentId)}`,
  );
}

export function agentWorkspaces() {
  return requestJson<AgentWorkspaceSnapshot>("/api/agent-workspaces");
}

export function createAgentWorkspace(options: { name?: string | null; agentSessionIds: string[] }) {
  return requestJson<{ agentWorkspace: AgentWorkspace }>(
    "/api/agent-workspaces",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options) },
    "Unable to create agent workspace",
  );
}

export function updateAgentWorkspace(id: string, update: { name?: string | null; activeAgentSessionId?: string | null }) {
  return requestJson<{ agentWorkspace: AgentWorkspace }>(
    `/api/agent-workspaces/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(update) },
    "Unable to update agent workspace",
  );
}

export function deleteAgentWorkspace(id: string) {
  return requestEmpty(`/api/agent-workspaces/${id}`, { method: "DELETE" }, "Unable to disband agent workspace");
}

export function history(agentId: string) {
  return requestJson<HistoryResponse>(`/api/agents/${encodeURIComponent(agentId)}/history`);
}

export function createAgentSession(options: {
  agentId: string;
  cwd?: string;
  upstreamSessionId?: string;
  launchConfigId?: string;
  skillProfileId?: string;
  workspaceId?: string | null;
}) {
  return requestJson<{ agentSession: AgentSession; agentWorkspace: AgentWorkspace }>(
    "/api/agent-sessions",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options) },
    "Unable to launch agent session",
  );
}

export function pasteAgentImage(id: string, image: Blob) {
  return requestEmpty(
    `/api/agent-sessions/${encodeURIComponent(id)}/image-paste`,
    { method: "POST", headers: { "content-type": image.type }, body: image },
    "Unable to paste image",
  );
}

export function createAgentLaunchConfig(input: AgentLaunchConfigInput) {
  return requestJson<{ agentLaunchConfig: AgentLaunchConfig }>(
    "/api/agent-launch-configs",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to create launch config",
  );
}

export function updateAgentLaunchConfig(id: string, input: Partial<AgentLaunchConfigInput>) {
  return requestJson<{ agentLaunchConfig: AgentLaunchConfig }>(
    `/api/agent-launch-configs/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to update launch config",
  );
}

export function deleteAgentLaunchConfig(id: string) {
  return requestEmpty(`/api/agent-launch-configs/${id}`, { method: "DELETE" }, "Unable to delete launch config");
}

export function createAgentLaunchPath(options: { path: string; alias: null; pinned: false }) {
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

export function deleteAgentLaunchPath(id: string) {
  return requestEmpty(`/api/agent-launch-paths/${id}`, { method: "DELETE" }, "Unable to delete path");
}

export function deleteAgentHistorySession(agentId: string, id: string) {
  return requestEmpty(
    `/api/agents/${encodeURIComponent(agentId)}/history/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Unable to delete agent session",
  );
}
