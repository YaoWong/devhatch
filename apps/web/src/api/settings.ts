import type { AppSettings } from "../types/settings";
import { requestJson } from "./client";

export function getSettings() {
  return requestJson<{ settings: AppSettings }>("/api/settings", undefined, "Unable to load settings")
    .then(({ settings }) => settings);
}

export type UpdateSettingsPatch = Partial<Pick<AppSettings, "theme" | "agentLaunchPathsMaxHeightPx" | "navigationRailWidthPx" | "fontSizePx" | "uiScalePercent">>;

export function updateSettings(
  patch: UpdateSettingsPatch,
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
