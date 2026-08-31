export type TerminalLayoutCount = 2 | 3 | 4;
export type TerminalLayoutPreset = "columns" | "rows" | "main-left" | "main-right" | "grid";

export type TerminalWorkspaceLayoutPreferences = {
  presets: Partial<Record<TerminalLayoutCount, TerminalLayoutPreset>>;
  ratios: Record<string, number[]>;
};

export const TERMINAL_WORKSPACE_LAYOUT_STORAGE_KEY = "devhatch-terminal-workspace-layouts-v1";

const presets: Record<TerminalLayoutCount, readonly TerminalLayoutPreset[]> = {
  2: ["columns", "rows"],
  3: ["main-left", "main-right", "columns", "rows"],
  4: ["grid", "columns", "rows"],
};

const defaults: Record<TerminalLayoutCount, TerminalLayoutPreset> = {
  2: "columns",
  3: "main-left",
  4: "grid",
};

export function terminalLayoutPresets(count: TerminalLayoutCount) {
  return presets[count];
}

export function defaultTerminalLayoutPreset(count: TerminalLayoutCount) {
  return defaults[count];
}

export function terminalLayoutLabel(preset: TerminalLayoutPreset) {
  if (preset === "main-left") return "Main left";
  if (preset === "main-right") return "Main right";
  if (preset === "grid") return "Grid";
  if (preset === "columns") return "Columns";
  return "Rows";
}

export function terminalLayoutKey(count: TerminalLayoutCount, preset: TerminalLayoutPreset) {
  return `${count}:${preset}`;
}

export function defaultTerminalLayoutRatios(count: TerminalLayoutCount, preset: TerminalLayoutPreset): number[] {
  if (count === 3 && preset === "main-left") return [0.62, 0.5];
  if (count === 3 && preset === "main-right") return [0.38, 0.5];
  if (count === 3 && (preset === "columns" || preset === "rows")) return [1 / 3, 2 / 3];
  if (count === 4 && (preset === "columns" || preset === "rows")) return [0.25, 0.5, 0.75];
  if (count === 2) return [0.5];
  return [0.5, 0.5];
}

export function terminalLayoutWeights(cuts: readonly number[]) {
  return [...cuts, 1].map((cut, index) => cut - (cuts[index - 1] ?? 0));
}

export function clampTerminalLayoutCut(cuts: readonly number[], index: number, value: number, minimum: number) {
  const lower = (cuts[index - 1] ?? 0) + minimum;
  const upper = (cuts[index + 1] ?? 1) - minimum;
  return Math.min(upper, Math.max(lower, value));
}

export function readTerminalWorkspaceLayouts(): Record<string, TerminalWorkspaceLayoutPreferences> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TERMINAL_WORKSPACE_LAYOUT_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, TerminalWorkspaceLayoutPreferences> = {};
    for (const [workspaceId, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const value = raw as { presets?: unknown; ratios?: unknown };
      const selected: TerminalWorkspaceLayoutPreferences["presets"] = {};
      if (value.presets && typeof value.presets === "object" && !Array.isArray(value.presets)) {
        for (const count of [2, 3, 4] as const) {
          const preset = (value.presets as Record<string, unknown>)[count];
          if (typeof preset === "string" && terminalLayoutPresets(count).includes(preset as TerminalLayoutPreset)) selected[count] = preset as TerminalLayoutPreset;
        }
      }
      const ratios: Record<string, number[]> = {};
      if (value.ratios && typeof value.ratios === "object" && !Array.isArray(value.ratios)) {
        for (const [key, rawRatios] of Object.entries(value.ratios)) {
          const [rawCount, rawPreset] = key.split(":");
          const count = Number(rawCount);
          if (count !== 2 && count !== 3 && count !== 4) continue;
          const preset = rawPreset as TerminalLayoutPreset;
          if (!terminalLayoutPresets(count).includes(preset)) continue;
          const expectedLength = defaultTerminalLayoutRatios(count, preset).length;
          const separateAxes = preset === "main-left" || preset === "main-right" || preset === "grid";
          if (Array.isArray(rawRatios) && rawRatios.length === expectedLength && rawRatios.every((ratio, index) => typeof ratio === "number" && Number.isFinite(ratio) && ratio > (separateAxes ? 0 : rawRatios[index - 1] ?? 0) && ratio < 1)) ratios[key] = rawRatios;
        }
      }
      result[workspaceId] = { presets: selected, ratios };
    }
    return result;
  } catch {
    return {};
  }
}

export function writeTerminalWorkspaceLayouts(layouts: Record<string, TerminalWorkspaceLayoutPreferences>) {
  try {
    localStorage.setItem(TERMINAL_WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    return;
  }
}
