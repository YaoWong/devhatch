import { Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentLaunchPath, AgentSession, ConfirmAction, HistorySession } from "../types";
import { displayPath } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRow = { live?: AgentSession; history?: HistorySession };

export function AgentSessionList({
  agentName,
  rows,
  sessionCount,
  historyCount,
  supportsHistory,
  historyAvailable,
  historyDiagnostic,
  historyLoading,
  historySettled,
  historyLoadError,
  activeId,
  search,
  selectedPath,
  includeSubdirectories,
  homePaths,
  onSearch,
  onIncludeSubdirectoriesChange,
  onActivate,
  onResume,
  onDeleteLive,
  onConfirm,
  onDeleteHistory,
  onRetryHistory,
}: {
  agentName: string;
  rows: SessionRow[];
  sessionCount: number;
  historyCount: number;
  supportsHistory: boolean;
  historyAvailable: boolean;
  historyDiagnostic: string | null;
  historyLoading: boolean;
  historySettled: boolean;
  historyLoadError: string | null;
  activeId: string | null;
  search: string;
  selectedPath: AgentLaunchPath | null;
  includeSubdirectories: boolean;
  homePaths: HomePaths;
  onSearch: (value: string) => void;
  onIncludeSubdirectoriesChange: (enabled: boolean) => void;
  onActivate: (id: string) => void;
  onResume: (id: string) => Promise<boolean>;
  onDeleteLive: (session: AgentSession) => void;
  onConfirm: (action: ConfirmAction) => void;
  onDeleteHistory: (id: string) => Promise<void>;
  onRetryHistory: () => Promise<void>;
}) {
  const [scrolling, setScrolling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const timer = useRef<number | null>(null);
  const historyUnavailable =
    supportsHistory && historySettled && (!historyAvailable || Boolean(historyLoadError));
  const historyMessage = historyLoadError ?? historyDiagnostic;
  const retryHistory = async () => {
    if (retrying || historyLoading) return;
    setRetrying(true);
    try {
      await onRetryHistory();
    } finally {
      setRetrying(false);
    }
  };
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className="menu-section sessions-section">
      <div className="sessions-heading">
        <div className="sessions-title-row">
          <p className="menu-label">Sessions</p>
          {selectedPath && (
            <label className="session-scope-toggle">
              <span>Subdirectories</span>
              <input
                type="checkbox"
                role="switch"
                checked={includeSubdirectories}
                onChange={(event) => onIncludeSubdirectoriesChange(event.target.checked)}
              />
            </label>
          )}
        </div>
        {selectedPath && (
          <div className="session-filter-path" title={selectedPath.path}>
            {displayPath(selectedPath.path, homePaths?.home, homePaths?.resolvedHome)}
          </div>
        )}
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
          <>
            {(historyUnavailable || historyMessage) && (
              <div className={`quiet-message history-status ${historyUnavailable ? "unavailable" : ""}`}>
                {historyUnavailable && <strong>History unavailable</strong>}
                <span>{historyMessage}</span>
                {historyUnavailable && (
                  <button type="button" disabled={retrying || historyLoading} onClick={() => void retryHistory()}>
                    {retrying ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
            )}
            {rows.map(({ live, history }) => {
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
                              `${agentName} may be using this session elsewhere. ` +
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
                          title: `Delete ${agentName} session?`,
                          description: `“${history.title}” and its ${agentName} history will be permanently deleted.`,
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
            })}
          </>
        ) : historyLoading && !historySettled ? (
          <div className="quiet-message">Loading sessions…</div>
        ) : historyUnavailable ? (
          <div className="quiet-message history-status unavailable">
            <strong>History unavailable</strong>
            {historyMessage && <span>{historyMessage}</span>}
            <button type="button" disabled={retrying || historyLoading} onClick={() => void retryHistory()}>
              {retrying ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : historyAvailable || !supportsHistory ? (
          <div className="quiet-message">No sessions found.</div>
        ) : null}
      </div>
    </div>
  );
}
