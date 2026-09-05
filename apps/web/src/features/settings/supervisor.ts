import type { SupervisorState, SupervisorStatus } from "../../types/supervisor";

const statusLabels: Record<SupervisorState, string> = {
  unsupported: "Unsupported",
  unavailable: "Unavailable",
  foreign: "Existing systemd service",
  handoffPending: "Starting supervisor",
  restartPending: "Restarting supervisor",
  overwriteRequired: "Update required",
  active: "Active",
  enabled: "Enabled",
  installed: "Installed",
  notInstalled: "Not installed",
};

export type SupervisorPollDecision = "continue" | "ready" | "terminal";

export type SupervisorErrorGuidance = {
  kind: "overwrite" | "path" | "section";
  message: string;
  retry: "install" | "load";
};

export function supervisorStatusLabel(status: SupervisorStatus) {
  return statusLabels[status.state];
}

export function supervisorAction(status: SupervisorStatus): { label: string; overwrite: boolean } | null {
  if (
    !status.supported
    || !status.available
    || status.state === "foreign"
    || status.handoffPending
    || status.restartPending
    || (status.active && !status.currentProcessManaged)
  ) return null;
  if (status.overwriteRequired || status.state === "overwriteRequired") return { label: "Overwrite and update", overwrite: true };
  if (status.installed || status.managed) return { label: "Update supervisor", overwrite: false };
  return { label: "Install supervisor", overwrite: false };
}

export function validateByteApiKeyFile(value: string) {
  const path = value.trim();
  if (!path) return "Enter the Byte API key file path.";
  if (!path.startsWith("/")) return "Enter an absolute file path starting with /.";
  return null;
}

export function isRestartReady(status: SupervisorStatus) {
  return status.supported
    && status.available
    && status.managed
    && status.active
    && status.currentProcessManaged
    && !status.handoffPending
    && !status.restartPending;
}

export function supervisorPollDecision(status: SupervisorStatus): SupervisorPollDecision {
  if (isRestartReady(status)) return "ready";
  if (
    !status.supported
    || !status.available
    || status.state === "foreign"
    || (status.active && !status.currentProcessManaged)
    || (!status.handoffPending && !status.restartPending && (status.overwriteRequired || status.state === "overwriteRequired"))
  ) return "terminal";
  return "continue";
}

export function supervisorPollTerminalMessage(status: SupervisorStatus) {
  if (!status.supported) return "Supervisor setup is no longer supported on this host. Refresh status to check again.";
  if (!status.available) return "The user-level systemd manager became unavailable. Check the host service and refresh status.";
  if (status.state === "foreign") return "An unmanaged systemd service or installation was detected. Resolve it on the host, then refresh status.";
  if (status.active && !status.currentProcessManaged) return "Another process is active under the user service. Refresh status before trying again.";
  return "Managed supervisor files now require explicit overwrite confirmation. Refresh status to continue.";
}

export function supervisorErrorGuidance(status: number, code: string | null, fallback: string): SupervisorErrorGuidance {
  if (status === 409 && code === "SUPERVISOR_OVERWRITE_REQUIRED") {
    return {
      kind: "overwrite",
      message: "Managed supervisor files require explicit overwrite confirmation.",
      retry: "install",
    };
  }
  if (code === "INVALID_BYTE_API_KEY_FILE") {
    return {
      kind: "path",
      message: "The key file must exist and be a regular, non-symlink file owned by the server user with private permissions (0600 or stricter).",
      retry: "install",
    };
  }
  if (code === "SUPERVISOR_FOREIGN_UNIT" || code === "SUPERVISOR_FOREIGN_INSTALL") {
    return {
      kind: "section",
      message: "An unmanaged systemd service or installation already exists. Resolve it on the host, then refresh status.",
      retry: "load",
    };
  }
  if (code === "SUPERVISOR_ACTIVE_PROCESS") {
    return {
      kind: "section",
      message: "Another process is active under the user service. Refresh status before trying again.",
      retry: "load",
    };
  }
  if (code === "SUPERVISOR_UNAVAILABLE") {
    return {
      kind: "section",
      message: "A user-level systemd manager is unavailable. Check the host service, then refresh status.",
      retry: "load",
    };
  }
  if (code === "SUPERVISOR_OPERATION_IN_PROGRESS" || code === "SUPERVISOR_HANDOFF_IN_PROGRESS") {
    return {
      kind: "section",
      message: "Another supervisor operation is in progress. Wait a moment, then refresh status.",
      retry: "load",
    };
  }
  if (code === "WEB_DIST_UNAVAILABLE") {
    return {
      kind: "section",
      message: "The DevHatch web release is unavailable. Start DevHatch from a complete build, then try again.",
      retry: "install",
    };
  }
  if (code === "SUPERVISOR_INSTALL_FAILED") {
    return {
      kind: "section",
      message: "The supervisor installation failed. Refresh status, check the host service, and try again.",
      retry: "load",
    };
  }
  if (code === "INVALID_REQUEST") {
    return {
      kind: "section",
      message: "The supervisor request was invalid. Review the key file path and try again.",
      retry: "install",
    };
  }
  const message = fallback && !/^[A-Z][A-Z0-9_]+$/.test(fallback)
    ? fallback
    : "The supervisor request failed. Refresh status and try again.";
  return { kind: "section", message, retry: "install" };
}

export function supervisorPollRequestTimeout(remainingMs: number) {
  return Math.max(0, Math.min(5_000, remainingMs));
}
