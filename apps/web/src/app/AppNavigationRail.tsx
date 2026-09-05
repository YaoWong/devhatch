import { useEffect, useState, type Dispatch, type FocusEventHandler, type MouseEventHandler, type RefObject, type SetStateAction } from "react";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../features/terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import type { ConfirmAction, LaunchPathDisplay } from "../types/app";
import type { TerminalInfo } from "../types/terminals";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { AgentRailPage } from "../features/agents/AgentRailPage";
import { NavigationRail } from "../features/navigation/NavigationRail";
import type { useNavigation } from "../features/navigation/useNavigation";
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
  onPickWorkspace: () => void;
  onNewWorkspace: () => void;
  onPickAgentPath: () => void;
  onCloseAgentSession: (session: TerminalInfo) => void;
  onSessionSelected: () => void;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalLayoutCount: TerminalLayoutCount | null;
  terminalLayoutPreset: TerminalLayoutPreset | null;
  terminalPathDisplay: LaunchPathDisplay;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalLaunchPathsHeight: number;
  confirmTerminalClose: boolean;
  agentCapacity: TerminalWorkspaceCapacity;
  agentLayoutCount: TerminalLayoutCount | null;
  agentLayoutPreset: TerminalLayoutPreset | null;
  agentPathDisplay: LaunchPathDisplay;
  agentThumbnailsAutoHide: boolean;
  agentThumbnailSide: "left" | "right";
  onTerminalCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onTerminalLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onTerminalPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleTerminalThumbnailAutoHide: () => void;
  onTerminalThumbnailSideChange: (side: "left" | "right") => void;
  onTerminalLaunchPathsHeightChange: (height: number) => void;
  onConfirmTerminalCloseChange: (enabled: boolean) => void;
  onAgentCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onAgentLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onAgentPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleAgentThumbnailAutoHide: () => void;
  onAgentThumbnailSideChange: (side: "left" | "right") => void;
  onConfirm: Dispatch<SetStateAction<ConfirmAction | null>>;
  canvasPinned: boolean;
  railInteractive: boolean;
  railId: string;
  railRef: RefObject<HTMLElement | null>;
  onCanvasPinnedChange: () => void;
  onCanvasEnter: MouseEventHandler<HTMLElement>;
  onCanvasLeave: MouseEventHandler<HTMLElement>;
  onCanvasFocus: FocusEventHandler<HTMLElement>;
  onCanvasBlur: FocusEventHandler<HTMLElement>;
  onFloatingSettingsOpenChange: (open: boolean) => void;
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
  onPickWorkspace,
  onNewWorkspace,
  onPickAgentPath,
  onCloseAgentSession,
  onSessionSelected,
  terminalCapacity,
  terminalLayoutCount,
  terminalLayoutPreset,
  terminalPathDisplay,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalLaunchPathsHeight,
  confirmTerminalClose,
  agentCapacity,
  agentLayoutCount,
  agentLayoutPreset,
  agentPathDisplay,
  agentThumbnailsAutoHide,
  agentThumbnailSide,
  onTerminalCapacityChange,
  onTerminalLayoutPresetChange,
  onTerminalPathDisplayChange,
  onToggleTerminalThumbnailAutoHide,
  onTerminalThumbnailSideChange,
  onTerminalLaunchPathsHeightChange,
  onConfirmTerminalCloseChange,
  onAgentCapacityChange,
  onAgentLayoutPresetChange,
  onAgentPathDisplayChange,
  onToggleAgentThumbnailAutoHide,
  onAgentThumbnailSideChange,
  onConfirm,
  canvasPinned,
  railInteractive,
  railId,
  railRef,
  onCanvasPinnedChange,
  onCanvasEnter,
  onCanvasLeave,
  onCanvasFocus,
  onCanvasBlur,
  onFloatingSettingsOpenChange,
  onStopWebApp,
}: AppNavigationRailProps) {
  const [terminalSettingsOpen, setTerminalSettingsOpen] = useState(false);
  useEffect(() => {
    if (
      terminalSettingsOpen &&
      ((navigation.workspaceMode !== "terminal" && navigation.workspaceMode !== "agent") || navigation.railPage !== navigation.workspaceMode)
    ) {
      setTerminalSettingsOpen(false);
      if (!canvasPinned) onFloatingSettingsOpenChange(false);
    }
  }, [canvasPinned, navigation.railPage, navigation.workspaceMode, onFloatingSettingsOpenChange, terminalSettingsOpen]);
  const sessionSelected = () => {
    setTerminalSettingsOpen(false);
    if (!canvasPinned) onFloatingSettingsOpenChange(false);
    navigation.closeSidebar();
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
       terminalCapacity={terminalCapacity}
       terminalLayoutCount={terminalLayoutCount}
       terminalLayoutPreset={terminalLayoutPreset}
       terminalPathDisplay={terminalPathDisplay}
       terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
      terminalThumbnailSide={terminalThumbnailSide}
      terminalLaunchPathsHeight={terminalLaunchPathsHeight}
      confirmTerminalClose={confirmTerminalClose}
      onTerminalSettingsOpenChange={(open) => {
        setTerminalSettingsOpen(open);
        if (!canvasPinned) onFloatingSettingsOpenChange(open);
      }}
       onTerminalCapacityChange={onTerminalCapacityChange}
       onTerminalLayoutPresetChange={onTerminalLayoutPresetChange}
       onTerminalPathDisplayChange={onTerminalPathDisplayChange}
       onToggleTerminalThumbnailAutoHide={onToggleTerminalThumbnailAutoHide}
      onTerminalThumbnailSideChange={onTerminalThumbnailSideChange}
      onTerminalLaunchPathsHeightChange={onTerminalLaunchPathsHeightChange}
       onConfirmTerminalCloseChange={onConfirmTerminalCloseChange}
       agentCapacity={agentCapacity}
       agentLayoutCount={agentLayoutCount}
       agentLayoutPreset={agentLayoutPreset}
       agentPathDisplay={agentPathDisplay}
       agentThumbnailsAutoHide={agentThumbnailsAutoHide}
       agentThumbnailSide={agentThumbnailSide}
       agents={agent.agents}
       defaultAgentId={agent.defaultAgentId}
       onDefaultAgentChange={agent.setDefaultAgentId}
       onAgentCapacityChange={onAgentCapacityChange}
       onAgentLayoutPresetChange={onAgentLayoutPresetChange}
       onAgentPathDisplayChange={onAgentPathDisplayChange}
       onToggleAgentThumbnailAutoHide={onToggleAgentThumbnailAutoHide}
       onAgentThumbnailSideChange={onAgentThumbnailSideChange}
       terminalContent={
        <WorkspaceList
          workspaces={terminal.workspaces}
          launchPaths={terminal.launchPaths}
          selectedWorkspaceId={terminal.selectedWorkspaceId}
          homePaths={homePaths}
          launching={terminal.launching}
          pathDisplay={terminalPathDisplay}
          onSelectWorkspace={(id) => {
            terminal.activateWorkspace(id);
            sessionSelected();
          }}
           onRenameWorkspace={terminal.renameWorkspace}
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
          workspaces={agent.workspaces}
          selectedWorkspaceId={agent.selectedAgentWorkspaceId}
          selectedAgentId={agent.selectedAgentId}
          selectedAgent={agent.selectedAgent}
          agentName={agent.selectedAgent?.name ?? "Agent CLI"}
          configs={agent.configs}
          selectedConfigId={agent.selectedConfigId}
          profiles={skills.profiles}
          selectedProfileId={agent.selectedSkillProfileId}
          paths={agent.paths}
          selectedPathId={agent.selectedPathId}
          includeSubdirectories={agent.includeSubdirectories}
          activeSession={agent.launcherActiveSession}
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
          pathDisplay={agentPathDisplay}
          onSelectAgent={agent.setSelectedAgentId}
          onSelectWorkspace={(id) => {
            agent.activateWorkspace(id);
            sessionSelected();
          }}
           onRenameWorkspace={agent.renameWorkspace}
          onDeleteWorkspace={agent.removeWorkspace}
          onCreateWorkspace={() => void agent.createWorkspace()}
          onSelectConfig={agent.setSelectedConfigId}
          onSelectProfile={agent.setSelectedSkillProfileId}
          onCreateConfig={agent.createConfig}
          onUpdateConfig={agent.updateConfig}
          onDeleteConfig={agent.deleteConfig}
          onChoosePath={onPickAgentPath}
          onSelectPath={(id) => agent.setSelectedPathId(agent.selectedPathId === id ? null : id)}
          onIncludeSubdirectoriesChange={agent.setIncludeSubdirectories}
          onLaunch={(path) => {
            void agent.launch({ cwd: path.path, pathId: path.id });
          }}
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
       skillsContent={
         <SkillsRailPage
           section={skillsSection}
           onSelect={(section) => {
             onSelectSkillsSection(section);
             navigation.closeSidebar();
           }}
         />
       }
       webAppContent={
        <WebAppsRailPage
          app={webApps.openDesign}
          onInstall={webApps.install}
          onStart={webApps.start}
          operation={webApps.operation}
          settled={webApps.settled}
          loadError={webApps.loadError}
          onRetry={webApps.retry}
          onConfirm={onConfirm}
        />
       }
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
