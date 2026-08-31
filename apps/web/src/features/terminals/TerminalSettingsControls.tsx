import type { Agent } from "../../types/agents";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { TerminalLayoutPresetControl } from "./TerminalLayoutPresetControl";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "./terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "./terminalWorkspaceDock";

export function TerminalSettingsControls({
  capacity,
  layoutCount,
  layoutPreset,
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
  onToggleThumbnailAutoHide,
  onThumbnailSideChange,
  onLaunchPathsHeightChange,
  onConfirmCloseChange,
  onDefaultAgentChange,
}: {
  capacity: TerminalWorkspaceCapacity;
  layoutCount: TerminalLayoutCount | null;
  layoutPreset: TerminalLayoutPreset | null;
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
        label="Default agent"
        value={availableAgents.some((agent) => agent.id === defaultAgentId) ? defaultAgentId ?? availableAgents[0].id : availableAgents[0].id}
        options={availableAgents}
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
    {showLaunchPathsHeight && <label className="terminal-setting-row terminal-setting-range">
      <span>Launch paths height</span>
      <input type="range" min="160" max="480" step="8" value={launchPathsHeight} aria-label="Launch paths height" onChange={(event) => onLaunchPathsHeightChange(event.target.valueAsNumber)} />
      <output>{launchPathsHeight}px</output>
    </label>}
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
