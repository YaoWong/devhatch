import { Eye, EyeOff, LoaderCircle, Menu, PanelLeftClose, SlidersHorizontal, Square } from "lucide-react";
import { TerminalSettingsControls } from "../features/terminals/TerminalSettingsControls";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../features/terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../features/terminals/terminalWorkspaceDock";
import type { Agent } from "../types/agents";
import type { WorkspaceMode } from "../types/app";
import type { WebAppOperation } from "../types/web-apps";

export function AppHeader({
  mode,
  label,
  subtitle,
  onToggleNavigation,
  terminalCapacity,
  terminalLayoutCount,
  terminalLayoutPreset,
  terminalThumbnailsHidden,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalLaunchPathsHeight,
  confirmTerminalClose,
  onTerminalCapacityChange,
  onTerminalLayoutPresetChange,
  onToggleTerminalThumbnails,
  onToggleTerminalThumbnailAutoHide,
  onTerminalThumbnailSideChange,
  onTerminalLaunchPathsHeightChange,
  onConfirmTerminalCloseChange,
  agentCapacity,
  agentLayoutCount,
  agentLayoutPreset,
  agentThumbnailsHidden,
  agentThumbnailsAutoHide,
  agentThumbnailSide,
  agents,
  defaultAgentId,
  onAgentCapacityChange,
  onAgentLayoutPresetChange,
  onToggleAgentThumbnails,
  onToggleAgentThumbnailAutoHide,
  onAgentThumbnailSideChange,
  onDefaultAgentChange,
  webAppRunning,
  webAppOperation,
  onStopWebApp,
}: {
  mode: WorkspaceMode;
  label: string;
  subtitle: string;
  onToggleNavigation: () => void;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalLayoutCount: TerminalLayoutCount | null;
  terminalLayoutPreset: TerminalLayoutPreset | null;
  terminalThumbnailsHidden: boolean;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalLaunchPathsHeight: number;
  confirmTerminalClose: boolean;
  onTerminalCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onTerminalLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onToggleTerminalThumbnails: () => void;
  onToggleTerminalThumbnailAutoHide: () => void;
  onTerminalThumbnailSideChange: (side: "left" | "right") => void;
  onTerminalLaunchPathsHeightChange: (height: number) => void;
  onConfirmTerminalCloseChange: (enabled: boolean) => void;
  agentCapacity: TerminalWorkspaceCapacity;
  agentLayoutCount: TerminalLayoutCount | null;
  agentLayoutPreset: TerminalLayoutPreset | null;
  agentThumbnailsHidden: boolean;
  agentThumbnailsAutoHide: boolean;
  agentThumbnailSide: "left" | "right";
  agents: Agent[];
  defaultAgentId: string | null;
  onAgentCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onAgentLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onToggleAgentThumbnails: () => void;
  onToggleAgentThumbnailAutoHide: () => void;
  onAgentThumbnailSideChange: (side: "left" | "right") => void;
  onDefaultAgentChange: (agentId: string) => void;
  webAppRunning: boolean;
  webAppOperation: WebAppOperation | null;
  onStopWebApp: () => void;
}) {
  const terminalThumbnailsLabel = terminalThumbnailsHidden ? "Show terminal thumbnails" : "Hide terminal thumbnails";
  const agentThumbnailsLabel = agentThumbnailsHidden ? "Show agent thumbnails" : "Hide agent thumbnails";
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
          <button className="icon-button" type="button" aria-label={terminalThumbnailsLabel} aria-pressed={!terminalThumbnailsHidden} title={terminalThumbnailsLabel} onClick={onToggleTerminalThumbnails}>
            {terminalThumbnailsHidden ? <EyeOff /> : <Eye />}
          </button>
          <details className="classic-terminal-settings">
            <summary className="icon-button" aria-label="Terminal settings" title="Terminal settings"><SlidersHorizontal /></summary>
            <div className="classic-terminal-settings-panel" role="group" aria-label="Terminal settings">
              <TerminalSettingsControls
                capacity={terminalCapacity}
                layoutCount={terminalLayoutCount}
                layoutPreset={terminalLayoutPreset}
                thumbnailsAutoHide={terminalThumbnailsAutoHide}
                thumbnailSide={terminalThumbnailSide}
                launchPathsHeight={terminalLaunchPathsHeight}
                confirmClose={confirmTerminalClose}
                showLaunchPathsHeight={false}
                onCapacityChange={onTerminalCapacityChange}
                onLayoutPresetChange={onTerminalLayoutPresetChange}
                onToggleThumbnailAutoHide={onToggleTerminalThumbnailAutoHide}
                onThumbnailSideChange={onTerminalThumbnailSideChange}
                onLaunchPathsHeightChange={onTerminalLaunchPathsHeightChange}
                onConfirmCloseChange={onConfirmTerminalCloseChange}
              />
            </div>
          </details>
        </div>
      )}
      {mode === "agent" && (
        <div className="top-actions terminal-top-actions">
          <button className="icon-button" type="button" aria-label={agentThumbnailsLabel} aria-pressed={!agentThumbnailsHidden} title={agentThumbnailsLabel} onClick={onToggleAgentThumbnails}>
            {agentThumbnailsHidden ? <EyeOff /> : <Eye />}
          </button>
          <details className="classic-terminal-settings">
            <summary className="icon-button" aria-label="Agent settings" title="Agent settings"><SlidersHorizontal /></summary>
            <div className="classic-terminal-settings-panel" role="group" aria-label="Agent settings">
              <TerminalSettingsControls
                capacity={agentCapacity}
                layoutCount={agentLayoutCount}
                layoutPreset={agentLayoutPreset}
                thumbnailsAutoHide={agentThumbnailsAutoHide}
                thumbnailSide={agentThumbnailSide}
                launchPathsHeight={terminalLaunchPathsHeight}
                confirmClose={confirmTerminalClose}
                agents={agents}
                defaultAgentId={defaultAgentId}
                onCapacityChange={onAgentCapacityChange}
                onLayoutPresetChange={onAgentLayoutPresetChange}
                onToggleThumbnailAutoHide={onToggleAgentThumbnailAutoHide}
                onThumbnailSideChange={onAgentThumbnailSideChange}
                onLaunchPathsHeightChange={onTerminalLaunchPathsHeightChange}
                onConfirmCloseChange={onConfirmTerminalCloseChange}
                onDefaultAgentChange={onDefaultAgentChange}
              />
            </div>
          </details>
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
