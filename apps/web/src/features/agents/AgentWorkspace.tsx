import { Bot } from "lucide-react";
import type { Agent, AgentSession } from "../../types/agents";
import type { ConnectionPhase, TerminalInfo } from "../../types/terminals";
import { TerminalWorkspace } from "../terminals/TerminalWorkspace";
import { agentWorkspaceKey } from "./agentWorkspaceState";
import type { TerminalLayoutCount, TerminalWorkspaceLayoutPreferences } from "../terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../terminals/terminalWorkspaceDock";

export function AgentWorkspace({
  visible,
  busy,
  launching,
  displaySessions,
  workspaceSessions,
  selectedAgentWorkspaceId,
  activeId,
  selectedAgent,
  phases,
  focusVersion,
  capacity,
  thumbnailsAutoHide,
  thumbnailSide,
  workspaceLayouts,
  error,
  onActivate,
  onRename,
  onClose,
  onChoosePath,
  onPhaseChange,
  onLayoutCountChange,
  onWorkspaceLayoutChange,
  onRemoved,
  onUpstreamSessionChange,
  onOpenLink,
  onError,
  onDismissError,
}: {
  visible: boolean;
  busy: boolean;
  launching: boolean;
  displaySessions: AgentSession[];
  workspaceSessions: AgentSession[];
  selectedAgentWorkspaceId: string | null;
  activeId: string | null;
  selectedAgent: Agent | null;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  capacity: TerminalWorkspaceCapacity;
  thumbnailsAutoHide: boolean;
  thumbnailSide: "left" | "right";
  workspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  error: string | null;
  onActivate: (id: string) => void;
  onRename: (session: AgentSession, name: string) => Promise<boolean>;
  onClose: (session: AgentSession) => void;
  onChoosePath: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
  onRemoved: (id: string) => void;
  onUpstreamSessionChange: (id: string, upstreamSessionId: string, cwd?: string) => void;
  onOpenLink: (url: string) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
}) {
  const selectedIds = new Set(workspaceSessions.map((session) => session.id));
  const visibleSessions = displaySessions.filter((session) => selectedIds.has(session.id));
  const selectedActiveId = activeId && selectedIds.has(activeId) ? activeId : (visibleSessions[0]?.id ?? null);
  return <TerminalWorkspace
    visible={visible}
    busy={busy}
    launching={launching}
    sessions={displaySessions}
    visibleSessions={visibleSessions}
    workspaceKey={agentWorkspaceKey(selectedAgentWorkspaceId)}
    activeSessionId={selectedActiveId}
    workspaceLabel="agent workspace"
    sessionLabel="agent session"
    sessionIdentity={(session) => (session as AgentSession).agentName}
    stageId="agent"
    socketBase="/api/agent-sessions"
    emptyIcon={<Bot />}
    phases={phases}
    focusVersion={focusVersion}
    capacity={capacity}
    thumbnailsAutoHide={thumbnailsAutoHide}
    thumbnailSide={thumbnailSide}
    workspaceLayouts={workspaceLayouts}
    error={error}
    onActivate={onActivate}
    onRename={(session: TerminalInfo, name) => onRename(session as AgentSession, name)}
    onClose={(session: TerminalInfo) => onClose(session as AgentSession)}
    onChoosePath={selectedAgent?.available ? onChoosePath : undefined}
    onPhaseChange={onPhaseChange}
    onLayoutCountChange={onLayoutCountChange}
    onWorkspaceLayoutChange={onWorkspaceLayoutChange}
    onRemoved={onRemoved}
    onUpstreamSessionChange={onUpstreamSessionChange}
    onOpenLink={onOpenLink}
    onError={onError}
    onDismissError={onDismissError}
  />;
}
