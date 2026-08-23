import { useCallback, useState } from "react";
import { LoaderCircle, Menu, PanelLeftClose, Plus, Square } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { ActionDialog, DeleteSessionDialog } from "./Dialogs";
import { WorkspacePicker } from "./WorkspacePicker";
import { useAgentWorkspace } from "./controllers/useAgentWorkspace";
import { useInitialWorkspaceData } from "./controllers/useInitialWorkspaceData";
import { useNavigation } from "./controllers/useNavigation";
import { useSkillsWorkspace } from "./controllers/useSkillsWorkspace";
import { useTerminalWorkspace } from "./controllers/useTerminalWorkspace";
import { useWebApps } from "./controllers/useWebApps";
import type { ConfirmAction, ConnectionPhase, DeleteTarget, TerminalInfo } from "./types";
import { displayPath } from "./utils";
import { AgentRailPage } from "./views/AgentRailPage";
import { AgentWorkspace } from "./views/AgentWorkspace";
import { NavigationRail } from "./views/NavigationRail";
import { SettingsView } from "./views/SettingsView";
import { SkillsRailPage, type SkillsSection } from "./views/SkillsRailPage";
import { SkillsWorkspace } from "./views/SkillsWorkspace";
import { TerminalWorkspace } from "./views/TerminalWorkspace";
import { WebAppsRailPage, WebAppsWorkspace } from "./views/WebApps";
import { WorkspaceList } from "./views/WorkspaceList";
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
    initializeConfigs,
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
    initializeConfigs,
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

  const modeSubtitle =
    navigation.workspaceMode === "settings"
      ? "Preferences for your DevHatch workspace"
      : navigation.workspaceMode === "skills"
        ? "Repositories, reusable skills, and launch profiles"
      : navigation.workspaceMode === "webapp"
        ? webApps.openDesign?.running
          ? `OpenDesign v${webApps.openDesign.version ?? ""} · Running locally`
          : "Install and run local developer web apps"
        : navigation.workspaceMode === "agent"
        ? agent.activeSession
          ? `${displayPath(
              agent.activeSession.cwd,
              homePaths?.home,
              homePaths?.resolvedHome,
            )} · ${agent.activeSession.agentName}`
          : (agent.selectedAgent?.name ?? "No agent selected")
        : terminal.selectedWorkspace
          ? displayPath(terminal.selectedWorkspace, homePaths?.home, homePaths?.resolvedHome)
          : "No workspace selected";

  return (
    <main
      className={
        `app ${navigation.sidebarOpen ? "drawer-open" : ""} ` + `${navigation.sidebarHidden ? "sidebar-hidden" : ""}`
      }
    >
      {pickerPurpose && (
        <WorkspacePicker
          purpose={pickerPurpose}
          initialPath={
            pickerPurpose === "agent"
              ? (agent.activeSession?.cwd ?? terminal.selectedWorkspace ?? undefined)
              : (terminal.selectedWorkspace ?? undefined)
          }
          onClose={() => setPickerPurpose(null)}
          onSelect={(path) => {
            if (pickerPurpose === "agent") {
              void agent.choosePath(path);
            } else {
              terminal.chooseWorkspace(path);
              setPickerPurpose(null);
            }
          }}
        />
      )}
      {confirmAction && (
        <ActionDialog
          action={{ ...confirmAction, action: runConfirmAction }}
          busy={actionBusy}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {deleteCandidate && (
        <DeleteSessionDialog
          target={deleteCandidate}
          deleting={deleting}
          onCancel={() => setDeleteCandidate(null)}
          onConfirm={() => void deleteSession(deleteCandidate)}
        />
      )}
      <button className="drawer-backdrop" aria-label="Close navigation" onClick={navigation.closeSidebar} />
      <NavigationRail
        railPage={navigation.railPage}
        railMotion={navigation.railMotion}
        workspaceMode={navigation.workspaceMode}
        terminalCount={terminal.sessions.length}
        agentCount={agent.sessions.length}
        modesPageRef={navigation.modesPageRef}
        modeRefs={navigation.modeRefs}
        pageRefs={navigation.pageRefs}
        titleRefs={navigation.titleRefs}
        onNavigate={navigation.animateRail}
        terminalContent={
          <WorkspaceList
            workspaces={terminal.workspaces}
            selectedWorkspace={terminal.selectedWorkspace}
            homePaths={homePaths}
            onSelect={terminal.activateWorkspace}
            onAdd={() => setPickerPurpose("workspace")}
          />
        }
        agentContent={
          <AgentRailPage
            busy={busy}
            agents={agent.agents}
            selectedAgentId={agent.selectedAgentId}
            selectedAgent={agent.selectedAgent}
            configs={agent.configs}
            selectedConfigId={agent.selectedConfigId}
            profiles={skills.profiles}
            selectedProfileId={agent.selectedSkillProfileId}
            paths={agent.selectedPaths}
            selectedPathId={agent.selectedPathId}
            includeSubdirectories={agent.includeSubdirectories}
            activeSession={agent.activeSession}
            sessions={agent.sessions}
            historyCount={agent.history.sessions.length}
            rows={agent.mergedSessions}
            search={agent.search}
            homePaths={homePaths}
            onSelectAgent={agent.setSelectedAgentId}
            onSelectConfig={agent.setSelectedConfigId}
            onSelectProfile={agent.setSelectedSkillProfileId}
            onCreateConfig={agent.createConfig}
            onUpdateConfig={agent.updateConfig}
            onDeleteConfig={agent.deleteConfig}
            onChoosePath={() => setPickerPurpose("agent")}
            onSelectPath={(id) => agent.setSelectedPathId(agent.selectedPathId === id ? null : id)}
            onIncludeSubdirectoriesChange={agent.setIncludeSubdirectories}
            onLaunch={(path) => void agent.launch({ cwd: path.path, pathId: path.id })}
            onPinPath={agent.pinPath}
            onRenamePath={agent.renamePath}
            onDeletePath={agent.deletePath}
            onSearch={agent.setSearch}
            onActivateSession={agent.activateSession}
            onResume={(id) => agent.launch({ upstreamSessionId: id })}
            onDeleteLive={(session) => requestClose(session, true)}
            onConfirm={setConfirmAction}
            onDeleteHistory={agent.deleteHistorySession}
          />
        }
        skillsContent={<SkillsRailPage section={skillsSection} onSelect={setSkillsSection} />}
        webAppContent={
          <WebAppsRailPage
            app={webApps.openDesign}
            onInstall={webApps.install}
            onStart={webApps.start}
            onOpen={webApps.open}
            onConfirm={setConfirmAction}
          />
        }
      />
      <section className="shell">
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Toggle navigation" onClick={navigation.toggleSidebar}>
            <Menu className="menu-icon-open" />
            <PanelLeftClose className="menu-icon-hide" />
          </button>
          <div className="breadcrumb">
            <strong>{navigation.modeMeta[navigation.workspaceMode].label}</strong>
            <span>{modeSubtitle}</span>
          </div>
          {navigation.workspaceMode === "terminal" && (
            <div className="top-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  void terminal.addTerminal(terminal.activeSession?.cwd ?? terminal.selectedWorkspace ?? undefined)
                }
              >
                <Plus />
                <span>New terminal</span>
              </button>
            </div>
          )}
          {navigation.workspaceMode === "webapp" && webApps.openDesign?.running && (
            <div className="top-actions">
              <button className="secondary-button" disabled={webApps.operation !== null} onClick={() => void webApps.stop()}>
                {webApps.operation === "stop" ? <LoaderCircle className="spin" /> : <Square />}
                <span>{webApps.operation === "stop" ? "Stopping…" : "Stop"}</span>
              </button>
            </div>
          )}
        </header>
        <TerminalWorkspace
          visible={navigation.workspaceMode === "terminal"}
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
          onClose={(session) => requestClose(session, false)}
          onCreate={(cwd) => void terminal.addTerminal(cwd)}
          onPhaseChange={setPhase}
          onError={reportError}
          onDismissError={() => setError(null)}
        />
        <AgentWorkspace
          visible={navigation.workspaceMode === "agent"}
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
          onClose={(session) => requestClose(session, true)}
          onChoosePath={() => setPickerPurpose("agent")}
          onPhaseChange={setPhase}
          onRemoved={agent.removeSession}
          onUpstreamSessionChange={agent.updateUpstreamSession}
          onError={reportError}
          onDismissError={() => setError(null)}
        />
        {navigation.workspaceMode === "webapp" && (
          <WebAppsWorkspace
            app={webApps.openDesign}
            operation={webApps.operation}
            error={error}
            onInstall={webApps.install}
            onStart={webApps.start}
            onUpdate={webApps.update}
            onCheckUpdate={webApps.checkUpdate}
            onConfirm={setConfirmAction}
            onDismissError={() => setError(null)}
          />
        )}
        {navigation.workspaceMode === "skills" && (
          <SkillsWorkspace
            section={skillsSection}
            controller={skills}
            error={error}
            onDismissError={() => setError(null)}
          />
        )}
        {navigation.workspaceMode === "settings" && (
          <SettingsView
            confirmDelete={confirmDelete}
            onConfirmDeleteChange={(enabled) => {
              setConfirmDelete(enabled);
              localStorage.setItem("devhatch-confirm-terminal-delete", enabled ? "1" : "0");
            }}
            onLogout={onLogout}
          />
        )}
      </section>
    </main>
  );
}

export default App;
