import type { TerminalInfo } from "./terminals";

export type AgentSession = Omit<TerminalInfo, "kind"> & {
  kind: "agent";
  agentId: string;
  agentName: string;
  upstreamSessionId?: string;
};

export type Agent = {
  id: string;
  name: string;
  kind: string;
  available: boolean;
  enabled: boolean;
  availability: "available" | "unavailable" | "coming-soon";
  installable: boolean;
  version?: string | null;
  diagnostic?: string | null;
  launchConfigCount: number;
  defaultLaunchConfigId: string | null;
  supportsHistory: boolean;
  supportsResume: boolean;
  supportsSkills: boolean;
  supportsImagePaste: boolean;
};

export type AgentInstall = {
  agentId: string;
  version: string;
};

export type LaunchConfig = {
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

export type LaunchConfigInput = Pick<
  LaunchConfig,
  "agentId" | "name" | "isDefault" | "preLaunchScript" | "providerScript" | "tuiScript"
>;

export type AgentLaunchConfig = LaunchConfig;
export type AgentLaunchConfigInput = LaunchConfigInput;
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
