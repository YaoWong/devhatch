import { useEffect, useState, type Dispatch, type FocusEventHandler, type MouseEventHandler, type RefObject, type SetStateAction } from "react";
import type { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { AgentRailPage } from "../features/agents/AgentRailPage";
import { selectedAgentLaunchOptions } from "../features/agents/agentLaunchState";
import { NavigationRail } from "../features/navigation/NavigationRail";
import type { useNavigation } from "../features/navigation/useNavigation";
import { SkillsRailPage, type SkillsSection } from "../features/skills/SkillsRailPage";
import type { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { WorkspaceList } from "../features/terminals/WorkspaceList";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../features/terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import type { useWorkspaceController } from "../features/terminals/useWorkspaceController";
import { WebAppsRailPage } from "../features/web-apps/WebApps";
import type { useWebApps } from "../features/web-apps/useWebApps";
import type { AgentSession } from "../types/agents";
import type { ConfirmAction, LaunchPathDisplay } from "../types/app";

type AppNavigationRailProps = {
  navigation: ReturnType<typeof useNavigation>;
  workspace: ReturnType<typeof useWorkspaceController>;
  agent: ReturnType<typeof useAgentWorkspace>;
  skills: ReturnType<typeof useSkillsWorkspace>;
  webApps: ReturnType<typeof useWebApps>;
  homePaths: { home: string; resolvedHome: string } | null;
  busy: boolean;
  skillsSection: SkillsSection;
  onSelectSkillsSection: Dispatch<SetStateAction<SkillsSection>>;
  onPickLaunchPath: () => void;
  onNewWorkspace: () => void;
  onCloseAgentSession: (session: AgentSession) => void;
  onSessionSelected: () => void;
  capacity: TerminalWorkspaceCapacity;
  layoutCount: TerminalLayoutCount | null;
  layoutPreset: TerminalLayoutPreset | null;
  pathDisplay: LaunchPathDisplay;
  thumbnailsAutoHide: boolean;
  thumbnailSide: "left" | "right";
  launchPathsHeight: number;
  confirmClose: boolean;
  onCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleThumbnailAutoHide: () => void;
  onThumbnailSideChange: (side: "left" | "right") => void;
  onLaunchPathsHeightChange: (height: number) => void;
  onConfirmCloseChange: (enabled: boolean) => void;
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
  workspace,
  agent,
  skills,
  webApps,
  homePaths,
  busy,
  skillsSection,
  onSelectSkillsSection,
  onPickLaunchPath,
  onNewWorkspace,
  onCloseAgentSession,
  onSessionSelected,
  capacity,
  layoutCount,
  layoutPreset,
  pathDisplay,
  thumbnailsAutoHide,
  thumbnailSide,
  launchPathsHeight,
  confirmClose,
  onCapacityChange,
  onLayoutPresetChange,
  onPathDisplayChange,
  onToggleThumbnailAutoHide,
  onThumbnailSideChange,
  onLaunchPathsHeightChange,
  onConfirmCloseChange,
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
    if (terminalSettingsOpen && (navigation.workspaceMode !== "terminal" || navigation.railPage !== "terminal")) {
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
      sessionCount={workspace.sessions.length}
      modesPageRef={navigation.modesPageRef}
      modeRefs={navigation.modeRefs}
      pageRefs={navigation.pageRefs}
      titleRefs={navigation.titleRefs}
      onNavigate={navigation.animateRail}
      terminalSettingsOpen={terminalSettingsOpen}
      capacity={capacity}
      layoutCount={layoutCount}
      layoutPreset={layoutPreset}
      pathDisplay={pathDisplay}
      thumbnailsAutoHide={thumbnailsAutoHide}
      thumbnailSide={thumbnailSide}
      launchPathsHeight={launchPathsHeight}
      confirmClose={confirmClose}
      agents={agent.agents}
      defaultAgentId={agent.defaultAgentId}
      onTerminalSettingsOpenChange={(open) => {
        setTerminalSettingsOpen(open);
        if (!canvasPinned) onFloatingSettingsOpenChange(open);
      }}
      onCapacityChange={onCapacityChange}
      onLayoutPresetChange={onLayoutPresetChange}
      onPathDisplayChange={onPathDisplayChange}
      onToggleThumbnailAutoHide={onToggleThumbnailAutoHide}
      onThumbnailSideChange={onThumbnailSideChange}
      onLaunchPathsHeightChange={onLaunchPathsHeightChange}
      onConfirmCloseChange={onConfirmCloseChange}
      onDefaultAgentChange={agent.setDefaultAgentId}
      terminalContent={
        <>
          <WorkspaceList
            workspaces={workspace.workspaces}
            launchPaths={workspace.launchPaths}
            selectedWorkspaceId={workspace.selectedWorkspaceId}
            selectedPathId={workspace.selectedPathId}
            homePaths={homePaths}
            launching={workspace.terminalLaunching || agent.launching}
            pathDisplay={pathDisplay}
            onSelectWorkspace={(id) => {
              workspace.activateWorkspace(id);
              sessionSelected();
            }}
            onRenameWorkspace={workspace.renameWorkspace}
            onDeleteWorkspace={workspace.removeWorkspace}
            onNewWorkspace={onNewWorkspace}
            onSelectPath={workspace.selectLaunchPath}
            onLaunch={(path) => void workspace.addTerminal(path)}
            onPinPath={(path) => void workspace.pinLaunchPath(path)}
            onRenamePath={workspace.renameLaunchPath}
            onDeletePath={workspace.removeLaunchPath}
            onConfirm={onConfirm}
            onAddPath={onPickLaunchPath}
          />
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
            paths={agent.paths}
            selectedPathId={agent.selectedPathId}
            installState={agent.selectedAgentId ? agent.installStates[agent.selectedAgentId] : undefined}
            activeInstallAgent={agent.agents.find((item) => item.id === agent.installingAgentId) ?? null}
            installAnnouncement={agent.installAnnouncement}
            installBusy={agent.installingAgentId !== null}
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
            onSelectAgent={agent.setSelectedAgentId}
            onSelectConfig={agent.setSelectedConfigId}
            onSelectProfile={agent.setSelectedSkillProfileId}
            onCreateConfig={agent.createConfig}
            onUpdateConfig={agent.updateConfig}
            onDeleteConfig={agent.deleteConfig}
            onInstallAgent={agent.installAgent}
            onIncludeSubdirectoriesChange={agent.setIncludeSubdirectories}
            onLaunch={() => {
              const options = selectedAgentLaunchOptions(agent.selectedPath);
              if (options) void agent.launch(options);
            }}
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
        </>
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
      webAppContent={<WebAppsRailPage app={webApps.openDesign} onInstall={webApps.install} onStart={webApps.start} operation={webApps.operation} settled={webApps.settled} loadError={webApps.loadError} onRetry={webApps.retry} onConfirm={onConfirm} />}
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
