import { useCallback, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { AppDialogs } from "./app/AppDialogs";
import { AppHeader } from "./app/AppHeader";
import { AppNavigationRail } from "./app/AppNavigationRail";
import { AppWorkspaceContent } from "./app/AppWorkspaceContent";
import { getModeSubtitle } from "./app/modeSubtitle";
import { useAgentWorkspace } from "./controllers/useAgentWorkspace";
import { useInitialWorkspaceData } from "./controllers/useInitialWorkspaceData";
import { useNavigation } from "./controllers/useNavigation";
import { useSkillsWorkspace } from "./controllers/useSkillsWorkspace";
import { useTerminalWorkspace } from "./controllers/useTerminalWorkspace";
import { useWebApps } from "./controllers/useWebApps";
import type { ConfirmAction, ConnectionPhase, DeleteTarget, TerminalInfo } from "./types";
import type { SettingsSection } from "./views/SettingsView";
import type { SkillsSection } from "./views/SkillsRailPage";
import "./App.css";

function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const [focusVersion, setFocusVersion] = useState(0);
  const [homePaths, setHomePaths] = useState<{ home: string; resolvedHome: string } | null>(null);
  const [phases, setPhases] = useState<Record<string, ConnectionPhase>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerPurpose, setPickerPurpose] = useState<"workspace" | "agent" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(
    () => localStorage.getItem("devhatch-confirm-terminal-delete") === "1",
  );
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [skillsSection, setSkillsSection] = useState<SkillsSection>("repositories");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const bumpFocus = useCallback(() => setFocusVersion((value) => value + 1), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const closePicker = useCallback(() => setPickerPurpose(null), []);
  const navigation = useNavigation(bumpFocus);
  const terminal = useTerminalWorkspace(homePaths, setHomePaths, reportError, navigation.closeSidebar, bumpFocus);
  const agent = useAgentWorkspace({
    homePaths,
    active: navigation.workspaceMode === "agent",
    reportError,
    closeSidebar: navigation.closeSidebar,
    bumpFocus,
    onLaunched: closePicker,
  });
  const webApps = useWebApps(navigation.workspaceMode === "webapp", reportError);
  const skills = useSkillsWorkspace(
    navigation.workspaceMode === "skills" || navigation.workspaceMode === "agent",
    reportError,
  );

  const {
    initializeAgents,
    initializePaths,
    initializeSessions,
    deleteSession: deleteAgentSession,
  } = agent;
  const { initialize: initializeTerminals, deleteSession: deleteTerminalSession } = terminal;

  const markReady = useCallback(() => setBusy(false), []);
  useInitialWorkspaceData({
    initializeTerminals,
    initializeAgents,
    initializeSessions,
    initializePaths,
    onError: reportError,
    onReady: markReady,
  });

  const setPhase = useCallback((id: string, phase: ConnectionPhase) => {
    setPhases((current) => (current[id] === phase ? current : { ...current, [id]: phase }));
  }, []);

  const deleteSession = useCallback(
    async (target: DeleteTarget) => {
      setDeleting(true);
      try {
        if (target.kind === "agent session") await deleteAgentSession(target);
        else await deleteTerminalSession(target);
        setPhases((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setDeleting(false);
        setDeleteCandidate(null);
      }
    },
    [deleteAgentSession, deleteTerminalSession],
  );

  const requestClose = useCallback(
    (session: TerminalInfo, isAgent: boolean) => {
      const target: DeleteTarget = {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        kind: isAgent ? "agent session" : "terminal",
      };
      if (confirmDelete) setDeleteCandidate(target);
      else void deleteSession(target);
    },
    [confirmDelete, deleteSession],
  );

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    setActionBusy(true);
    try {
      await confirmAction.action();
      setConfirmAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionBusy(false);
    }
  };

  const modeSubtitle = getModeSubtitle({
    mode: navigation.workspaceMode,
    openDesign: webApps.openDesign,
    activeAgentSession: agent.activeSession,
    selectedAgent: agent.selectedAgent,
    selectedWorkspace: terminal.selectedWorkspace,
    homePaths,
  });

  return (
    <main
      className={
        `app ${navigation.sidebarOpen ? "drawer-open" : ""} ` + `${navigation.sidebarHidden ? "sidebar-hidden" : ""}`
      }
    >
      <AppDialogs
        pickerPurpose={pickerPurpose}
        pickerInitialPath={
          pickerPurpose === "agent"
            ? (agent.activeSession?.cwd ?? terminal.selectedWorkspace ?? undefined)
            : (terminal.selectedWorkspace ?? undefined)
        }
        onClosePicker={closePicker}
        onSelectPath={(path) => {
          if (pickerPurpose === "agent") {
            void agent.choosePath(path).then((added) => {
              if (added) closePicker();
            });
          } else {
            terminal.chooseWorkspace(path);
            setPickerPurpose(null);
          }
        }}
        confirmAction={confirmAction}
        actionBusy={actionBusy}
        onRunConfirmAction={runConfirmAction}
        onCloseConfirmAction={() => setConfirmAction(null)}
        deleteCandidate={deleteCandidate}
        deleting={deleting}
        onCancelDelete={() => setDeleteCandidate(null)}
        onConfirmDelete={() => {
          if (deleteCandidate) void deleteSession(deleteCandidate);
        }}
      />
      <button className="drawer-backdrop" aria-label="Close navigation" onClick={navigation.closeSidebar} />
      <AppNavigationRail
        navigation={navigation}
        terminal={terminal}
        agent={agent}
        skills={skills}
        webApps={webApps}
        homePaths={homePaths}
        busy={busy}
        skillsSection={skillsSection}
        onSelectSkillsSection={setSkillsSection}
        settingsSection={settingsSection}
        onSelectSettingsSection={setSettingsSection}
        onPickWorkspace={() => setPickerPurpose("workspace")}
        onPickAgentPath={() => setPickerPurpose("agent")}
        onCloseAgentSession={(session) => requestClose(session, true)}
        onConfirm={setConfirmAction}
      />
      <section className="shell">
        <AppHeader
          mode={navigation.workspaceMode}
          label={navigation.modeMeta[navigation.workspaceMode].label}
          subtitle={modeSubtitle}
          onToggleNavigation={navigation.toggleSidebar}
          onNewTerminal={() =>
            void terminal.addTerminal(terminal.activeSession?.cwd ?? terminal.selectedWorkspace ?? undefined)
          }
          webAppRunning={Boolean(webApps.openDesign?.running)}
          webAppOperation={webApps.operation}
          onStopWebApp={() => void webApps.stop()}
        />
        <AppWorkspaceContent
          mode={navigation.workspaceMode}
          terminal={terminal}
          agent={agent}
          skills={skills}
          webApps={webApps}
          busy={busy}
          phases={phases}
          focusVersion={focusVersion}
          error={error}
          skillsSection={skillsSection}
          settingsSection={settingsSection}
          confirmDelete={confirmDelete}
          onCloseSession={requestClose}
          onPickAgentPath={() => setPickerPurpose("agent")}
          onPhaseChange={setPhase}
          onError={reportError}
          onDismissError={() => setError(null)}
          onConfirm={setConfirmAction}
          onConfirmDeleteChange={(enabled) => {
            setConfirmDelete(enabled);
            localStorage.setItem("devhatch-confirm-terminal-delete", enabled ? "1" : "0");
          }}
          onLogout={onLogout}
        />
      </section>
    </main>
  );
}

export default App;
