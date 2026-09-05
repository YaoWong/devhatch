import { describe, expect, it } from "vitest";
import {
  applyDisplaySettings,
  cacheDisplaySettings,
  cachedDisplaySettings,
  clampFontSize,
  clampUiScale,
  DEFAULT_FONT_SIZE_PX,
  DEFAULT_UI_SCALE_PERCENT,
} from "./displaySettings";

describe("display settings", () => {
  it("clamps font size and UI scale", () => {
    expect(clampFontSize(8)).toBe(12);
    expect(clampFontSize(21)).toBe(20);
    expect(clampUiScale(79)).toBe(80);
    expect(clampUiScale(83)).toBe(85);
    expect(clampUiScale(126)).toBe(125);
  });

  it("applies independent CSS scales", () => {
    const values = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
      },
    } as unknown as HTMLElement;
    applyDisplaySettings(DEFAULT_FONT_SIZE_PX + 1, DEFAULT_UI_SCALE_PERCENT + 10, root);
    expect(values.get("--app-font-scale")).toBe(String(14 / 13));
    expect(values.get("--app-ui-scale")).toBe("1.1");
  });

  it("caches clamped display values", () => {
    const values = new Map<string, string>();
    cacheDisplaySettings(30, 79, { setItem: (key, value) => { values.set(key, value); } });
    expect(cachedDisplaySettings({ getItem: (key) => values.get(key) ?? null })).toEqual({ fontSizePx: 20, uiScalePercent: 80 });
  });

  it("falls back when cached values are unavailable", () => {
    expect(cachedDisplaySettings({ getItem: () => { throw new Error("blocked"); } })).toEqual({
      fontSizePx: DEFAULT_FONT_SIZE_PX,
      uiScalePercent: DEFAULT_UI_SCALE_PERCENT,
    });
  });
});
