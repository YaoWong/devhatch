import { createContext, useContext } from "react";
import type { ThemeId } from "../../types/settings";

export const ThemeContext = createContext<{
  themeId: ThemeId;
  agentLaunchPathsMaxHeightPx: number;
  navigationRailWidthPx: number;
  saving: boolean;
  error: string | null;
  selectTheme: (themeId: ThemeId) => void;
  setAgentLaunchPathsMaxHeightPx: (value: number) => void;
  setNavigationRailWidthPx: (value: number) => void;
} | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within AppSettingsProvider");
  return context;
}
