import { Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSession, ConfirmAction, HistorySession } from "../types";
import { displayPath } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRow = { live?: AgentSession; history?: HistorySession };

export function AgentSessionList({
  rows,
  sessionCount,
  historyCount,
  activeId,
  search,
  homePaths,
  onSearch,
  onActivate,
  onResume,
  onDeleteLive,
  onConfirm,
  onDeleteHistory,
}: {
  rows: SessionRow[];
  sessionCount: number;
  historyCount: number;
  activeId: string | null;
  search: string;
  homePaths: HomePaths;
  onSearch: (value: string) => void;
  onActivate: (id: string) => void;
  onResume: (id: string) => Promise<void>;
  onDeleteLive: (session: AgentSession) => void;
  onConfirm: (action: ConfirmAction) => void;
  onDeleteHistory: (id: string) => Promise<void>;
}) {
  const [scrolling, setScrolling] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="menu-section sessions-section">
      <div className="sessions-heading">
        <p className="menu-label">Sessions</p>
        {sessionCount + historyCount > 7 && (
          <label className="session-search">
            <Search />
            <input
              aria-label="Search sessions"
              placeholder="Search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </label>
        )}
      </div>
      <div
        className={`agent-session-list ${scrolling ? "is-scrolling" : ""}`}
        onScroll={() => {
          setScrolling(true);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setScrolling(false), 700);
        }}
      >
        {rows.length ? (
          rows.map(({ live, history }) => {
            const presence = live ? "active-here" : (history?.presence ?? "active-here");
            const label = live
              ? "Current app"
              : presence === "possibly-active-elsewhere"
                ? "Possibly active elsewhere"
                : "Inactive";
            return (
              <div
                key={live?.id ?? history!.id}
                className={`agent-session-row ${live?.id === activeId ? "active" : ""}`}
              >
                <button className="session-main" onClick={() => live && onActivate(live.id)}>
                  <span className={`presence-dot ${presence}`} />
                  <span>
                    <strong>{live?.name ?? history?.title}</strong>
                    <small>
                      {displayPath(live?.cwd ?? history?.directory ?? "", homePaths?.home, homePaths?.resolvedHome)} ·{" "}
                      {history ? new Date(history.timeUpdated).toLocaleString() : "Default"}
                    </small>
                    <em>{label}</em>
                  </span>
                </button>
                <span className="session-actions">
                  {!live && history && (
                    <button
                      className="resume-button"
                      onClick={() => {
                        const resume = () => onResume(history.id);
                        if (presence === "possibly-active-elsewhere") {
                          onConfirm({
                            title: "Resume possibly active session?",
                            description:
                              "OpenCode may be using this session elsewhere. " +
                              "Resuming concurrently could cause conflicting changes.",
                            confirmLabel: "Resume anyway",
                            action: resume,
                          });
                        } else {
                          void resume();
                        }
                      }}
                    >
                      Resume
                    </button>
                  )}
                  <button
                    className="session-delete"
                    aria-label={`Delete ${live?.name ?? history?.title ?? "session"}`}
                    title="Delete session"
                    onClick={() => {
                      if (live) {
                        onDeleteLive(live);
                      } else if (history) {
                        onConfirm({
                          title: "Delete OpenCode session?",
                          description: `“${history.title}” and its OpenCode history will be permanently deleted.`,
                          confirmLabel: "Delete session",
                          danger: true,
                          action: () => onDeleteHistory(history.id),
                        });
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                </span>
              </div>
            );
          })
        ) : (
          <div className="quiet-message">No sessions found.</div>
        )}
      </div>
    </div>
  );
}
