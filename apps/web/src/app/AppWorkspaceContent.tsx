import type { Dispatch, SetStateAction } from "react";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { AgentWorkspace } from "../features/agents/AgentWorkspace";
import { SettingsView } from "../features/settings/SettingsView";
import type { SkillsSection } from "../features/skills/SkillsRailPage";
import { SkillsWorkspace } from "../features/skills/SkillsWorkspace";
import type { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { TerminalWorkspace } from "../features/terminals/TerminalWorkspace";
import type { useTerminalWorkspace } from "../features/terminals/useTerminalWorkspace";
import type { TerminalLayoutCount, TerminalWorkspaceLayoutPreferences } from "../features/terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import { WebAppsWorkspace } from "../features/web-apps/WebApps";
import type { useWebApps } from "../features/web-apps/useWebApps";
import type { ConfirmAction, WorkspaceMode } from "../types/app";
import type { ConnectionPhase, TerminalInfo } from "../types/terminals";

type AppWorkspaceContentProps = {
  mode: WorkspaceMode;
  terminal: ReturnType<typeof useTerminalWorkspace>;
  agent: ReturnType<typeof useAgentWorkspace>;
  skills: ReturnType<typeof useSkillsWorkspace>;
  webApps: ReturnType<typeof useWebApps>;
  busy: boolean;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalWorkspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  agentCapacity: TerminalWorkspaceCapacity;
  agentThumbnailsAutoHide: boolean;
  agentThumbnailSide: "left" | "right";
  agentWorkspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  error: string | null;
  skillsSection: SkillsSection;
  onCloseSession: (session: TerminalInfo, isAgent: boolean, returnFocus?: HTMLElement | null, fallbackFocus?: HTMLElement | null) => void;
  onPickAgentPath: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onTerminalLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onTerminalWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
  onAgentLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onAgentWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
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
  terminal,
  agent,
  skills,
  webApps,
  busy,
  phases,
  focusVersion,
  terminalCapacity,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalWorkspaceLayouts,
  agentCapacity,
  agentThumbnailsAutoHide,
  agentThumbnailSide,
  agentWorkspaceLayouts,
  error,
  skillsSection,
  onCloseSession,
  onPickAgentPath,
  onPhaseChange,
  onTerminalLayoutCountChange,
  onTerminalWorkspaceLayoutChange,
  onAgentLayoutCountChange,
  onAgentWorkspaceLayoutChange,
  onError,
  onDismissError,
  onConfirm,
  onOpenTerminalLink,
  onLogout,
  logoutBusy,
  logoutError,
}: AppWorkspaceContentProps) {
  return (
    <>
      <TerminalWorkspace
        visible={mode === "terminal"}
        busy={busy}
        launching={terminal.launching}
        sessions={terminal.sessions}
        visibleSessions={terminal.visibleSessions}
        workspace={terminal.selectedWorkspace}
        phases={phases}
        focusVersion={focusVersion}
        capacity={terminalCapacity}
        thumbnailsAutoHide={terminalThumbnailsAutoHide}
        thumbnailSide={terminalThumbnailSide}
        workspaceLayouts={terminalWorkspaceLayouts}
        error={error}
        onActivate={terminal.activateSession}
        onRename={terminal.renameSession}
        onClose={(session, returnFocus, fallbackFocus) => onCloseSession(session, false, returnFocus, fallbackFocus)}
        onCreate={(cwd) => void terminal.addTerminal(cwd)}
        onPhaseChange={onPhaseChange}
        onLayoutCountChange={onTerminalLayoutCountChange}
        onWorkspaceLayoutChange={onTerminalWorkspaceLayoutChange}
        onOpenLink={onOpenTerminalLink}
        onError={onError}
        onDismissError={onDismissError}
      />
      <AgentWorkspace
        visible={mode === "agent"}
        busy={busy}
        launching={agent.launching}
        displaySessions={agent.displaySessions}
        workspaceSessions={agent.workspaceSessions}
        selectedAgentWorkspaceId={agent.selectedAgentWorkspaceId}
        activeId={agent.activeId}
        selectedAgent={agent.selectedAgent}
        agents={agent.agents}
        phases={phases}
        focusVersion={focusVersion}
        capacity={agentCapacity}
        thumbnailsAutoHide={agentThumbnailsAutoHide}
        thumbnailSide={agentThumbnailSide}
        workspaceLayouts={agentWorkspaceLayouts}
        error={error}
        onActivate={agent.activateSession}
        onRename={agent.renameSession}
        onClose={(session, returnFocus, fallbackFocus) => onCloseSession(session, true, returnFocus, fallbackFocus)}
        onChoosePath={onPickAgentPath}
        onPhaseChange={onPhaseChange}
        onLayoutCountChange={onAgentLayoutCountChange}
        onWorkspaceLayoutChange={onAgentWorkspaceLayoutChange}
        onRemoved={agent.removeSession}
        onUpstreamSessionChange={agent.updateUpstreamSession}
        onOpenLink={onOpenTerminalLink}
        onError={onError}
        onDismissError={onDismissError}
      />
      {mode === "webapp" && (
        <WebAppsWorkspace
          app={webApps.openDesign}
          operation={webApps.operation}
          error={error}
          settled={webApps.settled}
          loadError={webApps.loadError}
          onRetry={webApps.retry}
          onInstall={webApps.install}
          onStart={webApps.start}
          onUpdate={webApps.update}
          onCheckUpdate={webApps.checkUpdate}
          onConfirm={onConfirm}
          onDismissError={onDismissError}
        />
      )}
      {mode === "skills" && (
        <SkillsWorkspace
          section={skillsSection}
          controller={skills}
          error={error}
          onDismissError={onDismissError}
          onConfirm={onConfirm}
        />
      )}
      {mode === "settings" && (
        <SettingsView
          onLogout={onLogout}
          logoutBusy={logoutBusy}
          logoutError={logoutError}
          onConfirm={onConfirm}
        />
      )}
    </>
  );
}
