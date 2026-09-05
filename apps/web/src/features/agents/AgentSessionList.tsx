import { Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ConfirmAction } from "../../types/app";
import type { AgentLaunchPath, AgentSession, HistorySession } from "../../types/agents";
import { displayPath } from "../../shared/lib/utils";
import { LiveRegion } from "../../shared/ui/LiveRegion";
import { shouldShowAgentSessionSearch } from "./selectors";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRow = { live?: AgentSession; history?: HistorySession };

const legacyButtonFocus = "tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2";
const retryButtonClass = `${legacyButtonFocus} tw:h-10 tw:w-fit tw:rounded-lg tw:border-input tw:bg-card tw:px-3 tw:py-0 tw:text-[10px] tw:leading-[1.2] tw:font-semibold tw:text-muted-foreground tw:transition-none tw:hover:bg-card! tw:hover:text-muted-foreground! tw:focus-visible:border-input! tw:disabled:pointer-events-auto tw:disabled:cursor-default tw:disabled:opacity-[0.42] tw:dark:bg-card! tw:dark:hover:bg-card! tw:[@media(pointer:coarse)]:h-11`;
const sessionMainClass = `${legacyButtonFocus} tw:flex tw:h-auto tw:min-h-10 tw:min-w-0 tw:flex-1 tw:items-center tw:justify-start tw:gap-[7px] tw:rounded-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-base tw:leading-[normal] tw:font-normal tw:whitespace-normal tw:text-inherit tw:text-left tw:transition-[padding-right] tw:duration-[220ms] tw:ease-[cubic-bezier(.2,1,.35,1)] tw:hover:bg-transparent! tw:hover:text-inherit! tw:focus-visible:border-transparent! tw:[@media(pointer:coarse)]:min-h-11 tw:[&>span:last-child]:min-w-0 tw:[&>span:last-child]:flex-1 tw:[&_em]:mt-0.5 tw:[&_em]:block tw:[&_em]:font-mono tw:[&_em]:text-[10px] tw:[&_em]:leading-[1.2] tw:[&_em]:font-normal tw:[&_em]:not-italic tw:[&_em]:text-[var(--color-text-muted)] tw:[&_small]:mt-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[10px] tw:[&_small]:leading-[1.2] tw:[&_small]:font-normal tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-[11px] tw:[&_strong]:leading-[1.2] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap`;
const liveSessionActionSpace = "tw:group-hover/session-row:pr-12 tw:group-focus-within/session-row:pr-12 tw:[@media(hover:none)]:pr-12 tw:[@media(pointer:coarse)]:pr-[52px]";
const historySessionActionSpace = "tw:group-hover/session-row:pr-[104px] tw:group-focus-within/session-row:pr-[104px] tw:[@media(hover:none)]:pr-[104px] tw:[@media(pointer:coarse)]:pr-[108px]";
const resumeButtonClass = `${legacyButtonFocus} tw:h-10 tw:rounded-lg tw:border-input tw:bg-card tw:px-2.5 tw:py-0 tw:text-[10px] tw:leading-[1.2] tw:font-semibold tw:text-inherit tw:transition-none tw:hover:bg-card! tw:hover:text-inherit! tw:focus-visible:border-input! tw:disabled:pointer-events-auto tw:disabled:opacity-100 tw:dark:bg-card! tw:dark:hover:bg-card! tw:[@media(pointer:coarse)]:h-11`;
const deleteButtonClass = `${legacyButtonFocus} tw:grid tw:size-10 tw:flex-none tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:transition-[background,color] tw:duration-150 tw:ease-[ease] tw:hover:bg-card! tw:hover:text-destructive! tw:focus-visible:border-transparent! tw:[@media(pointer:coarse)]:size-11 tw:[&_svg]:size-3.5`;
const sessionActionsClass = "tw:pointer-events-none tw:absolute tw:top-1/2 tw:right-[5px] tw:z-[1] tw:flex tw:translate-x-[9px] tw:-translate-y-1/2 tw:items-center tw:justify-end tw:gap-1 tw:bg-[linear-gradient(90deg,transparent,var(--color-canvas)_14px)] tw:pl-3.5 tw:opacity-0 tw:[transition:opacity_150ms_ease,translate_220ms_cubic-bezier(.2,1,.35,1)] tw:group-hover/session-row:pointer-events-auto tw:group-hover/session-row:translate-x-0 tw:group-hover/session-row:opacity-100 tw:group-focus-within/session-row:pointer-events-auto tw:group-focus-within/session-row:translate-x-0 tw:group-focus-within/session-row:opacity-100 tw:[@media(hover:none)]:bg-none tw:[@media(hover:none)]:pointer-events-auto tw:[@media(hover:none)]:translate-x-0 tw:[@media(hover:none)]:opacity-100";

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
  const historyError = historyUnavailable || Boolean(historyMessage);
  const showHistoryLoading = useDelayedLoading(historyLoading && !historySettled);
  const announcement = historyError
    ? ""
    : showHistoryLoading
      ? "Loading sessions…"
      : historyLoading && !historySettled
        ? ""
        : historySettled
          ? "Sessions loaded."
          : "";
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
      <LiveRegion>{announcement}</LiveRegion>
      <div className="sessions-heading">
        <div className="sessions-title-row">
          <p className="menu-label">Sessions</p>
          {selectedPath && (
            <label className="tw:inline-flex tw:min-h-10 tw:cursor-pointer tw:items-center tw:gap-1.5 tw:text-[10px] tw:leading-[1.2] tw:text-[var(--color-text-muted)] tw:[@media(pointer:coarse)]:min-h-11">
              <span>Subdirectories</span>
              <Switch
                checked={includeSubdirectories}
                className="tw:h-5! tw:w-[34px]! tw:border-0! tw:bg-[var(--color-border-strong)]! tw:p-0.5 tw:transition-[background-color]! tw:duration-[180ms] tw:ease-[ease] tw:after:-inset-x-1 tw:after:-inset-y-2.5 tw:focus-visible:ring-0! tw:focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_20%,transparent)] tw:data-checked:bg-[var(--color-success-fg)]! tw:dark:data-unchecked:bg-[var(--color-border-strong)]! tw:[@media(pointer:coarse)]:after:-inset-y-3 tw:[&_[data-slot=switch-thumb]]:size-4! tw:[&_[data-slot=switch-thumb]]:bg-[var(--color-surface)]! tw:[&_[data-slot=switch-thumb]]:shadow-[0_1px_3px_rgb(0_0_0/22%)] tw:[&_[data-slot=switch-thumb]]:transition-transform tw:[&_[data-slot=switch-thumb]]:duration-[180ms] tw:[&_[data-slot=switch-thumb]]:ease-[ease] tw:[&_[data-slot=switch-thumb][data-checked]]:translate-x-3.5! tw:dark:[&_[data-slot=switch-thumb]]:bg-[var(--color-surface)]!"
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
        {shouldShowAgentSessionSearch(sessionCount, historyCount, search) && (
          <label className="tw:flex tw:h-10 tw:items-center tw:gap-[5px] tw:rounded-lg tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_72%,transparent)] tw:px-2 tw:shadow-[0_5px_14px_rgb(29_29_31/4%)] tw:backdrop-blur-[8px] tw:[@media(pointer:coarse)]:h-11 tw:[&>svg]:w-3 tw:[&>svg]:text-[var(--color-text-faint)]">
            <Search />
            <Input
              variant="bare"
              aria-label="Search sessions"
              placeholder="Search"
              value={search}
              className="tw:h-full tw:min-w-0 tw:w-full tw:border-0 tw:bg-transparent tw:text-[11px] tw:leading-[1.2] tw:focus-visible:[outline:2px_solid_var(--color-accent)] tw:focus-visible:outline-offset-2"
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
              <div className={`quiet-message history-status ${historyUnavailable ? "unavailable" : ""}`} role="alert">
                {historyUnavailable && <strong>History unavailable</strong>}
                {historyMessage && <span>{historyMessage}</span>}
                {historyUnavailable && (
                  <Button type="button" variant="outline" size="xs" className={retryButtonClass} disabled={retrying || historyLoading} onClick={() => void retryHistory()}>
                    {retrying ? "Retrying…" : "Retry"}
                  </Button>
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
                className={`tw:group/session-row tw:relative tw:flex tw:min-h-[52px] tw:w-full tw:min-w-0 tw:items-center tw:gap-[7px] tw:rounded-[9px] tw:border tw:px-[7px] tw:py-[5px] tw:[transition:background_150ms_ease,border-color_150ms_ease] tw:[&:hover]:border-border tw:[&:hover]:bg-background tw:focus-within:border-border tw:focus-within:bg-background ${live?.id === activeId ? "tw:border-border tw:bg-background" : "tw:border-transparent tw:bg-transparent"}`}
              >
                {live ? (
                  <Button type="button" variant="ghost" className={`${sessionMainClass} ${liveSessionActionSpace}`} aria-current={live.id === activeId ? "true" : undefined} onClick={() => onActivate(live.id)}>
                    <SessionSummary presence={presence} name={live.name} path={live.cwd} detail={history ? new Date(history.timeUpdated).toLocaleString() : "Default"} label={label} homePaths={homePaths} />
                  </Button>
                ) : (
                  <div className={`${sessionMainClass} ${historySessionActionSpace}`}>
                    <SessionSummary presence={presence} name={history!.title} path={history!.directory} detail={new Date(history!.timeUpdated).toLocaleString()} label={label} homePaths={homePaths} />
                  </div>
                )}
                <span className={sessionActionsClass}>
                  {!live && history && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className={resumeButtonClass}
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
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={deleteButtonClass}
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
                  </Button>
                </span>
              </div>
              );
            })}
          </>
        ) : showHistoryLoading ? (
          <div className="quiet-message">Loading sessions…</div>
        ) : historyUnavailable ? (
          <div className="quiet-message history-status unavailable" role="alert">
            <strong>History unavailable</strong>
            {historyMessage && <span>{historyMessage}</span>}
            <Button type="button" variant="outline" size="xs" className={retryButtonClass} disabled={retrying || historyLoading} onClick={() => void retryHistory()}>
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          </div>
        ) : historyAvailable || !supportsHistory ? (
          <div className="quiet-message">No sessions found.</div>
        ) : null}
      </div>
    </div>
  );
}

function SessionSummary({
  presence,
  name,
  path,
  detail,
  label,
  homePaths,
}: {
  presence: string;
  name: string;
  path: string;
  detail: string;
  label: string;
  homePaths: HomePaths;
}) {
  return (
    <>
      <span className={`presence-dot ${presence}`} aria-hidden="true" />
      <span>
        <strong>{name}</strong>
        <small>{displayPath(path, homePaths?.home, homePaths?.resolvedHome)} · {detail}</small>
        <em>{label}</em>
      </span>
    </>
  );
}
