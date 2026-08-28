import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import "@xterm/xterm/css/xterm.css";
import { AppDialogs } from "./AppDialogs";
import { AppHeader } from "./AppHeader";
import { AppNavigationRail } from "./AppNavigationRail";
import { AppWorkspaceContent } from "./AppWorkspaceContent";
import { getModeSubtitle } from "./modeSubtitle";
import { useInitialWorkspaceData } from "./useInitialWorkspaceData";
import { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { useNavigation } from "../features/navigation/useNavigation";
import type { SettingsSection } from "../features/settings/SettingsView";
import { useTheme } from "../shared/theme/ThemeContext";
import type { SkillsSection } from "../features/skills/SkillsRailPage";
import { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { useTerminalWorkspace } from "../features/terminals/useTerminalWorkspace";
import {
  clampTerminalWorkspaceCapacity,
  TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY,
  type TerminalWorkspaceCapacity,
} from "../features/terminals/terminalWorkspaceDock";
import { useWebApps } from "../features/web-apps/useWebApps";
import { RailResizeHandle } from "../shared/ui/RailResizeHandle";
import type { ConfirmAction, DeleteTarget } from "../types/app";
import type { ConnectionPhase, TerminalInfo } from "../types/terminals";
import "./styles/index.css";

const TERMINAL_ROWS_STORAGE_KEY = "devhatch-terminal-workspace-rows";

function initialTerminalCapacity(): TerminalWorkspaceCapacity {
  try {
    const stored = localStorage.getItem(TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY) ?? localStorage.getItem(TERMINAL_ROWS_STORAGE_KEY) ?? "1";
    const capacity = clampTerminalWorkspaceCapacity(Number(stored));
    localStorage.setItem(TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY, String(capacity));
    localStorage.removeItem(TERMINAL_ROWS_STORAGE_KEY);
    return capacity;
  } catch {
    return 1;
  }
}

function App({ onLogout, logoutBusy, logoutError }: { onLogout: () => Promise<void>; logoutBusy: boolean; logoutError: string | null }) {
  const {
    agentLaunchPathsMaxHeightPx,
    navigationRailWidthPx,
    setNavigationRailWidthPx,
  } = useTheme();
  const [draftRailWidth, setDraftRailWidth] = useState(navigationRailWidthPx);
  const [railResizing, setRailResizing] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const [homePaths, setHomePaths] = useState<{ home: string; resolvedHome: string } | null>(null);
  const [phases, setPhases] = useState<Record<string, ConnectionPhase>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerPurpose, setPickerPurpose] = useState<"add-launch-path" | "new-terminal-workspace" | "agent" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(
    () => localStorage.getItem("devhatch-confirm-terminal-delete") === "1",
  );
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [skillsSection, setSkillsSection] = useState<SkillsSection>("repositories");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const [terminalCapacity, setTerminalCapacityState] = useState<TerminalWorkspaceCapacity>(initialTerminalCapacity);
  const [terminalThumbnailsHidden, setTerminalThumbnailsHidden] = useState(false);
  const terminalCapacityTransitionRef = useRef<ViewTransition | null>(null);
  const setTerminalCapacity = useCallback((value: TerminalWorkspaceCapacity) => {
    const update = () => setTerminalCapacityState(value);
    const activeTransition = terminalCapacityTransitionRef.current;
    if (activeTransition) {
      try { activeTransition.skipTransition(); } catch { void activeTransition.finished.catch(() => undefined); }
      terminalCapacityTransitionRef.current = null;
      document.documentElement.classList.remove("terminal-stage-transition");
      flushSync(update);
    } else {
      const startViewTransition = document.startViewTransition?.bind(document);
      if (!startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) update();
      else {
        document.documentElement.classList.add("terminal-stage-transition");
        try {
          const transition = startViewTransition(() => flushSync(update));
          terminalCapacityTransitionRef.current = transition;
          void transition.finished.catch(() => undefined).finally(() => {
            if (terminalCapacityTransitionRef.current !== transition) return;
            terminalCapacityTransitionRef.current = null;
            document.documentElement.classList.remove("terminal-stage-transition");
          });
        } catch {
          document.documentElement.classList.remove("terminal-stage-transition");
          update();
        }
      }
    }
    try { localStorage.setItem(TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY, String(value)); } catch { return; }
  }, []);
  useEffect(() => setDraftRailWidth(navigationRailWidthPx), [navigationRailWidthPx]);
  const bumpFocus = useCallback(() => setFocusVersion((value) => value + 1), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const closePicker = useCallback(() => setPickerPurpose(null), []);
  const navigation = useNavigation(bumpFocus);
  const { selectMode } = navigation;
  useEffect(() => {
    const modes = ["terminal", "agent", "skills", "webapp", "settings"] as const;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        !(target instanceof HTMLElement) ||
        target.matches("input, textarea, select") || target.isContentEditable
      ) return;
      const index = Number(event.key) - 1;
      const mode = modes[index];
      if (!mode) return;
      event.preventDefault();
      selectMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectMode]);
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
  const {
    initialize: initializeTerminals,
    initializeLaunchPaths: initializeTerminalLaunchPaths,
    initializeWorkspaces: initializeTerminalWorkspaces,
    deleteSession: deleteTerminalSession,
  } = terminal;

  const markReady = useCallback(() => setBusy(false), []);
  useInitialWorkspaceData({
    initializeTerminals,
    initializeTerminalLaunchPaths,
    initializeTerminalWorkspaces,
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
      const succeeded = await confirmAction.action();
      if (succeeded !== false) setConfirmAction(null);
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
    selectedWorkspace: terminal.selectedWorkspace
      ? (terminal.selectedWorkspace.name || "Terminal Workspace")
      : null,
    homePaths,
  });

  return (
    <main
      style={
        {
          "--agent-launch-paths-max-height": `${agentLaunchPathsMaxHeightPx}px`,
          "--navigation-rail-width": `${draftRailWidth}px`,
        } as CSSProperties
      }
      className={
        `app ${navigation.sidebarOpen ? "drawer-open" : ""} ` +
        `${navigation.sidebarHidden ? "sidebar-hidden" : ""} ${railResizing ? "rail-resizing" : ""}`
      }
    >
      <AppDialogs
        pickerPurpose={pickerPurpose}
        pickerInitialPath={
          pickerPurpose === "agent"
            ? (agent.activeSession?.cwd ?? terminal.activeSession?.cwd ?? undefined)
            : (terminal.activeSession?.cwd ?? undefined)
        }
        onClosePicker={closePicker}
        onSelectPath={(path) => {
          if (pickerPurpose === "agent") {
            void agent.choosePath(path).then((added) => {
              if (added) closePicker();
            });
          } else if (pickerPurpose === "new-terminal-workspace") {
            void terminal.addTerminal(path, true).then((created) => {
              if (created) closePicker();
            });
          } else {
             void terminal.chooseLaunchPath(path).then((added) => {
              if (added) setPickerPurpose(null);
            });
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
        onPickWorkspace={() => setPickerPurpose("add-launch-path")}
        onNewWorkspace={() => setPickerPurpose("new-terminal-workspace")}
        onPickAgentPath={() => setPickerPurpose("agent")}
        onCloseAgentSession={(session) => requestClose(session, true)}
        onConfirm={setConfirmAction}
      />
      <RailResizeHandle
        value={draftRailWidth}
        hidden={navigation.sidebarHidden}
        onPreview={setDraftRailWidth}
        onCommit={setNavigationRailWidthPx}
        onResizingChange={setRailResizing}
      />
      <section className="shell">
        <AppHeader
          mode={navigation.workspaceMode}
          label={navigation.modeMeta[navigation.workspaceMode].label}
          subtitle={modeSubtitle}
          onToggleNavigation={navigation.toggleSidebar}
          terminalCapacity={terminalCapacity}
          terminalThumbnailsHidden={terminalThumbnailsHidden}
          onTerminalCapacityChange={setTerminalCapacity}
          onToggleTerminalThumbnails={() => setTerminalThumbnailsHidden((hidden) => !hidden)}
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
          terminalCapacity={terminalCapacity}
          terminalThumbnailsHidden={terminalThumbnailsHidden}
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
          logoutBusy={logoutBusy}
          logoutError={logoutError}
        />
      </section>
    </main>
  );
}

export default App;
