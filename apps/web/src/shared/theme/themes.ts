import type { ThemeId } from "../../types/settings";

export const themes = [
  { id: "default", name: "Default", description: "DevHatch light" },
  { id: "latte", name: "Catppuccin Latte", description: "Warm light" },
  { id: "frappe", name: "Catppuccin Frappé", description: "Soft dark" },
  { id: "macchiato", name: "Catppuccin Macchiato", description: "Deep dark" },
  { id: "mocha", name: "Catppuccin Mocha", description: "Rich dark" },
] as const satisfies readonly { id: ThemeId; name: string; description: string }[];

const themeIds = new Set<ThemeId>(themes.map(({ id }) => id));
const storageKey = "devhatch-theme";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.has(value as ThemeId);
}

export function cachedTheme(): ThemeId {
  const value = localStorage.getItem(storageKey);
  return isThemeId(value) ? value : "default";
}

export function applyTheme(themeId: ThemeId) {
  document.documentElement.dataset.theme = themeId;
  localStorage.setItem(storageKey, themeId);
}
