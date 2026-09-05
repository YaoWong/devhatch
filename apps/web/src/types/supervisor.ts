export type SupervisorState =
  | "unsupported"
  | "unavailable"
  | "foreign"
  | "handoffPending"
  | "restartPending"
  | "overwriteRequired"
  | "active"
  | "enabled"
  | "installed"
  | "notInstalled";

export type SupervisorStatus = {
  supported: boolean;
  available: boolean;
  installed: boolean;
  managed: boolean;
  enabled: boolean;
  active: boolean;
  currentProcessManaged: boolean;
  handoffPending: boolean;
  restartPending: boolean;
  overwriteRequired: boolean;
  state: SupervisorState;
  unitName: string;
  unitPath: string;
  installRoot: string;
  byteApiKeyFile: string | null;
  lingerEnabled: boolean;
};

export type SupervisorInstallRequest = {
  byteApiKeyFile: string;
  overwrite: boolean;
};
