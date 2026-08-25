export type ThemeId = "default" | "latte" | "frappe" | "macchiato" | "mocha";
export type AppSettings = { theme: ThemeId; createdAt: number; updatedAt: number };

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
export type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
};
export type ConnectionPhase = "connecting" | "connected" | "reconnecting" | "disconnected" | "exited";
export type DetailMode = "terminal" | "agent" | "skills" | "webapp" | "settings";
export type RailPage = "modes" | DetailMode;
export type WorkspaceMode = DetailMode;
export type RailMotion = "forward" | "return" | null;
export type WebApp = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  installing: boolean;
  updating: boolean;
  checkingForUpdate: boolean;
  updateAvailable: boolean;
  progress: number;
  downloadedBytes: number | null;
  totalBytes: number | null;
  running: boolean;
  phase: "not-installed" | "preparing" | "downloading" | "installing" | "building" | "updating" | "installing-update" | "building-update" | "stopped" | "starting" | "running" | "failed";
  version: string | null;
  currentRevision: string | null;
  remoteRevision: string | null;
  latestVersion: string | null;
  url: string | null;
  installPath: string;
  error: string | null;
  prerequisites: { git: boolean; node24: boolean; corepack: boolean };
};
export type DirectoryListing = {
  path: string;
  parent: string | null;
  home: string;
  resolvedHome: string;
  directories: { name: string; path: string }[];
};
export type DeleteTarget = { id: string; name: string; cwd: string; kind: "terminal" | "agent session" };

export type SkillRepository = {
  id: string;
  name: string;
  url: string;
  gitRef: string | null;
  commitHash: string;
  syncVersion: number;
};
export type Skill = {
  id: string;
  slug: string;
  description: string;
  sourceType: string;
  repositoryId: string | null;
  revision: string | null;
  relativePath: string | null;
};
export type SkillProfile = { id: string; slug: string };
export type SkillProfileDetail = { profile: SkillProfile; skills: Skill[] };
export type SkillSyncItem = { id: string | null; slug: string; relativePath: string };
export type SkillSyncPlan = {
  repositoryId: string;
  oldCommit: string | null;
  newCommit: string;
  noop: boolean;
  add: SkillSyncItem[];
  update: SkillSyncItem[];
  remove: SkillSyncItem[];
};
export type SkillSyncResult = SkillSyncPlan;
