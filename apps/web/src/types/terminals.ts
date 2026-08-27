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

export type TerminalWorkspace = {
  id: string;
  path: string;
  pinned: boolean;
  lastUsedAt: number;
  createdAt: number;
  updatedAt: number;
};

export type ConnectionPhase = "connecting" | "connected" | "reconnecting" | "disconnected" | "exited";
export type DirectoryListing = {
  path: string;
  parent: string | null;
  home: string;
  resolvedHome: string;
  directories: { name: string; path: string }[];
};
