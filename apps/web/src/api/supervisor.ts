import type { SupervisorInstallRequest, SupervisorStatus } from "../types/supervisor";
import { requestJson } from "./client";

export function getSupervisorStatus(signal?: AbortSignal) {
  return requestJson<{ supervisor: SupervisorStatus }>(
    "/api/supervisor",
    signal ? { signal } : undefined,
    "Unable to load supervisor status",
  ).then(({ supervisor }) => supervisor);
}

export function installSupervisor(request: SupervisorInstallRequest, signal?: AbortSignal) {
  return requestJson<{ supervisor: SupervisorStatus }>(
    "/api/supervisor/install",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
    "Unable to install supervisor",
  ).then(({ supervisor }) => supervisor);
}
