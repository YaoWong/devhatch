import type { Agent, AgentLaunchConfig, AgentLaunchPath, AgentSession, HistoryResponse, TerminalInfo, WebApp } from "../types";
import { requestJson } from "./client";

export const endpoints = {
  webApps: () => requestJson<{ webApps: WebApp[] }>("/api/web-apps"),
  agents: () => requestJson<{ agents: Agent[] }>("/api/agents"),
  agentPaths: () => requestJson<{ agentLaunchPaths: AgentLaunchPath[] }>("/api/agent-launch-paths"),
  agentLaunchConfigs: (agentId = "opencode") =>
    requestJson<{ agentLaunchConfigs: AgentLaunchConfig[] }>(
      `/api/agent-launch-configs?agentId=${encodeURIComponent(agentId)}`,
    ),
  agentSessions: () => requestJson<{ agentSessions: AgentSession[] }>("/api/agent-sessions"),
  history: (agentId: string) =>
    requestJson<HistoryResponse>(`/api/agents/${encodeURIComponent(agentId)}/history`),
  terminals: () =>
    requestJson<{ terminals: TerminalInfo[]; home: string; resolvedHome: string }>(
      "/api/terminals",
      undefined,
      "Unable to load terminal sessions",
    ),
};
