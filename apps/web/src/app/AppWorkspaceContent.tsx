import { lazy, Suspense, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Bot } from "lucide-react";
import { pasteAgentImage } from "../api/agents";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { SettingsView } from "../features/settings/SettingsView";
import type { SkillsSection } from "../features/skills/SkillsRailPage";
import type { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { TerminalWorkspace } from "../features/terminals/TerminalWorkspace";
import type { TerminalLayoutCount, TerminalWorkspaceLayoutPreferences } from "../features/terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import type { useWorkspaceController } from "../features/terminals/useWorkspaceController";
import { WebAppsWorkspace } from "../features/web-apps/WebApps";
import type { useWebApps } from "../features/web-apps/useWebApps";
import type { ConfirmAction, WorkspaceMode } from "../types/app";
import type { ConnectionPhase } from "../types/terminals";
import { isAgentSession, sessionKey, type WorkspaceSession } from "../types/workspaces";

const SkillsWorkspace = lazy(() => import("../features/skills/SkillsWorkspace").then((module) => ({ default: module.SkillsWorkspace })));

type AppWorkspaceContentProps = {
  mode: WorkspaceMode;
  workspace: ReturnType<typeof useWorkspaceController>;
  agent: ReturnType<typeof useAgentWorkspace>;
  skills: ReturnType<typeof useSkillsWorkspace>;
  webApps: ReturnType<typeof useWebApps>;
  busy: boolean;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  capacity: TerminalWorkspaceCapacity;
  thumbnailsAutoHide: boolean;
  thumbnailSide: "left" | "right";
  workspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  error: string | null;
  skillsSection: SkillsSection;
  onCloseSession: (session: WorkspaceSession, returnFocus?: HTMLElement | null, fallbackFocus?: HTMLElement | null) => void;
  onPhaseChange: (key: string, phase: ConnectionPhase) => void;
  onLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
  onConfirm: Dispatch<SetStateAction<ConfirmAction | null>>;
  onOpenTerminalLink: (url: string) => void;
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
};

export function AppWorkspaceContent({
  mode,
  workspace,
  agent,
  skills,
  webApps,
  busy,
  phases,
  focusVersion,
  capacity,
  thumbnailsAutoHide,
  thumbnailSide,
  workspaceLayouts,
  error,
  skillsSection,
  onCloseSession,
  onPhaseChange,
  onLayoutCountChange,
  onWorkspaceLayoutChange,
  onError,
  onDismissError,
  onConfirm,
  onOpenTerminalLink,
  onLogout,
  logoutBusy,
  logoutError,
}: AppWorkspaceContentProps) {
  const [webAppsVisited, setWebAppsVisited] = useState(mode === "webapp");
  useEffect(() => {
    if (mode === "webapp") setWebAppsVisited(true);
  }, [mode]);
  const webAppsMounted = webAppsVisited || mode === "webapp";
  const displaySessions = useMemo(() => {
    const namedAgents = new Map(agent.displaySessions.map((session) => [sessionKey(session), session]));
    return workspace.visibleSessions.map((session) => namedAgents.get(sessionKey(session)) ?? session);
  }, [agent.displaySessions, workspace.visibleSessions]);
  return (
    <>
      <TerminalWorkspace
        visible={mode === "terminal"}
        busy={busy}
        launching={workspace.terminalLaunching || agent.launching}
        visibleSessions={displaySessions}
        workspace={workspace.selectedWorkspace}
        workspaceLabel="workspace"
        sessionLabel="session"
        emptyIcon={<Bot />}
        phases={phases}
        focusVersion={focusVersion}
        capacity={capacity}
        thumbnailsAutoHide={thumbnailsAutoHide}
        thumbnailSide={thumbnailSide}
        workspaceLayouts={workspaceLayouts}
        error={error}
        onActivate={workspace.activateSession}
        onRename={workspace.renameSession}
        onClose={onCloseSession}
        onCreate={(cwd) => void workspace.addTerminal(cwd)}
        onPhaseChange={onPhaseChange}
        onLayoutCountChange={onLayoutCountChange}
        onWorkspaceLayoutChange={onWorkspaceLayoutChange}
        onRemoved={(ref) => {
          workspace.removeLocalSession(ref);
          void agent.refreshHistory();
        }}
        onUpstreamSessionChange={(ref, upstreamId, cwd) => {
          workspace.updateUpstreamSession(ref, upstreamId, cwd);
          void agent.refreshHistory();
        }}
        runtimeImagePaste={(session) => {
          if (!isAgentSession(session) || !agent.agents.find((item) => item.id === session.agentId)?.supportsImagePaste) return undefined;
          return (image, signal) => pasteAgentImage(session.id, image, signal);
        }}
        onOpenLink={onOpenTerminalLink}
        onError={onError}
        onDismissError={onDismissError}
      />
      {webAppsMounted && (
        <div className={`tw:min-h-0 tw:grid tw:grid-rows-[minmax(0,1fr)] ${mode === "webapp" ? "" : "tw:pointer-events-none tw:absolute tw:size-px tw:overflow-hidden tw:invisible"}`} aria-hidden={mode !== "webapp"} inert={mode !== "webapp" ? true : undefined}>
          <WebAppsWorkspace app={webApps.openDesign} operation={webApps.operation} error={error} settled={webApps.settled} loadError={webApps.loadError} onRetry={webApps.retry} onInstall={webApps.install} onStart={webApps.start} onUpdate={webApps.update} onCheckUpdate={webApps.checkUpdate} onConfirm={onConfirm} onDismissError={onDismissError} />
        </div>
      )}
      {mode === "skills" && (
        <Suspense fallback={<div className="tw:grid tw:min-h-0 tw:place-content-center tw:bg-[var(--color-canvas)] tw:text-sm tw:text-muted-foreground" role="status">Loading Skills…</div>}>
          <SkillsWorkspace section={skillsSection} controller={skills} error={error} onDismissError={onDismissError} onConfirm={onConfirm} />
        </Suspense>
      )}
      {mode === "settings" && <SettingsView onLogout={onLogout} logoutBusy={logoutBusy} logoutError={logoutError} onConfirm={onConfirm} />}
    </>
  );
}
