export type TerminalInfo = {
  id: string;
  name: string;
  cwd: string;
  shell: string;
  status: "running" | "exited";
  cols: number;
  rows: number;
  createdAt: number;
  updatedAt: number;
  exitCode: number | null;
};

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
export type HistorySession = {
  id: string;
  title: string;
  directory: string;
  projectId: string;
  projectName: string | null;
  projectWorktree: string | null;
  timeCreated: number;
  timeUpdated: number;
  presence: "active-here" | "possibly-active-elsewhere" | "inactive";
};
export type HistoryResponse = { available: boolean; diagnostic: string | null; sessions: HistorySession[] };
export type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
};
export type ConnectionPhase = "connecting" | "connected" | "reconnecting" | "disconnected" | "exited";
export type DetailMode = "terminal" | "agent" | "settings";
export type RailPage = "modes" | DetailMode;
export type WorkspaceMode = DetailMode;
export type RailMotion = "forward" | "return" | null;
export type DirectoryListing = {
  path: string;
  parent: string | null;
  home: string;
  resolvedHome: string;
  directories: { name: string; path: string }[];
};
export type DeleteTarget = { id: string; name: string; cwd: string; kind: "terminal" | "agent session" };
