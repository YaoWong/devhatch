import { Pencil, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { ConnectionPhase, TerminalInfo } from "../types";

export function SessionTabs<T extends TerminalInfo>({
  sessions,
  activeId,
  phases,
  label,
  onActivate,
  onRename,
  onClose,
}: {
  sessions: T[];
  activeId: string | null;
  phases: Record<string, ConnectionPhase>;
  label: string;
  onActivate: (id: string) => void;
  onRename: (session: T) => void;
  onClose: (session: T) => void;
}) {
  const activateByKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % sessions.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + sessions.length) % sessions.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sessions.length - 1;
    else return;
    event.preventDefault();
    const session = sessions[next];
    if (!session) return;
    onActivate(session.id);
    requestAnimationFrame(() => document.getElementById(`session-tab-${session.id}`)?.focus());
  };
  return (
    <div className="tabbar">
      <div className="tabs" role="tablist" aria-label={`${label} sessions`}>
        {sessions.map((session, index) => (
          <div key={session.id} className={`tab ${session.id === activeId ? "active" : ""}`}>
            <button
              type="button"
              id={`session-tab-${session.id}`}
              className="tab-target"
              role="tab"
              aria-selected={session.id === activeId}
              tabIndex={session.id === activeId || (!activeId && index === 0) ? 0 : -1}
              onClick={() => onActivate(session.id)}
              onKeyDown={(event) => activateByKey(event, index)}
            >
              <span className={`tab-dot ${phases[session.id] ?? "connecting"}`} />
              <span className="tab-name">{session.name || `${label} ${index + 1}`}</span>
            </button>
            <span className="tab-actions">
              <button type="button" className="tab-action" aria-label={`Rename ${session.name}`} onClick={() => onRename(session)}>
                <Pencil />
              </button>
              <button type="button" className="tab-action" aria-label={`Close ${session.name}`} onClick={() => onClose(session)}>
                <X />
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
