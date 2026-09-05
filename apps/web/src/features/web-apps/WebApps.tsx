import { CircleAlert, CircleCheck, Download, LoaderCircle, Play, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import openDesignIcon from "./open-design.svg";
import type { ConfirmAction } from "../../types/app";
import type { WebApp, WebAppOperation } from "../../types/web-apps";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

export function WebAppsRailPage({
  app,
  onInstall,
  onStart,
  operation,
  settled,
  loadError,
  onRetry,
  onConfirm,
}: {
  app: WebApp | null;
  onInstall: () => Promise<void>;
  onStart: () => Promise<void>;
  operation: WebAppOperation | null;
  settled: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const showLoading = useDelayedLoading(!settled);
  if (!app) {
    if (showLoading) return <div className="quiet-message tw:text-xs" role="status">Loading Web Apps…</div>;
    if (!settled) return null;
    return (
      <div className="quiet-message history-status unavailable tw:text-xs" role={loadError ? "alert" : undefined}>
        <strong>{loadError ? "Web Apps unavailable" : "No Web Apps available"}</strong>
        {loadError && <span>{loadError}</span>}
        {loadError && <Button variant="outline" className="tw:mt-1 tw:h-10 tw:w-fit tw:rounded-full tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" onClick={() => void onRetry()}>Retry</Button>}
      </div>
    );
  }
  const ready = app.prerequisites.git && app.prerequisites.node24 && app.prerequisites.corepack;
  const action = () => {
    if (app.running || (!app.installed && !ready)) return;
    if (app.installed) {
      void onStart();
      return;
    }
    onConfirm({
      title: "Install OpenDesign?",
      description:
        `DevHatch will download OpenDesign ${app.version ?? "0.18.2"} and build it locally under ${app.installPath}. ` +
        "The installation requires Git, Node.js 24, Corepack, and network access.",
      confirmLabel: "Install",
      action: onInstall,
    });
  };
  return (
    <div className="menu-section">
      <p className="menu-label">Available Apps</p>
      <Button variant="outline" className="webapp-rail-card tw:h-auto tw:min-h-16 tw:w-full tw:justify-start tw:gap-2.5 tw:rounded-xl tw:border-border tw:bg-card tw:px-2.5 tw:py-2 tw:text-left tw:font-normal tw:whitespace-normal tw:hover:border-input tw:hover:bg-popover!" type="button" onClick={action} disabled={operation !== null || app.running || (!app.installed && !ready)}>
        <img className="tw:size-9 tw:flex-none tw:rounded-[10px]" src={openDesignIcon} alt="" />
        <span className="tw:min-w-0 tw:flex-1">
          <strong className="tw:block tw:text-[calc(13px*var(--app-font-scale))] tw:font-semibold tw:text-foreground">{app.name}</strong>
          <small className="tw:mt-1 tw:block tw:text-xs tw:leading-snug tw:text-muted-foreground">{app.running ? "Running" : app.installed ? `Installed · v${app.version}` : "Not installed"}</small>
        </span>
        {app.installing || app.updating ? <LoaderCircle className="spin tw:size-4 tw:text-muted-foreground" /> : app.running ? <CircleCheck className="tw:size-4 tw:text-[var(--color-success-fg)]" /> : <Play className="tw:size-4 tw:text-muted-foreground" />}
      </Button>
    </div>
  );
}

export function WebAppsWorkspace({
  app,
  operation,
  error,
  settled,
  loadError,
  onRetry,
  onInstall,
  onStart,
  onUpdate,
  onCheckUpdate,
  onConfirm,
  onDismissError,
}: {
  app: WebApp | null;
  operation: WebAppOperation | null;
  error: string | null;
  settled: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
  onInstall: () => Promise<void>;
  onStart: () => Promise<void>;
  onUpdate: () => Promise<void>;
  onCheckUpdate: () => Promise<void>;
  onConfirm: (action: ConfirmAction) => void;
  onDismissError: () => void;
}) {
  const showLoading = useDelayedLoading(!settled);
  if (!app) {
    if (showLoading) return <WebAppsEmpty busy message="Loading Web Apps…" notice={error} onDismissNotice={onDismissError} />;
    if (!settled) return <div className="webapps-workspace tw:relative tw:min-h-0 tw:@container/webapps-workspace tw:bg-[var(--color-canvas)]" aria-busy="true">{error && <WebAppError error={error} onDismiss={onDismissError} />}</div>;
    return <WebAppsEmpty error={loadError} message={loadError ? "Web Apps unavailable" : "No Web Apps available"} onRetry={loadError ? onRetry : undefined} notice={error} onDismissNotice={onDismissError} />;
  }
  const ready = app.prerequisites.git && app.prerequisites.node24 && app.prerequisites.corepack;
  const install = () =>
    onConfirm({
      title: "Install OpenDesign?",
      description:
        `OpenDesign 0.18.2 will be downloaded from its official GitHub repository and built under ${app.installPath}. ` +
        "This may take several minutes and use significant disk space.",
      confirmLabel: "Install OpenDesign",
      action: onInstall,
    });
  const phase = phaseLabel(app.phase);
  const runningUrl = app.running && app.url ? app.url : null;
  const runningError = error ?? app.error;
  const announcement = app.error || error ? "" : `OpenDesign status: ${app.running ? "Running" : phase}.`;
  return (
    <div className={cn("webapps-workspace tw:relative tw:min-h-0", runningUrl ? "is-running tw:h-full tw:overflow-hidden tw:bg-card" : "tw:overflow-auto tw:@container/webapps-workspace tw:bg-[var(--color-canvas)]")}>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      {runningUrl ? (
        <>
          <section className="webapp-frame-shell tw:h-full tw:w-full tw:overflow-hidden" aria-label="OpenDesign application">
            <iframe className="tw:block tw:h-full tw:w-full tw:border-0" title="OpenDesign" src={runningUrl} allow="clipboard-read; clipboard-write" />
          </section>
          {runningError && <WebAppError error={runningError} onDismiss={error ? onDismissError : undefined} />}
        </>
      ) : (
        <>
          <div className="tw:min-h-full tw:p-10 tw:@max-[640px]/webapps-workspace:px-3.5 tw:@max-[640px]/webapps-workspace:py-5">
        <Card className="webapp-hero tw:mx-auto tw:flex tw:w-full tw:max-w-[880px] tw:flex-row tw:items-center tw:gap-7 tw:rounded-[20px] tw:border tw:border-border tw:bg-card tw:p-[34px] tw:ring-0 tw:shadow-[0_8px_24px_rgb(0_0_0/5%)] tw:@max-[720px]/webapps-workspace:items-start tw:@max-[720px]/webapps-workspace:gap-5 tw:@max-[720px]/webapps-workspace:p-5 tw:@max-[520px]/webapps-workspace:flex-col">
          <div className="webapp-icon tw:size-28 tw:flex-none tw:@max-[720px]/webapps-workspace:size-20 tw:@max-[520px]/webapps-workspace:size-[72px]">
            <img className="tw:size-full tw:rounded-[30px] tw:shadow-[0_12px_28px_rgb(0_0_0/16%)] tw:@max-[720px]/webapps-workspace:rounded-[22px]" src={openDesignIcon} alt="" />
          </div>
          <div className="webapp-copy tw:min-w-0 tw:flex-1">
            <span className={cn("webapp-status tw:inline-flex tw:items-center tw:gap-1.5 tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:leading-none tw:text-muted-foreground tw:uppercase", app.running && "tw:text-[var(--color-success-fg)]", app.error && "tw:text-destructive")}>
              {app.installing && <LoaderCircle className="spin tw:size-3" />}
              {app.running ? "Running" : phase}
            </span>
            <h2 className="tw:mt-2 tw:mb-0 tw:text-[calc(28px*var(--app-font-scale))] tw:leading-tight tw:tracking-[-0.035em] tw:text-foreground tw:@max-[520px]/webapps-workspace:text-[calc(22px*var(--app-font-scale))]">OpenDesign</h2>
            <p className="tw:mt-2 tw:mb-0 tw:text-[calc(13px*var(--app-font-scale))] tw:leading-relaxed tw:text-muted-foreground">{app.description}</p>
            {app.updateAvailable && <span className="webapp-update-badge tw:mt-2.5 tw:inline-block tw:rounded-full tw:bg-[var(--color-accent-soft)] tw:px-2 tw:py-1 tw:text-[calc(11px*var(--app-font-scale))] tw:font-semibold tw:text-[var(--color-warning-fg)]">Update available · v{app.latestVersion ?? "unknown"}</span>}
            <div className="webapp-actions tw:mt-5 tw:flex tw:flex-wrap tw:gap-2">
              {!app.installed && (
                <WebAppAction disabled={!ready || operation !== null} onClick={install} fullWidth>
                  {operation === "install" ? <LoaderCircle className="spin" /> : <Download />}
                  {operation === "install" ? phase : "Install OpenDesign"}
                </WebAppAction>
              )}
              {app.installed && !app.running && !app.updating && (
                <WebAppAction disabled={operation !== null} onClick={() => void onStart()} fullWidth>
                  {operation === "start" ? <LoaderCircle className="spin" /> : <Play />}
                  {operation === "start" ? "Starting…" : "Start OpenDesign"}
                </WebAppAction>
              )}
              {app.installed && app.updateAvailable && !app.updating && (
                <WebAppAction variant="outline" disabled={operation !== null} onClick={() => onConfirm({ title: "Update OpenDesign?", description: "DevHatch will stop OpenDesign, pull the latest changes, rebuild it, and restore the running state.", confirmLabel: "Update", action: onUpdate })}>
                  {operation === "update" ? <LoaderCircle className="spin" /> : <Download />}{operation === "update" ? "Updating…" : "Update OpenDesign"}
                </WebAppAction>
              )}
              {app.installed && !app.updating && (
                <WebAppAction variant="outline" disabled={operation !== null} onClick={() => void onCheckUpdate()}>
                  {operation === "check" ? <LoaderCircle className="spin" /> : <RefreshCw />}
                  {operation === "check" ? "Checking…" : "Check for updates"}
                </WebAppAction>
              )}
            </div>
          </div>
        </Card>
        {(app.installing || app.updating) && (
          <Card className="webapp-progress-card tw:mx-auto tw:mt-[18px] tw:w-full tw:max-w-[880px] tw:gap-2.5 tw:rounded-2xl tw:border tw:border-border tw:bg-card tw:px-[22px] tw:py-[18px] tw:ring-0">
            <div className="tw:flex tw:items-center tw:justify-between tw:gap-4 tw:text-xs">
              <strong className="tw:text-foreground">{phase}</strong>
              <span className="tw:text-right tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:text-muted-foreground">{app.downloadedBytes !== null ? `${formatBytes(app.downloadedBytes)}${app.totalBytes !== null ? ` / ~${formatBytes(app.totalBytes)}` : ""} · ` : ""}{app.progress}%</span>
            </div>
            <progress className="tw:h-2 tw:w-full tw:overflow-hidden tw:rounded-full tw:border-0" max="100" value={app.progress} aria-label={`${phase} progress`} />
          </Card>
        )}
        <Card className="webapp-details tw:mx-auto tw:mt-[18px] tw:w-full tw:max-w-[880px] tw:gap-0 tw:rounded-[20px] tw:border tw:border-border tw:bg-card tw:px-[30px] tw:py-[26px] tw:ring-0 tw:shadow-[0_8px_24px_rgb(0_0_0/5%)] tw:@max-[640px]/webapps-workspace:px-5 tw:@max-[640px]/webapps-workspace:py-[22px]">
          <h3 className="tw:mt-0 tw:mb-[18px] tw:text-base tw:font-semibold tw:text-foreground">Local installation</h3>
          <dl className="webapp-detail-grid tw:m-0 tw:grid tw:grid-cols-2 tw:gap-px tw:overflow-hidden tw:rounded-xl tw:border tw:border-border tw:bg-border tw:@max-[640px]/webapps-workspace:grid-cols-1">
            <Detail label="Version" value={app.version ? `v${app.version}` : "0.18.2"} />
            <Detail label="Install path" value={app.installPath} mono />
            <Detail label="Git" value={app.prerequisites.git ? "Ready" : "Required"} ok={app.prerequisites.git} />
            <Detail label="Node.js 24" value={app.prerequisites.node24 ? "Ready" : "Required"} ok={app.prerequisites.node24} />
            <Detail label="Corepack" value={app.prerequisites.corepack ? "Ready" : "Required"} ok={app.prerequisites.corepack} />
          </dl>
          {!ready && <p className="webapp-warning tw:mt-3.5 tw:mb-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[var(--color-warning-fg)]"><CircleAlert className="tw:mt-0.5 tw:size-3.5 tw:flex-none" />Install the missing prerequisites before continuing.</p>}
          {app.error && <p className="webapp-warning tw:mt-3.5 tw:mb-0 tw:flex tw:items-start tw:gap-2 tw:text-xs tw:leading-relaxed tw:text-[var(--color-warning-fg)]" role="alert"><CircleAlert className="tw:mt-0.5 tw:size-3.5 tw:flex-none" />{app.error}</p>}
        </Card>
          </div>
          {error && <WebAppError error={error} onDismiss={onDismissError} />}
        </>
      )}
    </div>
  );
}

function WebAppsEmpty({ busy = false, error, message, notice, onRetry, onDismissNotice }: { busy?: boolean; error?: string | null; message: string; notice?: string | null; onRetry?: () => Promise<void>; onDismissNotice?: () => void }) {
  return (
    <div className="webapps-workspace tw:relative tw:min-h-0 tw:overflow-auto tw:@container/webapps-workspace tw:bg-[var(--color-canvas)]" aria-busy={busy || undefined}>
      <div className="tw:min-h-full tw:p-10 tw:@max-[640px]/webapps-workspace:px-3.5 tw:@max-[640px]/webapps-workspace:py-5">
        <div className="empty-state" role={busy ? "status" : error ? "alert" : undefined}>
          <strong>{message}</strong>
          {error && <span>{error}</span>}
          {onRetry && <Button className="tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" onClick={() => void onRetry()}>Retry</Button>}
        </div>
      </div>
      {notice && <WebAppError error={notice} onDismiss={onDismissNotice} />}
    </div>
  );
}

function WebAppAction({ variant = "default", fullWidth = false, className, ...props }: React.ComponentProps<typeof Button> & { fullWidth?: boolean }) {
  return <Button variant={variant} className={cn("tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:font-semibold tw:[@media(pointer:coarse)]:h-11 tw:@max-[520px]/webapps-workspace:w-full", fullWidth && "tw:@max-[640px]/webapps-workspace:w-full", className)} type="button" {...props} />;
}

function WebAppError({ error, onDismiss }: { error: string; onDismiss?: () => void }) {
  return (
    <div className="error-banner webapp-error-banner tw:w-max tw:max-w-[min(560px,calc(100%-32px))]" role="alert">
      <span className="tw:min-w-0 tw:[overflow-wrap:anywhere]">{error}</span>
      {onDismiss && <Button variant="ghost" size="icon" className="tw:size-10 tw:flex-none tw:rounded-full tw:text-[var(--color-on-solid)] tw:hover:bg-[color-mix(in_srgb,var(--color-on-solid)_12%,transparent)]! tw:hover:text-[var(--color-on-solid)]! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Dismiss" onClick={onDismiss}><X className="tw:size-3" /></Button>}
    </div>
  );
}

function Detail({ label, value, mono, ok }: { label: string; value: string; mono?: boolean; ok?: boolean }) {
  return (
    <div className="webapp-detail tw:min-w-0 tw:bg-card tw:px-3.5 tw:py-3">
      <dt className="tw:text-xs tw:text-muted-foreground">{label}</dt>
      <dd className={cn("tw:mt-1.5 tw:mb-0 tw:flex tw:items-start tw:gap-1.5 tw:text-[calc(13px*var(--app-font-scale))] tw:font-semibold tw:text-foreground", mono && "tw:break-all tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:leading-relaxed", ok === true && "tw:text-[var(--color-success-fg)]", ok === false && "tw:text-[var(--color-warning-fg)]")} title={mono ? value : undefined}>
        {ok !== undefined && (ok ? <CircleCheck className="tw:mt-0.5 tw:size-3.5 tw:flex-none" /> : <CircleAlert className="tw:mt-0.5 tw:size-3.5 tw:flex-none" />)}{value}
      </dd>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function phaseLabel(phase: WebApp["phase"]) {
  return ({
    "not-installed": "Not installed",
    preparing: "Preparing…",
    downloading: "Downloading…",
    installing: "Installing dependencies…",
    building: "Building OpenDesign…",
    updating: "Pulling update…",
    "installing-update": "Installing update…",
    "building-update": "Building update…",
    stopped: "Installed",
    starting: "Starting…",
    running: "Running",
    failed: "Installation failed",
  } as const)[phase];
}
