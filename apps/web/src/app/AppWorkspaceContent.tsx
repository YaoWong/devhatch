import type { Dispatch, SetStateAction } from "react";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { AgentWorkspace } from "../features/agents/AgentWorkspace";
import { SettingsView, type SettingsSection } from "../features/settings/SettingsView";
import type { SkillsSection } from "../features/skills/SkillsRailPage";
import { SkillsWorkspace } from "../features/skills/SkillsWorkspace";
import type { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { TerminalWorkspace } from "../features/terminals/TerminalWorkspace";
import type { useTerminalWorkspace } from "../features/terminals/useTerminalWorkspace";
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
  terminalThumbnailsHidden: boolean;
  error: string | null;
  skillsSection: SkillsSection;
  settingsSection: SettingsSection;
  confirmDelete: boolean;
  onCloseSession: (session: TerminalInfo, isAgent: boolean) => void;
  onPickAgentPath: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
  onConfirm: Dispatch<SetStateAction<ConfirmAction | null>>;
  onConfirmDeleteChange: (enabled: boolean) => void;
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
  terminalThumbnailsHidden,
  error,
  skillsSection,
  settingsSection,
  confirmDelete,
  onCloseSession,
  onPickAgentPath,
  onPhaseChange,
  onError,
  onDismissError,
  onConfirm,
  onConfirmDeleteChange,
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
        thumbnailsHidden={terminalThumbnailsHidden}
        error={error}
        onActivate={terminal.activateSession}
        onRename={terminal.renameSession}
        onClose={(session) => onCloseSession(session, false)}
        onCreate={(cwd) => void terminal.addTerminal(cwd)}
        onPhaseChange={onPhaseChange}
        onError={onError}
        onDismissError={onDismissError}
      />
      <AgentWorkspace
        visible={mode === "agent"}
        busy={busy}
        sessions={agent.sessions}
        displaySessions={agent.displaySessions}
        activeId={agent.activeId}
        activeSession={agent.activeSession}
        selectedAgent={agent.selectedAgent}
        phases={phases}
        focusVersion={focusVersion}
        error={error}
        onActivate={agent.activateSession}
        onRename={agent.renameSession}
        onClose={(session) => onCloseSession(session, true)}
        onChoosePath={onPickAgentPath}
        onPhaseChange={onPhaseChange}
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
          section={settingsSection}
          confirmDelete={confirmDelete}
          onConfirmDeleteChange={onConfirmDeleteChange}
          onLogout={onLogout}
          logoutBusy={logoutBusy}
          logoutError={logoutError}
        />
      )}
    </>
  );
}
