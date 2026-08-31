export type ThemeId = "default" | "latte" | "frappe" | "macchiato" | "mocha";
export type AppSettings = {
  theme: ThemeId;
  agentLaunchPathsMaxHeightPx: number;
  navigationRailWidthPx: number;
  createdAt: number;
  updatedAt: number;
};
