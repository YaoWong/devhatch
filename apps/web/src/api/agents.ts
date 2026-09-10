import type {
  Agent,
  AgentInstall,
  LaunchConfig,
  LaunchConfigInput,
  AgentSession,
  HistoryResponse,
} from "../types/agents";
import type { Workspace } from "../types/workspaces";
import { requestEmpty, requestJson } from "./client";

export function agents() {
  return requestJson<{ agents: Agent[] }>("/api/agents");
}

export function installAgent(agentId: string) {
  return requestJson<{ agentInstall: AgentInstall }>(
    `/api/agents/${encodeURIComponent(agentId)}/install`,
    { method: "POST" },
    "Unable to install Agent CLI",
  );
}

export function launchConfigs(targetId: string) {
  return requestJson<{ agentLaunchConfigs: LaunchConfig[] }>(
    `/api/agent-launch-configs?agentId=${encodeURIComponent(targetId)}`,
  );
}

export function agentLaunchConfigs(agentId = "opencode") {
  return launchConfigs(agentId);
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
  return requestJson<{ agentSession: AgentSession; workspace: Workspace }>(
    "/api/agent-sessions",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options) },
    "Unable to launch agent session",
  );
}

export function pasteAgentImage(id: string, image: Blob, signal?: AbortSignal) {
  return requestEmpty(
    `/api/agent-sessions/${encodeURIComponent(id)}/image-paste`,
    { method: "POST", headers: { "content-type": image.type }, body: image, signal },
    "Unable to paste image",
  );
}

export function createLaunchConfig(input: LaunchConfigInput) {
  return requestJson<{ agentLaunchConfig: LaunchConfig }>(
    "/api/agent-launch-configs",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to create launch config",
  );
}

export function updateLaunchConfig(id: string, input: Partial<LaunchConfigInput>) {
  return requestJson<{ agentLaunchConfig: LaunchConfig }>(
    `/api/agent-launch-configs/${id}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to update launch config",
  );
}

export function deleteLaunchConfig(id: string) {
  return requestEmpty(`/api/agent-launch-configs/${id}`, { method: "DELETE" }, "Unable to delete launch config");
}

export const createAgentLaunchConfig = createLaunchConfig;
export const updateAgentLaunchConfig = updateLaunchConfig;
export const deleteAgentLaunchConfig = deleteLaunchConfig;

export function deleteAgentHistorySession(agentId: string, id: string) {
  return requestEmpty(
    `/api/agents/${encodeURIComponent(agentId)}/history/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Unable to delete agent session",
  );
}
