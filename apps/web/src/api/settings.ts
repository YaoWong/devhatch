import type { AppSettings, ThemeId } from "../types";
import { requestJson } from "./client";

export function getSettings() {
  return requestJson<{ settings: AppSettings }>("/api/settings", undefined, "Unable to load settings")
    .then(({ settings }) => settings);
}

export function updateSettings(theme: ThemeId) {
  return requestJson<{ settings: AppSettings }>(
    "/api/settings",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme }),
    },
    "Unable to save settings",
  ).then(({ settings }) => settings);
}
