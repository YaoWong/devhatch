import type { WebApp } from "../types";
import { requestJson } from "./client";

export function installOpenDesign() {
  return requestJson<{ accepted: boolean }>(
    "/api/web-apps/open-design/install",
    { method: "POST" },
    "Unable to start OpenDesign installation",
  );
}

export function checkOpenDesignUpdate() {
  return requestJson<{ webApp: WebApp }>(
    "/api/web-apps/open-design/check-update",
    { method: "POST" },
    "Unable to check for OpenDesign updates",
  );
}

export function updateOpenDesign() {
  return requestJson<{ accepted: boolean }>(
    "/api/web-apps/open-design/update",
    { method: "POST" },
    "Unable to update OpenDesign",
  );
}

export function startOpenDesign() {
  return requestJson<{ webApp: WebApp }>(
    "/api/web-apps/open-design/start",
    { method: "POST" },
    "Unable to start OpenDesign",
  );
}

export function stopOpenDesign() {
  return requestJson<{ webApp: WebApp }>(
    "/api/web-apps/open-design/stop",
    { method: "POST" },
    "Unable to stop OpenDesign",
  );
}
