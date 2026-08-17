import { useEffect } from "react";
import { endpoints } from "../api";

type HomePaths = { home: string; resolvedHome: string } | null;
type Terminals = Awaited<ReturnType<typeof endpoints.terminals>>;
type Agents = Awaited<ReturnType<typeof endpoints.agents>>;
type Sessions = Awaited<ReturnType<typeof endpoints.agentSessions>>;
type Paths = Awaited<ReturnType<typeof endpoints.agentPaths>>;
type Configs = Awaited<ReturnType<typeof endpoints.agentLaunchConfigs>>;

export function useInitialWorkspaceData({
  initializeTerminals,
  initializeAgents,
  initializeSessions,
  initializePaths,
  initializeConfigs,
  onError,
  onReady,
}: {
  initializeTerminals: (data: Terminals) => void;
  initializeAgents: (data: Agents) => void;
  initializeSessions: (data: Sessions, homePaths: HomePaths) => void;
  initializePaths: (data: Paths) => void;
  initializeConfigs: (data: Configs) => void;
  onError: (message: string) => void;
  onReady: () => void;
}) {
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      endpoints.terminals(),
      endpoints.agents(),
      endpoints.agentSessions(),
      endpoints.agentPaths(),
      endpoints.agentLaunchConfigs("opencode"),
    ]).then((results) => {
      if (cancelled) return;
      const terminalResult = results[0];
      const homePaths =
        terminalResult.status === "fulfilled"
          ? { home: terminalResult.value.home, resolvedHome: terminalResult.value.resolvedHome }
          : null;
      if (terminalResult.status === "fulfilled") initializeTerminals(terminalResult.value);
      if (results[1].status === "fulfilled") initializeAgents(results[1].value);
      if (results[2].status === "fulfilled") initializeSessions(results[2].value, homePaths);
      if (results[3].status === "fulfilled") initializePaths(results[3].value);
      if (results[4].status === "fulfilled") initializeConfigs(results[4].value);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length) {
        onError(
          failures
            .map((failure) => (failure.reason instanceof Error ? failure.reason.message : String(failure.reason)))
            .join(" · "),
        );
      }
      onReady();
    });
    return () => {
      cancelled = true;
    };
  }, [
    initializeAgents,
    initializeConfigs,
    initializePaths,
    initializeSessions,
    initializeTerminals,
    onError,
    onReady,
  ]);
}
