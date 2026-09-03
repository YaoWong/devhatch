import type { Agent } from "../../types/agents";
import type { LaunchPathDisplay } from "../../types/app";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { PixelRangeControl } from "../../shared/ui/PixelRangeControl";
import { TerminalLayoutPresetControl } from "./TerminalLayoutPresetControl";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "./terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "./terminalWorkspaceDock";

export function TerminalSettingsControls({
  capacity,
  layoutCount,
  layoutPreset,
  pathDisplay,
  thumbnailsAutoHide,
  thumbnailSide,
  launchPathsHeight,
  confirmClose,
  agents,
  defaultAgentId,
  showLaunchPathsHeight = true,
  showConfirmClose = true,
  onCapacityChange,
  onLayoutPresetChange,
  onPathDisplayChange,
  onToggleThumbnailAutoHide,
  onThumbnailSideChange,
  onLaunchPathsHeightChange,
  onConfirmCloseChange,
  onDefaultAgentChange,
}: {
  capacity: TerminalWorkspaceCapacity;
  layoutCount: TerminalLayoutCount | null;
  layoutPreset: TerminalLayoutPreset | null;
  pathDisplay: LaunchPathDisplay;
  thumbnailsAutoHide: boolean;
  thumbnailSide: "left" | "right";
  launchPathsHeight: number;
  confirmClose: boolean;
  agents?: Agent[];
  defaultAgentId?: string | null;
  showLaunchPathsHeight?: boolean;
  showConfirmClose?: boolean;
  onCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleThumbnailAutoHide: () => void;
  onThumbnailSideChange: (side: "left" | "right") => void;
  onLaunchPathsHeightChange: (height: number) => void;
  onConfirmCloseChange: (enabled: boolean) => void;
  onDefaultAgentChange?: (agentId: string) => void;
}) {
  const availableAgents = agents?.filter((agent) => agent.enabled && agent.available) ?? [];
  return <>
    {availableAgents.length > 0 && onDefaultAgentChange && <div className="terminal-setting-row terminal-default-agent-row">
      <span>Default agent</span>
      <CustomSelect
        compact
        popupSize="terminal"
        label="Default agent"
        value={availableAgents.some((agent) => agent.id === defaultAgentId) ? defaultAgentId ?? availableAgents[0].id : availableAgents[0].id}
        options={availableAgents}
        getOptionLabel={(agent) => agent.name}
        renderTrigger={(agent) => <strong>{agent?.name ?? "Select agent"}</strong>}
        renderOption={(agent) => <strong>{agent.name}</strong>}
        onChange={onDefaultAgentChange}
      />
    </div>}
    <div className="terminal-setting-row">
      <span>Capacity</span>
      <div className="terminal-capacity-control" role="group" aria-label="Stage capacity">
        {([1, 2, 3, 4] as const).map((value) => <button key={value} type="button" aria-label={`Capacity ${value}`} aria-pressed={capacity === value} onClick={() => onCapacityChange(value)}>{value}</button>)}
      </div>
    </div>
    {layoutCount && layoutPreset && <div className="terminal-setting-row">
      <span>Layout</span>
      <TerminalLayoutPresetControl count={layoutCount} value={layoutPreset} onChange={onLayoutPresetChange} />
    </div>}
    <div className="terminal-setting-row">
      <span>Path display</span>
      <div className="terminal-capacity-control path-display-control" role="group" aria-label="Launch path display">
        {(["folder", "full"] as const).map((mode) => <button key={mode} type="button" aria-label={mode === "folder" ? "Show relative paths" : "Show absolute paths"} aria-pressed={pathDisplay === mode} onClick={() => onPathDisplayChange(mode)}>{mode === "folder" ? "Relative" : "Absolute"}</button>)}
      </div>
    </div>
    {showLaunchPathsHeight && <div className="terminal-setting-row terminal-setting-range">
      <span>Launch paths height</span>
      <PixelRangeControl compact label="Launch paths height" min={160} max={480} step={8} value={launchPathsHeight} onChange={onLaunchPathsHeightChange} />
    </div>}
    {showConfirmClose && <label className="terminal-setting-row">
      <span>Confirm close</span>
      <input type="checkbox" role="switch" checked={confirmClose} onChange={(event) => onConfirmCloseChange(event.target.checked)} />
    </label>}
    <label className="terminal-setting-row">
      <span>Auto-hide thumbnails</span>
      <input type="checkbox" role="switch" checked={thumbnailsAutoHide} onChange={onToggleThumbnailAutoHide} />
    </label>
    <div className="terminal-setting-row">
      <span>Thumbnail side</span>
      <div className="terminal-capacity-control" role="group" aria-label="Thumbnail side">
        {(["left", "right"] as const).map((side) => <button key={side} type="button" aria-label={side === "left" ? "Show thumbnails on the left" : "Show thumbnails on the right"} aria-pressed={thumbnailSide === side} onClick={() => onThumbnailSideChange(side)}>{side === "left" ? "L" : "R"}</button>)}
      </div>
    </div>
  </>;
}
