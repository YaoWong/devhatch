export type WebAppOperation = "install" | "update" | "check" | "start" | "stop";

export type WebApp = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  installing: boolean;
  updating: boolean;
  checkingForUpdate: boolean;
  operation: WebAppOperation | null;
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
