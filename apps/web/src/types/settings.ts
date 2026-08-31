export type ThemeId = "default" | "latte" | "frappe" | "macchiato" | "mocha";
export type LayoutMode = "classic" | "canvas";
export type AppSettings = {
  theme: ThemeId;
  layoutMode: LayoutMode;
  agentLaunchPathsMaxHeightPx: number;
  navigationRailWidthPx: number;
  createdAt: number;
  updatedAt: number;
};
