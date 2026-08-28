import { useEffect } from "react";
import { agentPaths, agents, agentSessions } from "../api/agents";
import { terminalLaunchPaths, terminals, terminalWorkspaces } from "../api/terminals";

type HomePaths = { home: string; resolvedHome: string } | null;
type Terminals = Awaited<ReturnType<typeof terminals>>;
type TerminalLaunchPaths = Awaited<ReturnType<typeof terminalLaunchPaths>>;
type TerminalWorkspaces = Awaited<ReturnType<typeof terminalWorkspaces>>;
type Agents = Awaited<ReturnType<typeof agents>>;
type Sessions = Awaited<ReturnType<typeof agentSessions>>;
type Paths = Awaited<ReturnType<typeof agentPaths>>;

export function useInitialWorkspaceData({
  initializeTerminals,
  initializeTerminalLaunchPaths,
  initializeTerminalWorkspaces,
  initializeAgents,
  initializeSessions,
  initializePaths,
  onError,
  onReady,
}: {
  initializeTerminals: (data: Terminals) => void;
  initializeTerminalLaunchPaths: (data: TerminalLaunchPaths, homePaths: HomePaths) => void;
  initializeTerminalWorkspaces: (data: TerminalWorkspaces) => void;
  initializeAgents: (data: Agents) => void;
  initializeSessions: (data: Sessions, homePaths: HomePaths) => void;
  initializePaths: (data: Paths) => void;
  onError: (message: string) => void;
  onReady: () => void;
}) {
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      terminals(),
      terminalLaunchPaths(),
      terminalWorkspaces(),
      agents(),
      agentSessions(),
      agentPaths(),
    ]).then((results) => {
      if (cancelled) return;
      const terminalResult = results[0];
      const homePaths =
        terminalResult.status === "fulfilled"
          ? { home: terminalResult.value.home, resolvedHome: terminalResult.value.resolvedHome }
          : null;
      if (terminalResult.status === "fulfilled") initializeTerminals(terminalResult.value);
      if (results[1].status === "fulfilled") initializeTerminalLaunchPaths(results[1].value, homePaths);
      if (results[2].status === "fulfilled") initializeTerminalWorkspaces(results[2].value);
      if (results[3].status === "fulfilled") initializeAgents(results[3].value);
      if (results[4].status === "fulfilled") initializeSessions(results[4].value, homePaths);
      if (results[5].status === "fulfilled") initializePaths(results[5].value);
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
    initializePaths,
    initializeSessions,
    initializeTerminalLaunchPaths,
    initializeTerminalWorkspaces,
    initializeTerminals,
    onError,
    onReady,
  ]);
}
