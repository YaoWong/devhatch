import type { Dispatch, SetStateAction } from "react";
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
  onPickAgentPath: () => void;
  onCloseAgentSession: (session: TerminalInfo) => void;
  onConfirm: Dispatch<SetStateAction<ConfirmAction | null>>;
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
  onPickAgentPath,
  onCloseAgentSession,
  onConfirm,
}: AppNavigationRailProps) {
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
      terminalContent={
        <WorkspaceList
          workspaces={terminal.workspaces}
          sessions={terminal.sessions}
          selectedWorkspace={terminal.selectedWorkspace}
          homePaths={homePaths}
          onSelect={terminal.activateWorkspace}
          onPin={(workspace) => void terminal.pinWorkspace(workspace)}
          onDelete={terminal.removeWorkspace}
          onConfirm={onConfirm}
          onAdd={onPickWorkspace}
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
          onActivateSession={agent.activateSession}
          onResume={(id) => agent.launch({ upstreamSessionId: id })}
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
    />
  );
}
