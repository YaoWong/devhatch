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
  selectedAgentWorkspaceId,
  homePaths,
  reportError,
  closeSidebar,
  bumpFocus,
  onLaunched,
  addSession,
  launchSession,
  refreshHistory,
  refreshData,
}: {
  agents: Agent[];
  selectedAgentId: string | null;
  selectedConfigId: string | null;
  selectedSkillProfileId: string | null;
  selectedAgentWorkspaceId: string | null;
  homePaths: HomePaths;
  reportError: (message: string) => void;
  closeSidebar: () => void;
  bumpFocus: () => void;
  onLaunched: () => void;
  addSession: (session: Awaited<ReturnType<typeof createAgentSession>>["agentSession"]) => void;
  launchSession: (
    options: Parameters<typeof createAgentSession>[0],
    targetWorkspaceId: string | null,
    onCreated: (session: Awaited<ReturnType<typeof createAgentSession>>["agentSession"]) => void,
  ) => Promise<Awaited<ReturnType<typeof createAgentSession>> | null>;
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
      const targetWorkspaceId = selectedAgentWorkspaceId;
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
              workspaceId: selectedAgentWorkspaceId,
              ...(skillProfileId ? { skillProfileId } : {}),
            }
          : {
              agentId: selectedAgent.id,
              cwd,
              launchConfigId: selectedConfigId ?? undefined,
              workspaceId: selectedAgentWorkspaceId,
              ...(skillProfileId ? { skillProfileId } : {}),
            };
        const normalizeAndAdd = (agentSession: Awaited<ReturnType<typeof createAgentSession>>["agentSession"]) => addSession({
          ...agentSession,
          cwd: logicalPath(agentSession.cwd, homePaths?.home, homePaths?.resolvedHome),
        });
        const result = await launchSession(launchOptions, targetWorkspaceId, normalizeAndAdd);
        if (!result) return false;
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
      launchSession,
      agents,
      bumpFocus,
      closeSidebar,
      homePaths,
      onLaunched,
      refreshData,
      refreshHistory,
      reportError,
      selectedAgentId,
      selectedAgentWorkspaceId,
      selectedConfigId,
      selectedSkillProfileId,
    ],
  );
  return { launch, launching };
}
