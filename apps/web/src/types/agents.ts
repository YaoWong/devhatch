import type { TerminalInfo } from "./terminals";

export type AgentSession = TerminalInfo & {
  agentId: string;
  agentName: string;
  kind: string;
  upstreamSessionId?: string;
};

export type Agent = {
  id: string;
  name: string;
  kind: string;
  available: boolean;
  enabled: boolean;
  availability: "available" | "unavailable" | "coming-soon";
  version?: string | null;
  diagnostic?: string | null;
  launchConfigCount: number;
  defaultLaunchConfigId: string | null;
  supportsHistory: boolean;
  supportsResume: boolean;
  supportsSkills: boolean;
};

export type AgentLaunchPath = {
  id: string;
  agentId: string;
  path: string;
  alias: string | null;
  pinned: boolean;
  lastUsedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type AgentLaunchConfig = {
  id: string;
  agentId: string;
  name: string;
  isDefault: boolean;
  preLaunchScript: string;
  providerScript: string;
  tuiScript: string;
  createdAt: number;
  updatedAt: number;
};

export type AgentLaunchConfigInput = Pick<
  AgentLaunchConfig,
  "agentId" | "name" | "isDefault" | "preLaunchScript" | "providerScript" | "tuiScript"
>;
export type HistorySession = {
  id: string;
  title: string;
  directory: string;
  projectId: string | null;
  projectName: string | null;
  projectWorktree: string | null;
  timeCreated: number;
  timeUpdated: number;
  presence: "active-here" | "possibly-active-elsewhere" | "inactive";
};
export type HistoryResponse = { available: boolean; diagnostic: string | null; sessions: HistorySession[] };
