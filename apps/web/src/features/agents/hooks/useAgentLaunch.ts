import { useCallback, useRef, useState } from "react";
import { createAgentSession, touchAgentLaunchPath } from "../../../api/agents";
import type { Agent } from "../../../types/agents";
import { logicalPath } from "../../../shared/lib/utils";
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
  const launchingRef = useRef(false);
  const [launching, setLaunching] = useState(false);
  const launch = useCallback(
    async ({ cwd, upstreamSessionId, pathId }: { cwd?: string; upstreamSessionId?: string; pathId?: string }) => {
      if (launchingRef.current) return false;
      launchingRef.current = true;
      setLaunching(true);
      const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? null;
      if (!selectedAgent?.available) {
        reportError(`${selectedAgent?.name ?? "Agent"} is unavailable`);
        launchingRef.current = false;
        setLaunching(false);
        return false;
      }
      try {
        if (upstreamSessionId && !selectedAgent.supportsResume) {
          reportError(`${selectedAgent.name} does not support resuming sessions`);
          return false;
        }
        if (pathId) await touchAgentLaunchPath(pathId);
        const skillProfileId = selectedAgent.supportsSkills ? (selectedSkillProfileId ?? undefined) : undefined;
        const launchOptions = upstreamSessionId
          ? {
              agentId: selectedAgent.id,
              upstreamSessionId,
              launchConfigId: selectedConfigId ?? undefined,
              ...(skillProfileId ? { skillProfileId } : {}),
            }
          : {
              agentId: selectedAgent.id,
              cwd,
              launchConfigId: selectedConfigId ?? undefined,
              ...(skillProfileId ? { skillProfileId } : {}),
            };
        const { agentSession } = await createAgentSession(launchOptions);
        addSession({
          ...agentSession,
          cwd: logicalPath(agentSession.cwd, homePaths?.home, homePaths?.resolvedHome),
        });
        onLaunched();
        closeSidebar();
        bumpFocus();
        try {
          await Promise.all([refreshHistory(), refreshData()]);
        } catch (reason) {
          reportError(errorMessage(reason));
        }
        return true;
      } catch (reason) {
        reportError(errorMessage(reason));
        return false;
      } finally {
        launchingRef.current = false;
        setLaunching(false);
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
  return { launch, launching };
}
