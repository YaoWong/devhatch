import { Pencil, X } from "lucide-react";
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
  return (
    <div className="tabbar">
      <div className="tabs">
        {sessions.map((session, index) => (
          <button
            key={session.id}
            className={`tab ${session.id === activeId ? "active" : ""}`}
            onClick={() => onActivate(session.id)}
          >
            <span className={`tab-dot ${phases[session.id] ?? "connecting"}`} />
            <span className="tab-name">{session.name || `${label} ${index + 1}`}</span>
            <span className="tab-actions">
              <span
                className="tab-action"
                role="button"
                tabIndex={0}
                aria-label={`Rename ${session.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRename(session);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRename(session);
                  }
                }}
              >
                <Pencil />
              </span>
              <span
                className="tab-action"
                role="button"
                tabIndex={0}
                aria-label={`Close ${session.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(session);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(session);
                  }
                }}
              >
                <X />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
