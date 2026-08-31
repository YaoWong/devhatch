import type { Dispatch, SetStateAction } from "react";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { AgentWorkspace } from "../features/agents/AgentWorkspace";
import { SettingsView, type SettingsSection } from "../features/settings/SettingsView";
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
import type { LayoutMode } from "../types/settings";
import type { ConnectionPhase, TerminalInfo } from "../types/terminals";

type AppWorkspaceContentProps = {
  mode: WorkspaceMode;
  layoutMode: LayoutMode;
  terminal: ReturnType<typeof useTerminalWorkspace>;
  agent: ReturnType<typeof useAgentWorkspace>;
  skills: ReturnType<typeof useSkillsWorkspace>;
  webApps: ReturnType<typeof useWebApps>;
  busy: boolean;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalThumbnailsHidden: boolean;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalWorkspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  agentCapacity: TerminalWorkspaceCapacity;
  agentThumbnailsHidden: boolean;
  agentThumbnailsAutoHide: boolean;
  agentThumbnailSide: "left" | "right";
  agentWorkspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  error: string | null;
  skillsSection: SkillsSection;
  settingsSection: SettingsSection;
  onSelectSettingsSection: (section: SettingsSection) => void;
  onCloseSession: (session: TerminalInfo, isAgent: boolean) => void;
  onPickAgentPath: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onTerminalLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onTerminalWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
  onAgentLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onAgentWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
  onConfirm: Dispatch<SetStateAction<ConfirmAction | null>>;
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
};

export function AppWorkspaceContent({
  mode,
  layoutMode,
  terminal,
  agent,
  skills,
  webApps,
  busy,
  phases,
  focusVersion,
  terminalCapacity,
  terminalThumbnailsHidden,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalWorkspaceLayouts,
  agentCapacity,
  agentThumbnailsHidden,
  agentThumbnailsAutoHide,
  agentThumbnailSide,
  agentWorkspaceLayouts,
  error,
  skillsSection,
  settingsSection,
  onSelectSettingsSection,
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
  onLogout,
  logoutBusy,
  logoutError,
}: AppWorkspaceContentProps) {
  return (
    <>
      <TerminalWorkspace
        visible={mode === "terminal"}
        layoutMode={layoutMode}
        busy={busy}
        launching={terminal.launching}
        sessions={terminal.sessions}
        visibleSessions={terminal.visibleSessions}
        workspace={terminal.selectedWorkspace}
        phases={phases}
        focusVersion={focusVersion}
        capacity={terminalCapacity}
        thumbnailsHidden={terminalThumbnailsHidden}
        thumbnailsAutoHide={terminalThumbnailsAutoHide}
        thumbnailSide={terminalThumbnailSide}
        workspaceLayouts={terminalWorkspaceLayouts}
        error={error}
        onActivate={terminal.activateSession}
        onRename={terminal.renameSession}
        onClose={(session) => onCloseSession(session, false)}
        onCreate={(cwd) => void terminal.addTerminal(cwd)}
        onPhaseChange={onPhaseChange}
        onLayoutCountChange={onTerminalLayoutCountChange}
        onWorkspaceLayoutChange={onTerminalWorkspaceLayoutChange}
        onError={onError}
        onDismissError={onDismissError}
      />
      <AgentWorkspace
        visible={mode === "agent"}
        layoutMode={layoutMode}
        busy={busy}
        launching={agent.launching}
        displaySessions={agent.displaySessions}
        selectedSessions={agent.selectedSessions}
        activeId={agent.activeId}
        selectedAgent={agent.selectedAgent}
        phases={phases}
        focusVersion={focusVersion}
        capacity={agentCapacity}
        thumbnailsHidden={agentThumbnailsHidden}
        thumbnailsAutoHide={agentThumbnailsAutoHide}
        thumbnailSide={agentThumbnailSide}
        workspaceLayouts={agentWorkspaceLayouts}
        error={error}
        onActivate={agent.activateSession}
        onRename={agent.renameSession}
        onClose={(session) => onCloseSession(session, true)}
        onChoosePath={onPickAgentPath}
        onPhaseChange={onPhaseChange}
        onLayoutCountChange={onAgentLayoutCountChange}
        onWorkspaceLayoutChange={onAgentWorkspaceLayoutChange}
        onRemoved={agent.removeSession}
        onUpstreamSessionChange={agent.updateUpstreamSession}
        onError={onError}
        onDismissError={onDismissError}
      />
      {mode === "webapp" && (
        <WebAppsWorkspace
          app={webApps.openDesign}
          operation={webApps.operation}
          error={error}
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
        />
      )}
      {mode === "settings" && (
        <SettingsView
          layoutMode={layoutMode}
          section={settingsSection}
          onSelectSection={onSelectSettingsSection}
          onLogout={onLogout}
          logoutBusy={logoutBusy}
          logoutError={logoutError}
        />
      )}
    </>
  );
}
