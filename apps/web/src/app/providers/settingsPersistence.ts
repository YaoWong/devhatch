import type { UpdateSettingsPatch } from "../../api/settings";
import {
  DEFAULT_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX,
  DEFAULT_FONT_SIZE_PX,
  DEFAULT_NAVIGATION_RAIL_WIDTH_PX,
  DEFAULT_UI_SCALE_PERCENT,
  MAX_FONT_SIZE_PX,
  MAX_UI_SCALE_PERCENT,
  MIN_FONT_SIZE_PX,
  MIN_UI_SCALE_PERCENT,
} from "../../shared/theme/displaySettings";
import { DEFAULT_THEME_ID } from "../../shared/theme/themes";

type NumericSettingsKey = Exclude<keyof UpdateSettingsPatch, "theme">;
type PersistNumberSetting = (patch: UpdateSettingsPatch) => Promise<Partial<Record<NumericSettingsKey, unknown>>>;
type DebouncedNumberSettingOptions = {
  key: NumericSettingsKey;
  initialValue: number;
  min: number;
  max: number;
  step?: number;
  persist: PersistNumberSetting;
  onValue: (value: number) => void;
  onError: (reason: unknown) => void;
  delayMs?: number;
};

const SAVE_DELAY_MS = 200;

export type AppearanceDefaults = {
  theme: typeof DEFAULT_THEME_ID;
  agentLaunchPathsMaxHeightPx: number;
  navigationRailWidthPx: number;
  fontSizePx?: number;
  uiScalePercent?: number;
};

export function appearanceDefaults(supportsDisplaySettings: boolean): AppearanceDefaults {
  return {
    theme: DEFAULT_THEME_ID,
    agentLaunchPathsMaxHeightPx: DEFAULT_AGENT_LAUNCH_PATHS_MAX_HEIGHT_PX,
    navigationRailWidthPx: DEFAULT_NAVIGATION_RAIL_WIDTH_PX,
    ...(supportsDisplaySettings ? {
      fontSizePx: DEFAULT_FONT_SIZE_PX,
      uiScalePercent: DEFAULT_UI_SCALE_PERCENT,
    } : {}),
  };
}

type LatestValueOptions<T> = {
  getConfirmed: () => T;
  getDesired: () => T;
  persist: (value: T) => Promise<T>;
  setConfirmed: (value: T) => void;
  setDesired: (value: T) => void;
  onValue: (value: T) => void;
  onError: (reason: unknown) => void;
};

export async function persistLatestValue<T>(options: LatestValueOptions<T>) {
  while (options.getDesired() !== options.getConfirmed()) {
    const requested = options.getDesired();
    try {
      const confirmed = await options.persist(requested);
      options.setConfirmed(confirmed);
      if (options.getDesired() === requested) options.onValue(confirmed);
    } catch (reason) {
      if (options.getDesired() === requested) {
        const confirmed = options.getConfirmed();
        options.onError(reason);
        options.setDesired(confirmed);
        options.onValue(confirmed);
      }
    }
  }
}

export function hasDisplaySettings(settings: { fontSizePx?: unknown; uiScalePercent?: unknown }) {
  return typeof settings.fontSizePx === "number" &&
    Number.isInteger(settings.fontSizePx) &&
    settings.fontSizePx >= MIN_FONT_SIZE_PX &&
    settings.fontSizePx <= MAX_FONT_SIZE_PX &&
    typeof settings.uiScalePercent === "number" &&
    Number.isInteger(settings.uiScalePercent) &&
    settings.uiScalePercent >= MIN_UI_SCALE_PERCENT &&
    settings.uiScalePercent <= MAX_UI_SCALE_PERCENT &&
    (settings.uiScalePercent - MIN_UI_SCALE_PERCENT) % 5 === 0;
}

export class DebouncedNumberSetting {
  private active = false;
  private confirmed: number;
  private desired: number;
  private generation = 0;
  private readonly options: DebouncedNumberSettingOptions;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DebouncedNumberSettingOptions) {
    this.options = options;
    this.confirmed = options.initialValue;
    this.desired = options.initialValue;
  }

  activate() {
    this.active = true;
  }

  dispose() {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setValue(value: number) {
    if (!this.active || !Number.isFinite(value)) return;
    const next = this.normalize(value);
    this.generation += 1;
    this.desired = next;
    this.options.onValue(next);
    this.schedule();
  }

  loadValue(value: unknown) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.isPersistedValue(value) ? value : this.options.initialValue;
    this.generation += 1;
    this.confirmed = next;
    this.desired = next;
    this.options.onValue(next);
  }

  private normalize(value: number) {
    const { min, max, step = 1 } = this.options;
    return Math.min(max, Math.max(min, min + Math.round((value - min) / step) * step));
  }

  private isPersistedValue(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && this.normalize(value) === value;
  }

  private schedule() {
    if (!this.active || this.saving) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.options.delayMs ?? SAVE_DELAY_MS);
  }

  private async flush() {
    this.timer = null;
    if (!this.active || this.saving || this.desired === this.confirmed) return;
    this.saving = true;
    const requested = this.desired;
    const generation = this.generation;
    try {
      const settings = await this.options.persist({ [this.options.key]: requested });
      const confirmed = settings[this.options.key];
      if (!this.isPersistedValue(confirmed)) throw new Error("Unable to save setting");
      this.confirmed = confirmed;
      if (this.generation === generation && this.desired === requested) {
        this.desired = confirmed;
        if (this.active) this.options.onValue(confirmed);
      }
    } catch (reason) {
      if (this.generation === generation && this.desired === requested) {
        if (this.active) this.options.onError(reason);
        this.desired = this.confirmed;
        if (this.active) this.options.onValue(this.confirmed);
      }
    } finally {
      this.saving = false;
      if (this.active && this.desired !== this.confirmed) this.schedule();
    }
  }
}
