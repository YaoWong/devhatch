import { useCallback, useEffect, useRef, useState } from "react";
import { checkOpenDesignUpdate, endpoints, installOpenDesign, startOpenDesign, stopOpenDesign, updateOpenDesign } from "../api";
import type { WebApp } from "../types";

export function useWebApps(active: boolean, reportError: (message: string) => void) {
  const [apps, setApps] = useState<WebApp[]>([]);
  const [operation, setOperation] = useState<"start" | "stop" | "check" | null>(null);
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const mutationInFlight = useRef(false);
  const pollInFlight = useRef(false);
  const openDesign = apps.find((app) => app.id === "open-design") ?? null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
      mutationGeneration.current += 1;
      mutationInFlight.current = false;
      pollInFlight.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const mutation = mutationGeneration.current;
    try {
      const data = await endpoints.webApps();
      if (
        mounted.current &&
        refreshGeneration.current === generation &&
        mutationGeneration.current === mutation &&
        !mutationInFlight.current
      ) setApps(data.webApps);
    } catch (reason) {
      if (
        mounted.current &&
        refreshGeneration.current === generation &&
        mutationGeneration.current === mutation
      ) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active && !openDesign?.installing && !openDesign?.updating && openDesign?.phase !== "starting") return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (pollInFlight.current) {
        if (!cancelled) timer = window.setTimeout(poll, 100);
        return;
      }
      pollInFlight.current = true;
      try {
        await refresh();
      } finally {
        pollInFlight.current = false;
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, openDesign?.installing || openDesign?.updating ? 1000 : 3000);
      }
    };
    timer = window.setTimeout(poll, openDesign?.installing || openDesign?.updating ? 1000 : 3000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, openDesign?.installing, openDesign?.updating, openDesign?.phase, refresh]);

  const beginMutation = () => {
    mutationInFlight.current = true;
    refreshGeneration.current += 1;
    return ++mutationGeneration.current;
  };
  const finishMutation = (generation: number) => {
    if (mutationGeneration.current === generation) mutationInFlight.current = false;
  };
  const applyMutation = (generation: number, webApp: WebApp) => {
    if (mounted.current && mutationGeneration.current === generation) {
      setApps((current) => current.map((app) => (app.id === webApp.id ? webApp : app)));
    }
  };

  const install = useCallback(async () => {
    const generation = beginMutation();
    try {
      await installOpenDesign();
      finishMutation(generation);
      await refresh();
    } catch (reason) {
      finishMutation(generation);
      if (mounted.current && mutationGeneration.current === generation) reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refresh, reportError]);

  const start = useCallback(async () => {
    const generation = beginMutation();
    setOperation("start");
    try {
      const { webApp } = await startOpenDesign();
      applyMutation(generation, webApp);
    } catch (reason) {
      if (mounted.current && mutationGeneration.current === generation) reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      finishMutation(generation);
      if (mounted.current && mutationGeneration.current === generation) setOperation(null);
    }
  }, [reportError]);

  const stop = useCallback(async () => {
    const generation = beginMutation();
    setOperation("stop");
    try {
      const { webApp } = await stopOpenDesign();
      applyMutation(generation, webApp);
    } catch (reason) {
      if (mounted.current && mutationGeneration.current === generation) reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      finishMutation(generation);
      if (mounted.current && mutationGeneration.current === generation) setOperation(null);
    }
  }, [reportError]);

  const checkUpdate = useCallback(async () => {
    const generation = beginMutation();
    setOperation("check");
    try {
      const { webApp } = await checkOpenDesignUpdate();
      applyMutation(generation, webApp);
    } catch (reason) {
      if (mounted.current && mutationGeneration.current === generation) reportError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      finishMutation(generation);
      if (mounted.current && mutationGeneration.current === generation) setOperation(null);
    }
  }, [reportError]);

  const update = useCallback(async () => {
    const generation = beginMutation();
    try {
      await updateOpenDesign();
      finishMutation(generation);
      await refresh();
    } catch (reason) {
      finishMutation(generation);
      if (mounted.current && mutationGeneration.current === generation) reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [refresh, reportError]);

  return { apps, openDesign, operation, refresh, install, start, stop, checkUpdate, update };
}
