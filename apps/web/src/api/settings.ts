import type { AppSettings } from "../types/settings";
import { requestJson } from "./client";

export function getSettings() {
  return requestJson<{ settings: AppSettings }>("/api/settings", undefined, "Unable to load settings")
    .then(({ settings }) => settings);
}

export function updateSettings(
  patch: Partial<Pick<AppSettings, "theme" | "layoutMode" | "agentLaunchPathsMaxHeightPx" | "navigationRailWidthPx">>,
) {
  return requestJson<{ settings: AppSettings }>(
    "/api/settings",
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
    "Unable to save settings",
  ).then(({ settings }) => settings);
}
