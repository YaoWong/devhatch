import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getSettings, updateSettings } from "../../api/settings";
import { ThemeContext } from "../../shared/theme/ThemeContext";
import { applyTheme, cachedTheme, isThemeId } from "../../shared/theme/themes";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type { ThemeId } from "../../types/settings";

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const initialTheme = useRef(cachedTheme()).current;
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [agentLaunchPathsMaxHeightPx, setAgentLaunchPathsMaxHeightPxState] = useState(286);
  const [navigationRailWidthPx, setNavigationRailWidthPxState] = useState(288);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showInitialLoading = useDelayedLoading(themeId === null);
  const mountedRef = useRef(false);
  const confirmedRef = useRef<ThemeId>(initialTheme);
  const desiredRef = useRef<ThemeId>(initialTheme);
  const savingRef = useRef(false);
  const confirmedHeightRef = useRef(286);
  const desiredHeightRef = useRef(286);
  const heightSavingRef = useRef(false);
  const heightGenerationRef = useRef(0);
  const heightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmedWidthRef = useRef(288);
  const desiredWidthRef = useRef(288);
  const widthSavingRef = useRef(false);
  const widthGenerationRef = useRef(0);
  const widthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
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
  }, []);

  const flushAgentLaunchPathsMaxHeight = useCallback(async () => {
    heightTimerRef.current = null;
    if (heightSavingRef.current) return;
    heightSavingRef.current = true;
    const requested = desiredHeightRef.current;
    const generation = heightGenerationRef.current;
    try {
      const settings = await updateSettings({ agentLaunchPathsMaxHeightPx: requested });
      confirmedHeightRef.current = settings.agentLaunchPathsMaxHeightPx;
      if (
        mountedRef.current &&
        heightGenerationRef.current === generation &&
        desiredHeightRef.current === requested
      ) {
        setAgentLaunchPathsMaxHeightPxState(confirmedHeightRef.current);
      }
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
      if (desiredHeightRef.current === requested) {
        desiredHeightRef.current = confirmedHeightRef.current;
        if (mountedRef.current && heightGenerationRef.current === generation) {
          setAgentLaunchPathsMaxHeightPxState(confirmedHeightRef.current);
        }
      }
    } finally {
      heightSavingRef.current = false;
      if (
        mountedRef.current &&
        desiredHeightRef.current !== confirmedHeightRef.current &&
        !heightTimerRef.current
      ) {
        heightTimerRef.current = setTimeout(() => void flushAgentLaunchPathsMaxHeight(), 200);
      }
    }
  }, []);

  const setAgentLaunchPathsMaxHeightPx = useCallback(
    (value: number) => {
      const next = Math.min(480, Math.max(160, Math.round(value)));
      heightGenerationRef.current += 1;
      desiredHeightRef.current = next;
      setAgentLaunchPathsMaxHeightPxState(next);
      setError(null);
      if (heightTimerRef.current) clearTimeout(heightTimerRef.current);
      heightTimerRef.current = setTimeout(() => void flushAgentLaunchPathsMaxHeight(), 200);
    },
    [flushAgentLaunchPathsMaxHeight],
  );

  const flushNavigationRailWidth = useCallback(async () => {
    widthTimerRef.current = null;
    if (widthSavingRef.current) return;
    widthSavingRef.current = true;
    const requested = desiredWidthRef.current;
    const generation = widthGenerationRef.current;
    try {
      const settings = await updateSettings({ navigationRailWidthPx: requested });
      confirmedWidthRef.current = settings.navigationRailWidthPx;
      if (
        mountedRef.current &&
        widthGenerationRef.current === generation &&
        desiredWidthRef.current === requested
      ) {
        setNavigationRailWidthPxState(confirmedWidthRef.current);
      }
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
      if (desiredWidthRef.current === requested) {
        desiredWidthRef.current = confirmedWidthRef.current;
        if (mountedRef.current && widthGenerationRef.current === generation) {
          setNavigationRailWidthPxState(confirmedWidthRef.current);
        }
      }
    } finally {
      widthSavingRef.current = false;
      if (
        mountedRef.current &&
        desiredWidthRef.current !== confirmedWidthRef.current &&
        !widthTimerRef.current
      ) {
        widthTimerRef.current = setTimeout(() => void flushNavigationRailWidth(), 200);
      }
    }
  }, []);

  const setNavigationRailWidthPx = useCallback(
    (value: number) => {
      const next = Math.min(480, Math.max(240, Math.round(value)));
      widthGenerationRef.current += 1;
      desiredWidthRef.current = next;
      setNavigationRailWidthPxState(next);
      setError(null);
      if (widthTimerRef.current) clearTimeout(widthTimerRef.current);
      widthTimerRef.current = setTimeout(() => void flushNavigationRailWidth(), 200);
    },
    [flushNavigationRailWidth],
  );

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
        const height =
          Number.isInteger(settings.agentLaunchPathsMaxHeightPx) &&
          settings.agentLaunchPathsMaxHeightPx >= 160 &&
          settings.agentLaunchPathsMaxHeightPx <= 480
            ? settings.agentLaunchPathsMaxHeightPx
            : 286;
        confirmedHeightRef.current = height;
        desiredHeightRef.current = height;
        setAgentLaunchPathsMaxHeightPxState(height);
        const width =
          Number.isInteger(settings.navigationRailWidthPx) &&
          settings.navigationRailWidthPx >= 240 &&
          settings.navigationRailWidthPx <= 480
            ? settings.navigationRailWidthPx
            : 288;
        confirmedWidthRef.current = width;
        desiredWidthRef.current = width;
        setNavigationRailWidthPxState(width);
        applyTheme(next);
        setThemeId(next);
      })
      .catch((reason) => {
        if (!active) return;
        confirmedRef.current = initialTheme;
        desiredRef.current = initialTheme;
        confirmedHeightRef.current = 286;
        desiredHeightRef.current = 286;
        setAgentLaunchPathsMaxHeightPxState(286);
        confirmedWidthRef.current = 288;
        desiredWidthRef.current = 288;
        setNavigationRailWidthPxState(288);
        applyTheme(initialTheme);
        setThemeId(initialTheme);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      mountedRef.current = false;
      if (heightTimerRef.current) clearTimeout(heightTimerRef.current);
      if (widthTimerRef.current) clearTimeout(widthTimerRef.current);
      applyTheme(cachedTheme());
    };
  }, [initialTheme]);

  const selectTheme = useCallback((next: ThemeId) => {
    desiredRef.current = next;
    setThemeId(next);
    applyTheme(next);
    setError(null);
    void flush();
  }, [flush]);

  if (themeId === null) {
    return showInitialLoading ? <main className="auth-page" aria-busy="true"><section className="auth-card"><h1>DevHatch</h1><p role="status">Loading settings…</p></section></main> : null;
  }
  return (
    <ThemeContext
      value={{
        themeId,
        agentLaunchPathsMaxHeightPx,
        navigationRailWidthPx,
        saving,
        error,
        selectTheme,
        setAgentLaunchPathsMaxHeightPx,
        setNavigationRailWidthPx,
      }}
    >
      {children}
    </ThemeContext>
  );
}
