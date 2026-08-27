import { LoaderCircle, Menu, PanelLeftClose, Plus, Square } from "lucide-react";
import type { WorkspaceMode } from "../types/app";
import type { WebAppOperation } from "../types/web-apps";

export function AppHeader({
  mode,
  label,
  subtitle,
  onToggleNavigation,
  onNewTerminal,
  newTerminalBusy,
  webAppRunning,
  webAppOperation,
  onStopWebApp,
}: {
  mode: WorkspaceMode;
  label: string;
  subtitle: string;
  onToggleNavigation: () => void;
  onNewTerminal: () => void;
  newTerminalBusy: boolean;
  webAppRunning: boolean;
  webAppOperation: WebAppOperation | null;
  onStopWebApp: () => void;
}) {
  return (
    <header className="topbar">
      <button className="icon-button menu-button" aria-label="Toggle navigation" onClick={onToggleNavigation}>
        <Menu className="menu-icon-open" />
        <PanelLeftClose className="menu-icon-hide" />
      </button>
      <div className="breadcrumb">
        <strong>{label}</strong>
        <span>{subtitle}</span>
      </div>
      {mode === "terminal" && (
        <div className="top-actions">
          <button className="secondary-button" disabled={newTerminalBusy} onClick={onNewTerminal}>
            <Plus />
            <span>New terminal</span>
          </button>
        </div>
      )}
      {mode === "webapp" && webAppRunning && (
        <div className="top-actions">
          <button className="secondary-button" disabled={webAppOperation !== null} onClick={onStopWebApp}>
            {webAppOperation === "stop" ? <LoaderCircle className="spin" /> : <Square />}
            <span>{webAppOperation === "stop" ? "Stopping…" : "Stop"}</span>
          </button>
        </div>
      )}
    </header>
  );
}
