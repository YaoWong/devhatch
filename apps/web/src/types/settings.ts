export type ThemeId = "default" | "latte" | "frappe" | "macchiato" | "mocha";
export type AppSettings = {
  theme: ThemeId;
  agentLaunchPathsMaxHeightPx: number;
  navigationRailWidthPx: number;
  fontSizePx: number;
  uiScalePercent: number;
  createdAt: number;
  updatedAt: number;
};

export type AppSettingsResponse = Omit<AppSettings, "fontSizePx" | "uiScalePercent"> & Partial<Pick<AppSettings, "fontSizePx" | "uiScalePercent">>;
