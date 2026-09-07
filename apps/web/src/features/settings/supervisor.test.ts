import { describe, expect, it } from "vitest";
import type { SupervisorStatus } from "../../types/supervisor";
import {
  isRestartReady,
  supervisorAction,
  supervisorErrorGuidance,
  supervisorPollDecision,
  supervisorPollRequestTimeout,
  supervisorStatusLabel,
  validateByteApiKeyFile,
} from "./supervisor";

const status = (patch: Partial<SupervisorStatus> = {}): SupervisorStatus => ({
  supported: true,
  available: true,
  installed: false,
  managed: false,
  enabled: false,
  active: false,
  currentProcessManaged: false,
  handoffPending: false,
  restartPending: false,
  overwriteRequired: false,
  state: "notInstalled",
  unitName: "devhatch.service",
  unitPath: "/home/dev/.config/systemd/user/devhatch.service",
  installRoot: "/home/dev/.local/lib/devhatch",
  byteApiKeyFile: null,
  lingerEnabled: true,
  ...patch,
});

describe("supervisor setup helpers", () => {
  it("labels every backend state", () => {
    expect([
      "unsupported",
      "unavailable",
      "foreign",
      "handoffPending",
      "restartPending",
      "overwriteRequired",
      "active",
      "enabled",
      "installed",
      "notInstalled",
    ].map((state) => supervisorStatusLabel(status({ state: state as SupervisorStatus["state"] })))).toEqual([
      "Unsupported",
      "Unavailable",
      "Existing systemd service",
      "Starting supervisor",
      "Restarting supervisor",
      "Update required",
      "Active",
      "Enabled",
      "Installed",
      "Not installed",
    ]);
  });

  it("selects install, update, and explicit overwrite actions", () => {
    expect(supervisorAction(status())).toEqual({ label: "Install supervisor", overwrite: false });
    expect(supervisorAction(status({ installed: true, managed: true, state: "installed" }))).toEqual({ label: "Update supervisor", overwrite: false });
    expect(supervisorAction(status({ installed: true, managed: true, overwriteRequired: true, state: "overwriteRequired" }))).toEqual({ label: "Overwrite and update", overwrite: true });
  });

  it("does not offer actions for unavailable, foreign, pending, or active unmanaged states", () => {
    expect(supervisorAction(status({ available: false, state: "unavailable" }))).toBeNull();
    expect(supervisorAction(status({ state: "foreign" }))).toBeNull();
    expect(supervisorAction(status({ restartPending: true, state: "restartPending" }))).toBeNull();
    expect(supervisorAction(status({ active: true, currentProcessManaged: false, state: "active" }))).toBeNull();
  });

  it("prevalidates blank and non-absolute-looking key paths", () => {
    expect(validateByteApiKeyFile("  ")).toBe("Enter the Byte API key file path.");
    expect(validateByteApiKeyFile("keys/byte-api")).toBe("Enter an absolute file path starting with /.");
    expect(validateByteApiKeyFile(" /home/dev/.keys/byte-api ")).toBeNull();
  });

  it("waits for a healthy managed process before reload", () => {
    expect(isRestartReady(status({ managed: true, active: true, currentProcessManaged: true }))).toBe(true);
    expect(isRestartReady(status({ managed: true, active: true, currentProcessManaged: true, handoffPending: true }))).toBe(false);
    expect(isRestartReady(status({ managed: true, active: true }))).toBe(false);
    expect(isRestartReady(status({ active: true, currentProcessManaged: true }))).toBe(false);
  });

  it("stops polling for terminal valid states", () => {
    expect(supervisorPollDecision(status({ managed: true, active: true, currentProcessManaged: true }))).toBe("ready");
    expect(supervisorPollDecision(status({ handoffPending: true, state: "handoffPending" }))).toBe("continue");
    expect(supervisorPollDecision(status({ state: "foreign" }))).toBe("terminal");
    expect(supervisorPollDecision(status({ supported: false, state: "unsupported" }))).toBe("terminal");
    expect(supervisorPollDecision(status({ available: false, state: "unavailable" }))).toBe("terminal");
    expect(supervisorPollDecision(status({ overwriteRequired: true, state: "overwriteRequired" }))).toBe("terminal");
    expect(supervisorPollDecision(status({ active: true, currentProcessManaged: false, state: "active" }))).toBe("terminal");
  });

  it("maps known errors to safe actions", () => {
    expect(supervisorErrorGuidance(400, "INVALID_BYTE_API_KEY_FILE", "INVALID_BYTE_API_KEY_FILE")).toEqual({
      kind: "path",
      message: "The key file must exist and be a regular, non-symlink file owned by the server user with private permissions (0600 or stricter).",
      retry: "install",
    });
    expect(supervisorErrorGuidance(409, "SUPERVISOR_ACTIVE_PROCESS", "SUPERVISOR_ACTIVE_PROCESS")).toEqual({
      kind: "section",
      message: "Another process is active under the user service. Refresh status before trying again.",
      retry: "load",
    });
    expect(supervisorErrorGuidance(503, "SUPERVISOR_UNAVAILABLE", "SUPERVISOR_UNAVAILABLE").message).not.toContain("SUPERVISOR_UNAVAILABLE");
    expect(supervisorErrorGuidance(500, null, "UNKNOWN_CODE").message).toBe("The supervisor request failed. Refresh status and try again.");
  });

  it("bounds poll requests by the remaining deadline", () => {
    expect(supervisorPollRequestTimeout(10_000)).toBe(5_000);
    expect(supervisorPollRequestTimeout(1_250)).toBe(1_250);
    expect(supervisorPollRequestTimeout(-1)).toBe(0);
  });
});
