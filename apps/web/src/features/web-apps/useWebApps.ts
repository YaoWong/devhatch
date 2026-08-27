import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkOpenDesignUpdate,
  installOpenDesign,
  startOpenDesign,
  stopOpenDesign,
  updateOpenDesign,
  webApps,
} from "../../api/web-apps";
import type { WebApp, WebAppOperation } from "../../types/web-apps";

export function operationBusy(local: WebAppOperation | null, app: WebApp | null) {
  return local ?? app?.operation ?? null;
}

export function useWebApps(active: boolean, reportError: (message: string) => void) {
  const [apps, setApps] = useState<WebApp[]>([]);
  const [localOperation, setLocalOperation] = useState<WebAppOperation | null>(null);
  const mounted = useRef(false);
  const refreshGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const mutationOperation = useRef<WebAppOperation | null>(null);
  const pollInFlight = useRef(false);
  const openDesign = apps.find((app) => app.id === "open-design") ?? null;
  const operation = operationBusy(localOperation, openDesign);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      refreshGeneration.current += 1;
      mutationGeneration.current += 1;
      mutationOperation.current = null;
      pollInFlight.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const data = await webApps();
      if (mounted.current && refreshGeneration.current === generation) setApps(data.webApps);
    } catch (reason) {
      if (mounted.current && refreshGeneration.current === generation) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  }, [reportError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!active && !operation) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (!pollInFlight.current) {
        pollInFlight.current = true;
        try {
          await refresh();
        } finally {
          pollInFlight.current = false;
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, operation === "install" || operation === "update" ? 1000 : 3000);
    };
    timer = window.setTimeout(poll, operation === "install" || operation === "update" ? 1000 : 3000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, operation, refresh]);

  const beginMutation = useCallback((next: WebAppOperation) => {
    if (mutationOperation.current !== null || openDesign?.operation) return null;
    mutationOperation.current = next;
    const generation = ++mutationGeneration.current;
    refreshGeneration.current += 1;
    setLocalOperation(next);
    return generation;
  }, [openDesign?.operation]);

  const finishMutation = useCallback((generation: number) => {
    if (mutationGeneration.current !== generation) return;
    mutationOperation.current = null;
    if (mounted.current) setLocalOperation(null);
  }, []);

  const applyMutation = useCallback((generation: number, webApp: WebApp) => {
    if (mounted.current && mutationGeneration.current === generation) {
      setApps((current) => current.map((app) => (app.id === webApp.id ? webApp : app)));
    }
  }, []);

  const reportMutationError = useCallback((generation: number, reason: unknown) => {
    if (mounted.current && mutationGeneration.current === generation) {
      reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [reportError]);

  const install = useCallback(async () => {
    const generation = beginMutation("install");
    if (generation === null) return;
    try {
      await installOpenDesign();
      await refresh();
    } catch (reason) {
      reportMutationError(generation, reason);
    } finally {
      finishMutation(generation);
    }
  }, [beginMutation, finishMutation, refresh, reportMutationError]);

  const start = useCallback(async () => {
    const generation = beginMutation("start");
    if (generation === null) return;
    try {
      const { webApp } = await startOpenDesign();
      applyMutation(generation, webApp);
    } catch (reason) {
      reportMutationError(generation, reason);
    } finally {
      finishMutation(generation);
    }
  }, [applyMutation, beginMutation, finishMutation, reportMutationError]);

  const stop = useCallback(async () => {
    const generation = beginMutation("stop");
    if (generation === null) return;
    try {
      const { webApp } = await stopOpenDesign();
      applyMutation(generation, webApp);
    } catch (reason) {
      reportMutationError(generation, reason);
    } finally {
      finishMutation(generation);
    }
  }, [applyMutation, beginMutation, finishMutation, reportMutationError]);

  const checkUpdate = useCallback(async () => {
    const generation = beginMutation("check");
    if (generation === null) return;
    try {
      const { webApp } = await checkOpenDesignUpdate();
      applyMutation(generation, webApp);
    } catch (reason) {
      reportMutationError(generation, reason);
    } finally {
      finishMutation(generation);
    }
  }, [applyMutation, beginMutation, finishMutation, reportMutationError]);

  const update = useCallback(async () => {
    const generation = beginMutation("update");
    if (generation === null) return;
    try {
      await updateOpenDesign();
      await refresh();
    } catch (reason) {
      reportMutationError(generation, reason);
    } finally {
      finishMutation(generation);
    }
  }, [beginMutation, finishMutation, refresh, reportMutationError]);

  return { apps, openDesign, operation, refresh, install, start, stop, checkUpdate, update };
}
