import { useCallback, useEffect, useRef, useState, type Dispatch, type FocusEventHandler, type MouseEventHandler, type RefObject, type SetStateAction } from "react";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../features/terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import type { LayoutMode } from "../types/settings";
import type { ConfirmAction } from "../types/app";
import type { TerminalInfo } from "../types/terminals";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { AgentRailPage } from "../features/agents/AgentRailPage";
import { NavigationRail } from "../features/navigation/NavigationRail";
import type { useNavigation } from "../features/navigation/useNavigation";
import { SettingsRailPage, type SettingsSection } from "../features/settings/SettingsView";
import { SkillsRailPage, type SkillsSection } from "../features/skills/SkillsRailPage";
import type { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { WorkspaceList } from "../features/terminals/WorkspaceList";
import type { useTerminalWorkspace } from "../features/terminals/useTerminalWorkspace";
import { WebAppsRailPage } from "../features/web-apps/WebApps";
import type { useWebApps } from "../features/web-apps/useWebApps";

type AppNavigationRailProps = {
  navigation: ReturnType<typeof useNavigation>;
  terminal: ReturnType<typeof useTerminalWorkspace>;
  agent: ReturnType<typeof useAgentWorkspace>;
  skills: ReturnType<typeof useSkillsWorkspace>;
  webApps: ReturnType<typeof useWebApps>;
  homePaths: { home: string; resolvedHome: string } | null;
  busy: boolean;
  skillsSection: SkillsSection;
  onSelectSkillsSection: Dispatch<SetStateAction<SkillsSection>>;
  settingsSection: SettingsSection;
  onSelectSettingsSection: Dispatch<SetStateAction<SettingsSection>>;
  onPickWorkspace: () => void;
  onNewWorkspace: () => void;
  onPickAgentPath: () => void;
  onCloseAgentSession: (session: TerminalInfo) => void;
  onSessionSelected: () => void;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalLayoutCount: TerminalLayoutCount | null;
  terminalLayoutPreset: TerminalLayoutPreset | null;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalLaunchPathsHeight: number;
  confirmTerminalClose: boolean;
  agentCapacity: TerminalWorkspaceCapacity;
  agentLayoutCount: TerminalLayoutCount | null;
  agentLayoutPreset: TerminalLayoutPreset | null;
  agentThumbnailsAutoHide: boolean;
  agentThumbnailSide: "left" | "right";
  onTerminalCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onTerminalLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onToggleTerminalThumbnailAutoHide: () => void;
  onTerminalThumbnailSideChange: (side: "left" | "right") => void;
  onTerminalLaunchPathsHeightChange: (height: number) => void;
  onConfirmTerminalCloseChange: (enabled: boolean) => void;
  onAgentCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onAgentLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onToggleAgentThumbnailAutoHide: () => void;
  onAgentThumbnailSideChange: (side: "left" | "right") => void;
  onConfirm: Dispatch<SetStateAction<ConfirmAction | null>>;
  layoutMode: LayoutMode;
  canvasPinned: boolean;
  railInteractive: boolean;
  railId: string;
  railRef: RefObject<HTMLElement | null>;
  onCanvasPinnedChange: () => void;
  onCanvasEnter: MouseEventHandler<HTMLElement>;
  onCanvasLeave: MouseEventHandler<HTMLElement>;
  onCanvasFocus: FocusEventHandler<HTMLElement>;
  onCanvasBlur: FocusEventHandler<HTMLElement>;
  onStopWebApp: () => void;
};

export function AppNavigationRail({
  navigation,
  terminal,
  agent,
  skills,
  webApps,
  homePaths,
  busy,
  skillsSection,
  onSelectSkillsSection,
  settingsSection,
  onSelectSettingsSection,
  onPickWorkspace,
  onNewWorkspace,
  onPickAgentPath,
  onCloseAgentSession,
  onSessionSelected,
  terminalCapacity,
  terminalLayoutCount,
  terminalLayoutPreset,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalLaunchPathsHeight,
  confirmTerminalClose,
  agentCapacity,
  agentLayoutCount,
  agentLayoutPreset,
  agentThumbnailsAutoHide,
  agentThumbnailSide,
  onTerminalCapacityChange,
  onTerminalLayoutPresetChange,
  onToggleTerminalThumbnailAutoHide,
  onTerminalThumbnailSideChange,
  onTerminalLaunchPathsHeightChange,
  onConfirmTerminalCloseChange,
  onAgentCapacityChange,
  onAgentLayoutPresetChange,
  onToggleAgentThumbnailAutoHide,
  onAgentThumbnailSideChange,
  onConfirm,
  layoutMode,
  canvasPinned,
  railInteractive,
  railId,
  railRef,
  onCanvasPinnedChange,
  onCanvasEnter,
  onCanvasLeave,
  onCanvasFocus,
  onCanvasBlur,
  onStopWebApp,
}: AppNavigationRailProps) {
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false);
  const terminalSettingsToggleRef = useRef<HTMLButtonElement | null>(null);
  const terminalSettingsPanelRef = useRef<HTMLDivElement | null>(null);
  const closeTerminalSettings = useCallback((restoreFocus: boolean) => {
    setTerminalSettingsOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => terminalSettingsToggleRef.current?.focus());
  }, []);
  useEffect(() => {
    if (
      terminalSettingsOpen &&
      (layoutMode !== "canvas" || (navigation.workspaceMode !== "terminal" && navigation.workspaceMode !== "agent") || navigation.railPage !== navigation.workspaceMode)
    ) {
      closeTerminalSettings(Boolean(terminalSettingsPanelRef.current?.contains(document.activeElement)));
    }
  }, [closeTerminalSettings, layoutMode, navigation.railPage, navigation.workspaceMode, terminalSettingsOpen]);
  useEffect(() => {
    if (!terminalSettingsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || terminalSettingsPanelRef.current?.contains(target) || terminalSettingsToggleRef.current?.contains(target)) return;
      closeTerminalSettings(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [closeTerminalSettings, terminalSettingsOpen]);
  const sessionSelected = () => {
    closeTerminalSettings(Boolean(terminalSettingsPanelRef.current?.contains(document.activeElement)));
    onSessionSelected();
  };
  return (
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
      terminalSettingsOpen={terminalSettingsOpen}
      terminalSettingsToggleRef={terminalSettingsToggleRef}
      terminalSettingsPanelRef={terminalSettingsPanelRef}
       terminalCapacity={terminalCapacity}
       terminalLayoutCount={terminalLayoutCount}
       terminalLayoutPreset={terminalLayoutPreset}
       terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
      terminalThumbnailSide={terminalThumbnailSide}
      terminalLaunchPathsHeight={terminalLaunchPathsHeight}
      confirmTerminalClose={confirmTerminalClose}
      onToggleTerminalSettings={() => setTerminalSettingsOpen((open) => !open)}
      onCloseTerminalSettings={() => closeTerminalSettings(true)}
       onTerminalCapacityChange={onTerminalCapacityChange}
       onTerminalLayoutPresetChange={onTerminalLayoutPresetChange}
       onToggleTerminalThumbnailAutoHide={onToggleTerminalThumbnailAutoHide}
      onTerminalThumbnailSideChange={onTerminalThumbnailSideChange}
      onTerminalLaunchPathsHeightChange={onTerminalLaunchPathsHeightChange}
       onConfirmTerminalCloseChange={onConfirmTerminalCloseChange}
       agentCapacity={agentCapacity}
       agentLayoutCount={agentLayoutCount}
       agentLayoutPreset={agentLayoutPreset}
       agentThumbnailsAutoHide={agentThumbnailsAutoHide}
       agentThumbnailSide={agentThumbnailSide}
       agents={agent.agents}
       defaultAgentId={agent.defaultAgentId}
       onDefaultAgentChange={agent.setDefaultAgentId}
       onAgentCapacityChange={onAgentCapacityChange}
       onAgentLayoutPresetChange={onAgentLayoutPresetChange}
       onToggleAgentThumbnailAutoHide={onToggleAgentThumbnailAutoHide}
       onAgentThumbnailSideChange={onAgentThumbnailSideChange}
       terminalContent={
        <WorkspaceList
          workspaces={terminal.workspaces}
          launchPaths={terminal.launchPaths}
          selectedWorkspaceId={terminal.selectedWorkspaceId}
          homePaths={homePaths}
          launching={terminal.launching}
          onSelectWorkspace={(id) => {
            terminal.activateWorkspace(id);
            sessionSelected();
          }}
          onRenameWorkspace={(workspace) => void terminal.renameWorkspace(workspace)}
          onDeleteWorkspace={terminal.removeWorkspace}
          onNewWorkspace={onNewWorkspace}
          onLaunch={(path) => void terminal.addTerminal(path)}
          onPinPath={(path) => void terminal.pinLaunchPath(path)}
          onRenamePath={terminal.renameLaunchPath}
          onDeletePath={terminal.removeLaunchPath}
          onConfirm={onConfirm}
          onAddPath={onPickWorkspace}
        />
      }
      agentContent={
        <AgentRailPage
          busy={busy}
          launching={agent.launching}
          agents={agent.agents}
          selectedAgentId={agent.selectedAgentId}
          selectedAgent={agent.selectedAgent}
          agentName={agent.selectedAgent?.name ?? "Agent CLI"}
          configs={agent.configs}
          selectedConfigId={agent.selectedConfigId}
          profiles={skills.profiles}
          selectedProfileId={agent.selectedSkillProfileId}
          paths={agent.selectedPaths}
          selectedPathId={agent.selectedPathId}
          includeSubdirectories={agent.includeSubdirectories}
          activeSession={agent.activeSession}
          sessions={agent.selectedSessions}
          historyCount={agent.selectedAgent?.supportsHistory ? agent.history.sessions.length : 0}
          supportsHistory={Boolean(agent.selectedAgent?.supportsHistory)}
          historyAvailable={agent.history.available}
          historyDiagnostic={agent.history.diagnostic}
          historyLoading={agent.historyLoading}
          historySettled={agent.historySettled}
          historyLoadError={agent.historyLoadError}
          rows={agent.mergedSessions}
          search={agent.search}
          homePaths={homePaths}
          onSelectAgent={agent.setSelectedAgentId}
          onSelectConfig={agent.setSelectedConfigId}
          onSelectProfile={agent.setSelectedSkillProfileId}
          onCreateConfig={agent.createConfig}
          onUpdateConfig={agent.updateConfig}
          onDeleteConfig={agent.deleteConfig}
          onChoosePath={onPickAgentPath}
          onSelectPath={(id) => agent.setSelectedPathId(agent.selectedPathId === id ? null : id)}
          onIncludeSubdirectoriesChange={agent.setIncludeSubdirectories}
          onLaunch={(path) => void agent.launch({ cwd: path.path, pathId: path.id })}
          onPinPath={agent.pinPath}
          onRenamePath={agent.renamePath}
          onDeletePath={agent.deletePath}
          onSearch={agent.setSearch}
          onActivateSession={(id) => {
            agent.activateSession(id);
            sessionSelected();
          }}
          onResume={async (id) => {
            const resumed = await agent.launch({ upstreamSessionId: id });
            if (resumed) sessionSelected();
            return resumed;
          }}
          onDeleteLive={onCloseAgentSession}
          onConfirm={onConfirm}
          onDeleteHistory={agent.deleteHistorySession}
          onRetryHistory={agent.retryHistory}
        />
      }
      skillsContent={<SkillsRailPage section={skillsSection} onSelect={onSelectSkillsSection} />}
      settingsContent={<SettingsRailPage section={settingsSection} onSelect={onSelectSettingsSection} />}
      webAppContent={
        <WebAppsRailPage
          app={webApps.openDesign}
          onInstall={webApps.install}
          onStart={webApps.start}
          operation={webApps.operation}
          onConfirm={onConfirm}
        />
      }
      layoutMode={layoutMode}
      canvasPinned={canvasPinned}
      railInteractive={railInteractive}
      railId={railId}
      railRef={railRef}
      webAppRunning={Boolean(webApps.openDesign?.running)}
      webAppOperation={webApps.operation}
      onCanvasPinnedChange={onCanvasPinnedChange}
      onCanvasEnter={onCanvasEnter}
      onCanvasLeave={onCanvasLeave}
      onCanvasFocus={onCanvasFocus}
      onCanvasBlur={onCanvasBlur}
      onStopWebApp={onStopWebApp}
    />
  );
}
