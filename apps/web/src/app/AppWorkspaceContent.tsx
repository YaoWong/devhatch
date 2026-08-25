import type { Dispatch, SetStateAction } from "react";
import type { useAgentWorkspace } from "../controllers/useAgentWorkspace";
import type { useSkillsWorkspace } from "../controllers/useSkillsWorkspace";
import type { useTerminalWorkspace } from "../controllers/useTerminalWorkspace";
import type { useWebApps } from "../controllers/useWebApps";
import type { ConfirmAction, ConnectionPhase, TerminalInfo, WorkspaceMode } from "../types";
import { SkillsWorkspace } from "../features/skills/SkillsWorkspace";
import { AgentWorkspace } from "../views/AgentWorkspace";
import { SettingsView, type SettingsSection } from "../views/SettingsView";
import type { SkillsSection } from "../views/SkillsRailPage";
import { TerminalWorkspace } from "../views/TerminalWorkspace";
import { WebAppsWorkspace } from "../views/WebApps";

type AppWorkspaceContentProps = {
  mode: WorkspaceMode;
  terminal: ReturnType<typeof useTerminalWorkspace>;
  agent: ReturnType<typeof useAgentWorkspace>;
  skills: ReturnType<typeof useSkillsWorkspace>;
  webApps: ReturnType<typeof useWebApps>;
  busy: boolean;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
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
}: AppWorkspaceContentProps) {
  return (
    <>
      <TerminalWorkspace
        visible={mode === "terminal"}
        busy={busy}
        sessions={terminal.sessions}
        visibleSessions={terminal.visibleSessions}
        activeId={terminal.activeId}
        activeSession={terminal.activeSession}
        selectedWorkspace={terminal.selectedWorkspace}
        phases={phases}
        focusVersion={focusVersion}
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
        />
      )}
    </>
  );
}
