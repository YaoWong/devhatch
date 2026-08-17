import { useCallback, useEffect, useState } from "react";
import { checkOpenDesignUpdate, endpoints, installOpenDesign, startOpenDesign, stopOpenDesign, updateOpenDesign } from "../api";
import type { WebApp } from "../types";

export function useWebApps(active: boolean, reportError: (message: string) => void) {
  const [apps, setApps] = useState<WebApp[]>([]);
  const [operation, setOperation] = useState<"start" | "stop" | "check" | null>(null);
  const openDesign = apps.find((app) => app.id === "open-design") ?? null;

  const refresh = useCallback(async () => {
    try {
      const data = await endpoints.webApps();
      setApps(data.webApps);
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active && !openDesign?.installing && !openDesign?.updating && openDesign?.phase !== "starting") return;
    const timer = window.setInterval(() => void refresh(), openDesign?.installing || openDesign?.updating ? 1000 : 3000);
    return () => window.clearInterval(timer);
  }, [active, openDesign?.installing, openDesign?.updating, openDesign?.phase, refresh]);

  const install = useCallback(async () => {
    try {
      await installOpenDesign();
      await refresh();
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refresh, reportError]);

  const start = useCallback(async () => {
    setOperation("start");
    try {
      const { webApp } = await startOpenDesign();
      setApps((current) => current.map((app) => (app.id === webApp.id ? webApp : app)));
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation(null);
    }
  }, [reportError]);

  const stop = useCallback(async () => {
    setOperation("stop");
    try {
      const { webApp } = await stopOpenDesign();
      setApps((current) => current.map((app) => (app.id === webApp.id ? webApp : app)));
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation(null);
    }
  }, [reportError]);

  const checkUpdate = useCallback(async () => {
    setOperation("check");
    try {
      const { webApp } = await checkOpenDesignUpdate();
      setApps((current) => current.map((app) => (app.id === webApp.id ? webApp : app)));
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setOperation(null);
    }
  }, [reportError]);

  const update = useCallback(async () => {
    try {
      await updateOpenDesign();
      await refresh();
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refresh, reportError]);

  const open = useCallback(() => {}, []);

  return { apps, openDesign, operation, refresh, install, start, stop, checkUpdate, update, open };
}
