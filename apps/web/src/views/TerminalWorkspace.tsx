import { X } from "lucide-react";
import type { ConnectionPhase, TerminalInfo } from "../types";
import { SessionTabs } from "../components/SessionTabs";
import { Statusbar } from "../components/Statusbar";
import { TerminalSurface } from "../TerminalSurface";

export function TerminalWorkspace({
  visible,
  busy,
  sessions,
  visibleSessions,
  activeId,
  activeSession,
  selectedWorkspace,
  phases,
  focusVersion,
  error,
  onActivate,
  onRename,
  onClose,
  onCreate,
  onPhaseChange,
  onError,
  onDismissError,
}: {
  visible: boolean;
  busy: boolean;
  sessions: TerminalInfo[];
  visibleSessions: TerminalInfo[];
  activeId: string | null;
  activeSession: TerminalInfo | null;
  selectedWorkspace: string | null;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  error: string | null;
  onActivate: (id: string) => void;
  onRename: (session: TerminalInfo) => void;
  onClose: (session: TerminalInfo) => void;
  onCreate: (cwd?: string) => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
}) {
  return (
    <div className={`terminal-workspace ${visible ? "" : "workspace-hidden"}`}>
      <SessionTabs
        sessions={visibleSessions}
        activeId={activeId}
        phases={phases}
        label="Terminal"
        onActivate={onActivate}
        onRename={onRename}
        onClose={onClose}
      />
      <div className="stage">
        {busy && <div className="empty-state">Starting DevHatch…</div>}
        {!busy && !visibleSessions.length && (
          <div className="empty-state">
            <strong>No terminal sessions are running</strong>
            <button onClick={() => onCreate(selectedWorkspace ?? undefined)}>Create terminal</button>
          </div>
        )}
        {sessions.map((session) => (
          <TerminalSurface
            key={session.id}
            session={session}
            socketBase="/api/terminals"
            active={visible && session.id === activeId && session.cwd === selectedWorkspace}
            focusVersion={focusVersion}
            onPhaseChange={onPhaseChange}
            onError={onError}
          />
        ))}
        {error && (
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
        {["Esc", "Tab", "Ctrl", "Alt", "↑", "↓", "←", "→"].map((key) => (
          <button key={key}>{key}</button>
        ))}
      </div>
    </div>
  );
}
