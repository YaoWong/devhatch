import { Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ConfirmAction } from "../../types/app";
import type { AgentLaunchPath, AgentSession, HistorySession } from "../../types/agents";
import { displayPath } from "../../shared/lib/utils";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

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
  launching,
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
  launching: boolean;
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
  const showHistoryLoading = useDelayedLoading(historyLoading && !historySettled);
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
            <label className="session-scope-toggle tw:inline-flex tw:cursor-pointer tw:items-center tw:gap-[5px] tw:text-[8px] tw:text-[var(--color-text-muted)]">
              <span>Subdirectories</span>
              <Switch
                checked={includeSubdirectories}
                className="tw:h-[18px]! tw:w-[30px]! tw:border-0! tw:bg-[var(--color-border-strong)]! tw:p-0.5 tw:transition-[background-color]! tw:duration-[180ms] tw:ease-[ease] tw:focus-visible:ring-0! tw:focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] tw:data-checked:bg-[var(--color-success-fg)]! tw:dark:data-unchecked:bg-[var(--color-border-strong)]! tw:[&_[data-slot=switch-thumb]]:size-3.5! tw:[&_[data-slot=switch-thumb]]:bg-[var(--color-surface)]! tw:[&_[data-slot=switch-thumb]]:shadow-[0_1px_3px_rgb(0_0_0/22%)] tw:[&_[data-slot=switch-thumb]]:transition-transform tw:[&_[data-slot=switch-thumb]]:duration-[180ms] tw:[&_[data-slot=switch-thumb]]:ease-[ease] tw:[&_[data-slot=switch-thumb][data-checked]]:translate-x-3! tw:dark:[&_[data-slot=switch-thumb]]:bg-[var(--color-surface)]!"
                onCheckedChange={onIncludeSubdirectoriesChange}
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
          <label className="session-search tw:flex tw:h-[30px] tw:items-center tw:gap-[5px] tw:rounded-lg tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_72%,transparent)] tw:px-2 tw:shadow-[0_5px_14px_rgb(29_29_31/4%)] tw:backdrop-blur-[8px] tw:[&>svg]:w-3 tw:[&>svg]:text-[var(--color-text-faint)]">
            <Search />
            <Input
              variant="bare"
              aria-label="Search sessions"
              placeholder="Search"
              value={search}
              className="tw:min-w-0 tw:w-full tw:border-0 tw:bg-transparent tw:text-[9px] tw:leading-[normal] tw:focus-visible:[outline:2px_solid_var(--color-accent)] tw:focus-visible:outline-offset-2"
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
                       disabled={launching}
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
        ) : showHistoryLoading ? (
          <div className="quiet-message" role="status">Loading sessions…</div>
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
