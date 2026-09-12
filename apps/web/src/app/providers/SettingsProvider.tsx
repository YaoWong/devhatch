import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getSettings, updateSettings, type UpdateSettingsPatch } from "../../api/settings";
import { appearanceDefaults, DebouncedNumberSetting, hasDisplaySettings, persistLatestValue } from "./settingsPersistence";
import { ThemeContext } from "../../shared/theme/ThemeContext";
import {
  applyDisplaySettings,
  cacheDisplaySettings,
  cachedDisplaySettings,
  clampFontSize,
  clampUiScale,
  DEFAULT_LAUNCH_PATHS_MAX_HEIGHT_PX,
  DEFAULT_NAVIGATION_RAIL_WIDTH_PX,
  DEFAULT_WORKSPACE_MAX_HEIGHT_PX,
  MAX_FONT_SIZE_PX,
  MAX_NAVIGATION_RAIL_WIDTH_PX,
  MAX_UI_SCALE_PERCENT,
  MIN_FONT_SIZE_PX,
  MIN_NAVIGATION_RAIL_WIDTH_PX,
  MIN_UI_SCALE_PERCENT,
} from "../../shared/theme/displaySettings";
import { applyTheme, cachedTheme, DEFAULT_THEME_ID, isThemeId } from "../../shared/theme/themes";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type { ThemeId } from "../../types/settings";

type NumericSettingsKey = Exclude<keyof UpdateSettingsPatch, "theme">;

function usePersistedNumberSetting(
  key: NumericSettingsKey,
  initialValue: number,
  min: number,
  max: number,
  reportError: (reason: unknown) => void,
  enabled = true,
  step = 1,
) {
  const [value, setValueState] = useState(initialValue);
  const settingRef = useRef<DebouncedNumberSetting | null>(null);
  if (!settingRef.current) {
    settingRef.current = new DebouncedNumberSetting({
      key,
      initialValue,
      min,
      max,
      step,
      persist: updateSettings,
      onValue: setValueState,
      onError: reportError,
    });
  }
  const setting = settingRef.current;
  useEffect(() => {
    setting.activate();
    return () => setting.dispose();
  }, [setting]);
  const setValue = useCallback((nextValue: number) => {
    if (enabled) setting.setValue(nextValue);
  }, [enabled, setting]);
  const loadValue = useCallback((nextValue: unknown) => setting.loadValue(nextValue), [setting]);
  return { value, setValue, loadValue };
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const initialTheme = useRef(cachedTheme()).current;
  const initialDisplaySettings = useRef(cachedDisplaySettings()).current;
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [supportsDisplaySettings, setSupportsDisplaySettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showInitialLoading = useDelayedLoading(themeId === null);
  const mountedRef = useRef(false);
  const confirmedRef = useRef<ThemeId>(initialTheme);
  const desiredRef = useRef<ThemeId>(initialTheme);
  const savingRef = useRef(false);
  const reportError = useCallback((reason: unknown) => {
    if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
  }, []);
  const { value: heightValue, setValue: setHeightValue, loadValue: loadHeightValue } = usePersistedNumberSetting("launchPathsMaxHeightPx", DEFAULT_LAUNCH_PATHS_MAX_HEIGHT_PX, 160, 480, reportError);
  const { value: workspaceHeightValue, setValue: setWorkspaceHeightValue, loadValue: loadWorkspaceHeightValue } = usePersistedNumberSetting("workspaceMaxHeightPx", DEFAULT_WORKSPACE_MAX_HEIGHT_PX, 160, 480, reportError);
  const { value: widthValue, setValue: setWidthValue, loadValue: loadWidthValue } = usePersistedNumberSetting("navigationRailWidthPx", DEFAULT_NAVIGATION_RAIL_WIDTH_PX, MIN_NAVIGATION_RAIL_WIDTH_PX, MAX_NAVIGATION_RAIL_WIDTH_PX, reportError);
  const { value: fontSizeValue, setValue: setFontSizeValue, loadValue: loadFontSizeValue } = usePersistedNumberSetting("fontSizePx", initialDisplaySettings.fontSizePx, MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX, reportError, supportsDisplaySettings);
  const { value: uiScaleValue, setValue: setUiScaleValue, loadValue: loadUiScaleValue } = usePersistedNumberSetting("uiScalePercent", initialDisplaySettings.uiScalePercent, MIN_UI_SCALE_PERCENT, MAX_UI_SCALE_PERCENT, reportError, supportsDisplaySettings, 5);

  useLayoutEffect(() => {
    applyDisplaySettings(fontSizeValue, uiScaleValue);
    cacheDisplaySettings(fontSizeValue, uiScaleValue);
  }, [fontSizeValue, uiScaleValue]);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    if (mountedRef.current) setSaving(true);
    await persistLatestValue({
      getConfirmed: () => confirmedRef.current,
      getDesired: () => desiredRef.current,
      persist: async (requested) => {
        const settings = await updateSettings({ theme: requested });
        return isThemeId(settings.theme) ? settings.theme : requested;
      },
      setConfirmed: (theme) => {
        confirmedRef.current = theme;
      },
      setDesired: (theme) => {
        desiredRef.current = theme;
      },
      onValue: (theme) => {
        if (mountedRef.current) {
          applyTheme(theme);
          setThemeId(theme);
        }
      },
      onError: reportError,
    });
    savingRef.current = false;
    if (mountedRef.current) setSaving(false);
  }, [reportError]);

  useEffect(() => {
    mountedRef.current = true;
    applyTheme(initialTheme);
    let active = true;
    getSettings()
      .then((settings) => {
        if (!active) return;
        const next = isThemeId(settings.theme) ? settings.theme : DEFAULT_THEME_ID;
        confirmedRef.current = next;
        desiredRef.current = next;
        loadHeightValue(settings.launchPathsMaxHeightPx);
        loadWorkspaceHeightValue(settings.workspaceMaxHeightPx);
        loadWidthValue(settings.navigationRailWidthPx);
        const displaySettingsSupported = hasDisplaySettings(settings);
        setSupportsDisplaySettings(displaySettingsSupported);
        loadFontSizeValue(displaySettingsSupported ? settings.fontSizePx : initialDisplaySettings.fontSizePx);
        loadUiScaleValue(displaySettingsSupported ? settings.uiScalePercent : initialDisplaySettings.uiScalePercent);
        applyTheme(next);
        setThemeId(next);
      })
      .catch((reason) => {
        if (!active) return;
        confirmedRef.current = initialTheme;
        desiredRef.current = initialTheme;
        setSupportsDisplaySettings(false);
        loadHeightValue(DEFAULT_LAUNCH_PATHS_MAX_HEIGHT_PX);
        loadWorkspaceHeightValue(DEFAULT_WORKSPACE_MAX_HEIGHT_PX);
        loadWidthValue(DEFAULT_NAVIGATION_RAIL_WIDTH_PX);
        loadFontSizeValue(initialDisplaySettings.fontSizePx);
        loadUiScaleValue(initialDisplaySettings.uiScalePercent);
        applyTheme(initialTheme);
        setThemeId(initialTheme);
        reportError(reason);
      });
    return () => {
      active = false;
      mountedRef.current = false;
      applyTheme(cachedTheme());
      const cached = cachedDisplaySettings();
      applyDisplaySettings(cached.fontSizePx, cached.uiScalePercent);
    };
  }, [initialDisplaySettings.fontSizePx, initialDisplaySettings.uiScalePercent, initialTheme, loadFontSizeValue, loadHeightValue, loadUiScaleValue, loadWidthValue, loadWorkspaceHeightValue, reportError]);

  const dismissError = useCallback(() => setError(null), []);
  const selectTheme = useCallback((next: ThemeId) => {
    const changed = desiredRef.current !== next;
    desiredRef.current = next;
    setThemeId(next);
    applyTheme(next);
    setError(null);
    if (changed || next !== confirmedRef.current) void flush();
  }, [flush]);
  const setLaunchPathsMaxHeightPx = useCallback((value: number) => {
    setError(null);
    setHeightValue(value);
  }, [setHeightValue]);
  const setWorkspaceMaxHeightPx = useCallback((value: number) => {
    setError(null);
    setWorkspaceHeightValue(value);
  }, [setWorkspaceHeightValue]);
  const setNavigationRailWidthPx = useCallback((value: number) => {
    setError(null);
    setWidthValue(value);
  }, [setWidthValue]);
  const setFontSizePx = useCallback((value: number) => {
    setError(null);
    setFontSizeValue(clampFontSize(value));
  }, [setFontSizeValue]);
  const setUiScalePercent = useCallback((value: number) => {
    setError(null);
    setUiScaleValue(clampUiScale(value));
  }, [setUiScaleValue]);
  const resetAppearance = useCallback(() => {
    const defaults = appearanceDefaults(supportsDisplaySettings);
    selectTheme(defaults.theme);
    setLaunchPathsMaxHeightPx(defaults.launchPathsMaxHeightPx);
    setWorkspaceMaxHeightPx(defaults.workspaceMaxHeightPx);
    setNavigationRailWidthPx(defaults.navigationRailWidthPx);
    if (defaults.fontSizePx !== undefined && defaults.uiScalePercent !== undefined) {
      setFontSizePx(defaults.fontSizePx);
      setUiScalePercent(defaults.uiScalePercent);
    }
  }, [selectTheme, setLaunchPathsMaxHeightPx, setFontSizePx, setNavigationRailWidthPx, setUiScalePercent, setWorkspaceMaxHeightPx, supportsDisplaySettings]);

  if (themeId === null) {
    return showInitialLoading ? <main className="tw:flex tw:h-dvh tw:w-full tw:items-center tw:justify-center tw:overflow-y-auto tw:overscroll-contain tw:bg-[radial-gradient(circle_at_50%_0%,var(--color-surface)_0,var(--color-canvas)_55%)] tw:pt-[max(16px,env(safe-area-inset-top))] tw:pr-[max(16px,env(safe-area-inset-right))] tw:pb-[max(16px,env(safe-area-inset-bottom))] tw:pl-[max(16px,env(safe-area-inset-left))]" aria-busy="true"><section className="tw:my-auto tw:grid tw:w-[min(420px,100%)] tw:flex-none tw:gap-[18px] tw:rounded-[24px] tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:p-[32px] tw:shadow-[0_24px_70px_rgb(0_0_0/10%)]"><h1 className="tw:m-0 tw:text-[calc(24px*var(--app-font-scale))] tw:tracking-[-0.04em]">DevHatch</h1><p className="tw:m-0 tw:text-sm tw:leading-[1.5] tw:text-muted-foreground" role="status">Loading settings…</p></section></main> : null;
  }
  return (
    <ThemeContext
      value={{
        themeId,
        launchPathsMaxHeightPx: heightValue,
        workspaceMaxHeightPx: workspaceHeightValue,
        navigationRailWidthPx: widthValue,
        fontSizePx: fontSizeValue,
        uiScalePercent: uiScaleValue,
        supportsDisplaySettings,
        saving,
        error,
        dismissError,
        resetAppearance,
        selectTheme,
        setLaunchPathsMaxHeightPx,
        setWorkspaceMaxHeightPx,
        setNavigationRailWidthPx,
        setFontSizePx,
        setUiScalePercent,
      }}
    >
      {children}
    </ThemeContext>
  );
}
