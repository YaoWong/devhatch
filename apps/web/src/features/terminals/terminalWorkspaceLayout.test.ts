import { describe, expect, it } from "vitest";
import { clampTerminalLayoutCut, defaultTerminalLayoutRatios, terminalLayoutPresets, terminalLayoutWeights } from "./terminalWorkspaceLayout";

describe("terminal workspace layouts", () => {
  it("provides presets for every multi-terminal count", () => {
    expect(terminalLayoutPresets(2)).toEqual(["columns", "rows"]);
    expect(terminalLayoutPresets(3)).toEqual(["main-left", "main-right", "columns", "rows"]);
    expect(terminalLayoutPresets(4)).toEqual(["grid", "columns", "rows"]);
  });

  it("converts divider cuts into grid weights", () => {
    expect(terminalLayoutWeights([0.25, 0.5, 0.75])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("keeps divider cuts between adjacent panes", () => {
    const cuts = defaultTerminalLayoutRatios(4, "columns");
    expect(clampTerminalLayoutCut(cuts, 1, 0.1, 0.2)).toBe(0.45);
    expect(clampTerminalLayoutCut(cuts, 1, 0.9, 0.2)).toBe(0.55);
  });
});
