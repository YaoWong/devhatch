import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getSettings, updateSettings } from "./api/settings";
import { ThemeContext } from "./ThemeContext";
import { applyTheme, cachedTheme, isThemeId } from "./themes";
import type { ThemeId } from "./types";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const initialTheme = useRef(cachedTheme()).current;
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const confirmedRef = useRef<ThemeId>(initialTheme);
  const desiredRef = useRef<ThemeId>(initialTheme);
  const savingRef = useRef(false);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    if (mountedRef.current) setSaving(true);
    while (desiredRef.current !== confirmedRef.current) {
      const requested = desiredRef.current;
      try {
        const settings = await updateSettings(requested);
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
        applyTheme(next);
        setThemeId(next);
      })
      .catch((reason) => {
        if (!active) return;
        confirmedRef.current = initialTheme;
        desiredRef.current = initialTheme;
        applyTheme(initialTheme);
        setThemeId(initialTheme);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
      mountedRef.current = false;
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

  if (themeId === null) return null;
  return <ThemeContext value={{ themeId, saving, error, selectTheme }}>{children}</ThemeContext>;
}
