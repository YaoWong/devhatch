import { CircleAlert, CircleCheck, Download, LoaderCircle, Play, RefreshCw } from "lucide-react";
import openDesignIcon from "../assets/open-design.svg";
import type { ConfirmAction, WebApp } from "../types";

export function WebAppsRailPage({
  app,
  onInstall,
  onStart,
  onOpen,
  onConfirm,
}: {
  app: WebApp | null;
  onInstall: () => Promise<void>;
  onStart: () => Promise<void>;
  onOpen: () => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  if (!app) return <div className="quiet-message">Loading Web Apps…</div>;
  const action = () => {
    if (app.running) {
      onOpen();
      return;
    }
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
      <button className="webapp-rail-card" onClick={action} disabled={app.installing}>
        <img src={openDesignIcon} alt="" />
        <span>
          <strong>{app.name}</strong>
          <small>{app.running ? "Running" : app.installed ? `Installed · v${app.version}` : "Not installed"}</small>
        </span>
        {app.installing || app.updating ? <LoaderCircle className="spin" /> : app.running ? <CircleCheck /> : <Play />}
      </button>
    </div>
  );
}

export function WebAppsWorkspace({
  app,
  operation,
  error,
  onInstall,
  onStart,
  onUpdate,
  onCheckUpdate,
  onConfirm,
  onDismissError,
}: {
  app: WebApp | null;
  operation: "start" | "stop" | "check" | null;
  error: string | null;
  onInstall: () => Promise<void>;
  onStart: () => Promise<void>;
  onUpdate: () => Promise<void>;
  onCheckUpdate: () => Promise<void>;
  onConfirm: (action: ConfirmAction) => void;
  onDismissError: () => void;
}) {
  if (!app) return <div className="webapps-workspace"><div className="empty-state">Loading Web Apps…</div></div>;
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
  if (app.running && app.url) {
    return (
      <div className="webapps-workspace is-running">
        <section className="webapp-frame-shell">
          <iframe title="OpenDesign" src={app.url} allow="clipboard-read; clipboard-write" />
        </section>
        {error && <div className="error-banner">{error}<button aria-label="Dismiss" onClick={onDismissError}>×</button></div>}
      </div>
    );
  }
  return (
    <div className="webapps-workspace">
      <section className="webapp-hero">
        <div className="webapp-icon"><img src={openDesignIcon} alt="" /></div>
        <div className="webapp-copy">
          <span className={`webapp-status ${app.running ? "running" : app.error ? "failed" : ""}`}>
            {app.installing && <LoaderCircle className="spin" />}
            {app.running ? "Running" : phaseLabel(app.phase)}
          </span>
          <h2>OpenDesign</h2>
          <p>{app.description}</p>
          {app.updateAvailable && <span className="webapp-update-badge">Update available · v{app.latestVersion ?? "unknown"}</span>}
          <div className="webapp-actions">
            {!app.installed && (
              <button className="webapp-primary" disabled={!ready || app.installing} onClick={install}>
                {app.installing ? <LoaderCircle className="spin" /> : <Download />}
                {app.installing ? phaseLabel(app.phase) : "Install OpenDesign"}
              </button>
            )}
            {app.installed && !app.running && !app.updating && (
              <button className="webapp-primary" disabled={operation !== null} onClick={() => void onStart()}>
                {operation === "start" ? <LoaderCircle className="spin" /> : <Play />}
                {operation === "start" ? "Starting…" : "Start OpenDesign"}
              </button>
            )}
            {app.installed && app.updateAvailable && !app.updating && (
              <button className="webapp-secondary" onClick={() => onConfirm({ title: "Update OpenDesign?", description: "DevHatch will stop OpenDesign, pull the latest changes, rebuild it, and restore the running state.", confirmLabel: "Update", action: onUpdate })}>
                <Download />Update OpenDesign
              </button>
            )}
            {app.installed && !app.updating && (
              <button className="webapp-secondary" disabled={operation !== null} onClick={() => void onCheckUpdate()}>
                {operation === "check" ? <LoaderCircle className="spin" /> : <RefreshCw />}
                {operation === "check" ? "Checking…" : "Check for updates"}
              </button>
            )}
          </div>
        </div>
      </section>
      {(app.installing || app.updating) && (
        <section className="webapp-progress-card">
          <div>
            <strong>{phaseLabel(app.phase)}</strong>
            <span>{app.downloadedBytes ? `${formatBytes(app.downloadedBytes)}${app.totalBytes ? ` / ~${formatBytes(app.totalBytes)}` : ""} · ` : ""}{app.progress}%</span>
          </div>
          <progress max="100" value={app.progress} />
        </section>
      )}
      <section className="webapp-details">
        <h3>Local installation</h3>
        <div className="webapp-detail-grid">
          <Detail label="Version" value={app.version ? `v${app.version}` : "0.18.2"} />
          <Detail label="Install path" value={app.installPath} mono />
          <Detail label="Git" value={app.prerequisites.git ? "Ready" : "Required"} ok={app.prerequisites.git} />
          <Detail label="Node.js 24" value={app.prerequisites.node24 ? "Ready" : "Required"} ok={app.prerequisites.node24} />
          <Detail label="Corepack" value={app.prerequisites.corepack ? "Ready" : "Required"} ok={app.prerequisites.corepack} />
        </div>
        {!ready && <p className="webapp-warning"><CircleAlert />Install the missing prerequisites before continuing.</p>}
        {app.error && <p className="webapp-warning"><CircleAlert />{app.error}</p>}
      </section>
      {error && <div className="error-banner">{error}<button aria-label="Dismiss" onClick={onDismissError}>×</button></div>}
    </div>
  );
}

function Detail({ label, value, mono, ok }: { label: string; value: string; mono?: boolean; ok?: boolean }) {
  return <div className="webapp-detail"><span>{label}</span><strong className={mono ? "mono" : ""}>{ok !== undefined && (ok ? <CircleCheck /> : <CircleAlert />)}{value}</strong></div>;
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
