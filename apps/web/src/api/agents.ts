import type { AgentLaunchConfig, AgentLaunchConfigInput, AgentLaunchPath, AgentSession } from "../types";
import { requestEmpty, requestJson } from "./client";

export function createAgentSession(options: {
  agentId: string;
  cwd?: string;
  upstreamSessionId?: string;
  launchConfigId?: string;
  skillProfileId?: string;
}) {
  return requestJson<{ agentSession: AgentSession }>(
    "/api/agent-sessions",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(options) },
    "Unable to launch agent session",
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
