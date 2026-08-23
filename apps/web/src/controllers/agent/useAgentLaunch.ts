import { useCallback } from "react";
import { createAgentSession, touchAgentLaunchPath } from "../../api";
import type { Agent } from "../../types";
import { logicalPath } from "../../utils";
import { errorMessage, type HomePaths } from "./shared";

export function useAgentLaunch({
  agents,
  selectedAgentId,
  selectedConfigId,
  selectedSkillProfileId,
  homePaths,
  reportError,
  closeSidebar,
  bumpFocus,
  onLaunched,
  addSession,
  refreshHistory,
  refreshData,
}: {
  agents: Agent[];
  selectedAgentId: string | null;
  selectedConfigId: string | null;
  selectedSkillProfileId: string | null;
  homePaths: HomePaths;
  reportError: (message: string) => void;
  closeSidebar: () => void;
  bumpFocus: () => void;
  onLaunched: () => void;
  addSession: (session: Awaited<ReturnType<typeof createAgentSession>>["agentSession"]) => void;
  refreshHistory: () => Promise<void>;
  refreshData: () => Promise<void>;
}) {
  return useCallback(
    async ({ cwd, upstreamSessionId, pathId }: { cwd?: string; upstreamSessionId?: string; pathId?: string }) => {
      const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
      if (!selectedAgent?.available) {
        reportError(`${selectedAgent?.name ?? "Agent"} is unavailable`);
        return;
      }
      try {
        if (pathId) await touchAgentLaunchPath(pathId);
        const launchOptions = upstreamSessionId
          ? {
              upstreamSessionId,
              launchConfigId: selectedConfigId ?? undefined,
              skillProfileId: selectedSkillProfileId ?? undefined,
            }
          : { cwd, launchConfigId: selectedConfigId ?? undefined, skillProfileId: selectedSkillProfileId ?? undefined };
        const { agentSession } = await createAgentSession(launchOptions);
        addSession({
          ...agentSession,
          cwd: logicalPath(agentSession.cwd, homePaths?.home, homePaths?.resolvedHome),
        });
        onLaunched();
        closeSidebar();
        bumpFocus();
        await Promise.all([refreshHistory(), refreshData()]);
      } catch (reason) {
        reportError(errorMessage(reason));
      }
    },
    [
      addSession,
      agents,
      bumpFocus,
      closeSidebar,
      homePaths,
      onLaunched,
      refreshData,
      refreshHistory,
      reportError,
      selectedAgentId,
      selectedConfigId,
      selectedSkillProfileId,
    ],
  );
}
