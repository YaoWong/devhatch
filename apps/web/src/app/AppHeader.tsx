import { Eye, EyeOff, LoaderCircle, Menu, PanelLeftClose, Square } from "lucide-react";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import type { WorkspaceMode } from "../types/app";
import type { WebAppOperation } from "../types/web-apps";

export function AppHeader({
  mode,
  label,
  subtitle,
  onToggleNavigation,
  terminalCapacity,
  terminalThumbnailsHidden,
  onTerminalCapacityChange,
  onToggleTerminalThumbnails,
  webAppRunning,
  webAppOperation,
  onStopWebApp,
}: {
  mode: WorkspaceMode;
  label: string;
  subtitle: string;
  onToggleNavigation: () => void;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalThumbnailsHidden: boolean;
  onTerminalCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onToggleTerminalThumbnails: () => void;
  webAppRunning: boolean;
  webAppOperation: WebAppOperation | null;
  onStopWebApp: () => void;
}) {
  const thumbnailsLabel = terminalThumbnailsHidden ? "Show terminal thumbnails" : "Hide terminal thumbnails";
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
        <div className="top-actions terminal-top-actions">
          <div className="terminal-capacity-control" role="group" aria-label="Stage capacity">
            {([1, 2, 3] as const).map((value) => <button key={value} type="button" aria-label={`Capacity ${value}`} aria-pressed={terminalCapacity === value} onClick={() => onTerminalCapacityChange(value)}>{value}</button>)}
          </div>
          <button className="icon-button" type="button" aria-label={thumbnailsLabel} aria-pressed={!terminalThumbnailsHidden} title={thumbnailsLabel} onClick={onToggleTerminalThumbnails}>
            {terminalThumbnailsHidden ? <EyeOff /> : <Eye />}
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
