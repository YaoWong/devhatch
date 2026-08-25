import { createContext, useContext } from "react";
import type { ThemeId } from "./types";

export const ThemeContext = createContext<{
  themeId: ThemeId;
  saving: boolean;
  error: string | null;
  selectTheme: (themeId: ThemeId) => void;
} | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
