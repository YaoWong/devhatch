import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getSettings, updateSettings, type UpdateSettingsPatch } from "../../api/settings";
import { DebouncedNumberSetting, hasDisplaySettings } from "./settingsPersistence";
import { ThemeContext } from "../../shared/theme/ThemeContext";
import {
  applyDisplaySettings,
  cacheDisplaySettings,
  cachedDisplaySettings,
  clampFontSize,
  clampUiScale,
  MAX_FONT_SIZE_PX,
  MAX_UI_SCALE_PERCENT,
  MIN_FONT_SIZE_PX,
  MIN_UI_SCALE_PERCENT,
} from "../../shared/theme/displaySettings";
import { applyTheme, cachedTheme, isThemeId } from "../../shared/theme/themes";
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
  const { value: heightValue, setValue: setHeightValue, loadValue: loadHeightValue } = usePersistedNumberSetting("agentLaunchPathsMaxHeightPx", 286, 160, 480, reportError);
  const { value: widthValue, setValue: setWidthValue, loadValue: loadWidthValue } = usePersistedNumberSetting("navigationRailWidthPx", 288, 240, 480, reportError);
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
    while (desiredRef.current !== confirmedRef.current) {
      const requested = desiredRef.current;
      try {
        const settings = await updateSettings({ theme: requested });
        confirmedRef.current = isThemeId(settings.theme) ? settings.theme : requested;
        if (mountedRef.current && desiredRef.current === requested) {
          applyTheme(confirmedRef.current);
          setThemeId(confirmedRef.current);
        }
      } catch (reason) {
        reportError(reason);
        if (desiredRef.current === requested) {
          desiredRef.current = confirmedRef.current;
          if (mountedRef.current) {
            applyTheme(confirmedRef.current);
            setThemeId(confirmedRef.current);
          }
        }
      }
    }
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
        const next = isThemeId(settings.theme) ? settings.theme : "default";
        confirmedRef.current = next;
        desiredRef.current = next;
        loadHeightValue(settings.agentLaunchPathsMaxHeightPx);
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
        loadHeightValue(286);
        loadWidthValue(288);
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
  }, [initialDisplaySettings.fontSizePx, initialDisplaySettings.uiScalePercent, initialTheme, loadFontSizeValue, loadHeightValue, loadUiScaleValue, loadWidthValue, reportError]);

  const dismissError = useCallback(() => setError(null), []);
  const selectTheme = useCallback((next: ThemeId) => {
    desiredRef.current = next;
    setThemeId(next);
    applyTheme(next);
    setError(null);
    void flush();
  }, [flush]);
  const setAgentLaunchPathsMaxHeightPx = useCallback((value: number) => {
    setError(null);
    setHeightValue(value);
  }, [setHeightValue]);
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

  if (themeId === null) {
    return showInitialLoading ? <main className="auth-page" aria-busy="true"><section className="auth-card"><h1>DevHatch</h1><p role="status">Loading settings…</p></section></main> : null;
  }
  return (
    <ThemeContext
      value={{
        themeId,
        agentLaunchPathsMaxHeightPx: heightValue,
        navigationRailWidthPx: widthValue,
        fontSizePx: fontSizeValue,
        uiScalePercent: uiScaleValue,
        supportsDisplaySettings,
        saving,
        error,
        dismissError,
        selectTheme,
        setAgentLaunchPathsMaxHeightPx,
        setNavigationRailWidthPx,
        setFontSizePx,
        setUiScalePercent,
      }}
    >
      {children}
    </ThemeContext>
  );
}
