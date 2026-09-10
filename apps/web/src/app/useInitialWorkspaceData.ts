import { useEffect } from "react";
import { agents } from "../api/agents";

type Agents = Awaited<ReturnType<typeof agents>>;

export function useInitialWorkspaceData({
  initializeWorkspace,
  initializeLaunchPaths,
  initializeAgents,
  onError,
  onReady,
}: {
  initializeWorkspace: () => Promise<void>;
  initializeLaunchPaths: () => Promise<void>;
  initializeAgents: (data: Agents) => void;
  onError: (message: string) => void;
  onReady: () => void;
}) {
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([initializeWorkspace(), initializeLaunchPaths(), agents()]).then((results) => {
      if (cancelled) return;
      if (results[2].status === "fulfilled") initializeAgents(results[2].value);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) {
        onError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join(" · "));
      }
      onReady();
    });
    return () => { cancelled = true; };
  }, [initializeAgents, initializeLaunchPaths, initializeWorkspace, onError, onReady]);
}
