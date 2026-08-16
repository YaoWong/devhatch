import { Bot, X } from "lucide-react";
import type { Agent, AgentSession, ConnectionPhase } from "../types";
import { SessionTabs, Statusbar } from "../components";
import { TerminalSurface } from "../TerminalSurface";

export function AgentWorkspace({
  visible,
  busy,
  sessions,
  displaySessions,
  activeId,
  activeSession,
  selectedAgent,
  phases,
  focusVersion,
  error,
  onActivate,
  onRename,
  onClose,
  onChoosePath,
  onPhaseChange,
  onRemoved,
  onError,
  onDismissError,
}: {
  visible: boolean;
  busy: boolean;
  sessions: AgentSession[];
  displaySessions: AgentSession[];
  activeId: string | null;
  activeSession: AgentSession | null;
  selectedAgent: Agent | null;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  error: string | null;
  onActivate: (id: string) => void;
  onRename: (session: AgentSession) => void;
  onClose: (session: AgentSession) => void;
  onChoosePath: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onRemoved: (id: string) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
}) {
  return (
    <div className={`terminal-workspace agent-workspace ${visible ? "" : "workspace-hidden"}`}>
      <SessionTabs
        sessions={displaySessions}
        activeId={activeId}
        phases={phases}
        label="Agent"
        onActivate={onActivate}
        onRename={onRename}
        onClose={onClose}
      />
      <div className="stage">
        {busy && <div className="empty-state">Loading Agent CLI…</div>}
        {!busy && !sessions.length && (
          <div className="empty-state">
            <Bot />
            <strong>No agent sessions are running</strong>
            <span>
              {!selectedAgent?.available
                ? `${selectedAgent?.name ?? "Agent CLI"} is unavailable`
                : "Choose a launch path from the sidebar"}
            </span>
            {selectedAgent?.available && <button onClick={onChoosePath}>Choose launch path</button>}
          </div>
        )}
        {sessions.map((session) => (
          <TerminalSurface
            key={session.id}
            session={session}
            socketBase="/api/agent-sessions"
            active={visible && session.id === activeId}
            focusVersion={focusVersion}
            onPhaseChange={onPhaseChange}
            onRemoved={onRemoved}
            onError={onError}
          />
        ))}
        {error && visible && (
          <div className="error-banner">
            {error}
            <button aria-label="Dismiss" onClick={onDismissError}>
              <X />
            </button>
          </div>
        )}
      </div>
      <Statusbar session={activeSession} phase={activeId ? phases[activeId] : undefined} />
      <div className="mobile-keys">
        {["Esc", "Tab", "Ctrl", "Alt", "@", "/", "↑", "↓"].map((key) => (
          <button key={key}>{key}</button>
        ))}
      </div>
    </div>
  );
}
