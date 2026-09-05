export const DEFAULT_FONT_SIZE_PX = 13;
export const MIN_FONT_SIZE_PX = 12;
export const MAX_FONT_SIZE_PX = 20;
export const DEFAULT_UI_SCALE_PERCENT = 100;
export const MIN_UI_SCALE_PERCENT = 80;
export const MAX_UI_SCALE_PERCENT = 125;

const FONT_SIZE_STORAGE_KEY = "devhatch-font-size-px";
const UI_SCALE_STORAGE_KEY = "devhatch-ui-scale-percent";

export function clampFontSize(value: number) {
  return Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, Math.round(value)));
}

export function clampUiScale(value: number) {
  const clamped = Math.min(MAX_UI_SCALE_PERCENT, Math.max(MIN_UI_SCALE_PERCENT, Math.round(value)));
  return MIN_UI_SCALE_PERCENT + Math.round((clamped - MIN_UI_SCALE_PERCENT) / 5) * 5;
}

type DisplaySettingsStorage = Pick<Storage, "getItem" | "setItem">;

export function cachedDisplaySettings(storage: Pick<DisplaySettingsStorage, "getItem"> = localStorage) {
  try {
    return {
      fontSizePx: clampFontSize(Number(storage.getItem(FONT_SIZE_STORAGE_KEY)) || DEFAULT_FONT_SIZE_PX),
      uiScalePercent: clampUiScale(Number(storage.getItem(UI_SCALE_STORAGE_KEY)) || DEFAULT_UI_SCALE_PERCENT),
    };
  } catch {
    return { fontSizePx: DEFAULT_FONT_SIZE_PX, uiScalePercent: DEFAULT_UI_SCALE_PERCENT };
  }
}

export function cacheDisplaySettings(
  fontSizePx: number,
  uiScalePercent: number,
  storage: Pick<DisplaySettingsStorage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(FONT_SIZE_STORAGE_KEY, String(clampFontSize(fontSizePx)));
    storage.setItem(UI_SCALE_STORAGE_KEY, String(clampUiScale(uiScalePercent)));
  } catch {
    return;
  }
}

export function applyDisplaySettings(
  fontSizePx: number,
  uiScalePercent: number,
  root: { style: Pick<CSSStyleDeclaration, "setProperty"> } = document.documentElement,
) {
  root.style.setProperty("--app-font-scale", String(fontSizePx / DEFAULT_FONT_SIZE_PX));
  root.style.setProperty("--app-ui-scale", String(uiScalePercent / DEFAULT_UI_SCALE_PERCENT));
}
