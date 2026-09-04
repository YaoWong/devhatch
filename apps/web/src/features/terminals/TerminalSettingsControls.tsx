import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  const segmentClassName = "tw:h-10 tw:min-w-10 tw:rounded-full tw:border-0 tw:px-2 tw:font-mono tw:text-xs tw:font-semibold tw:text-muted-foreground tw:transition-none tw:hover:bg-muted! tw:aria-pressed:bg-foreground tw:aria-pressed:text-[var(--color-on-solid)] tw:aria-pressed:hover:bg-foreground! tw:aria-pressed:hover:text-[var(--color-on-solid)]! tw:active:not-aria-[haspopup]:translate-y-0! tw:[@media(pointer:coarse)]:h-11 tw:[@media(pointer:coarse)]:min-w-11";
  return <>
    {availableAgents.length > 0 && onDefaultAgentChange && <div className="terminal-setting-row">
      <span>Default agent</span>
      <CustomSelect
        className="tw:ml-auto tw:w-[min(150px,58%)]"
        density="compact"
        label="Default agent"
        value={availableAgents.some((agent) => agent.id === defaultAgentId) ? defaultAgentId ?? availableAgents[0].id : availableAgents[0].id}
        options={availableAgents}
        getOptionLabel={(agent) => agent.name}
        renderTrigger={(agent) => <strong className="tw:min-w-0 tw:overflow-hidden tw:text-xs tw:text-ellipsis tw:whitespace-nowrap">{agent?.name ?? "Select agent"}</strong>}
        renderOption={(agent) => <strong>{agent.name}</strong>}
        onChange={onDefaultAgentChange}
      />
    </div>}
    <div className="terminal-setting-row">
      <span>Capacity</span>
      <div className="tw:ml-auto tw:flex tw:max-w-full tw:rounded-full tw:border tw:border-input tw:bg-card tw:p-0.5 tw:[@media(pointer:coarse)]:max-w-[94px] tw:[@media(pointer:coarse)]:flex-wrap" role="group" aria-label="Stage capacity">
        {([1, 2, 3, 4] as const).map((value) => <Button variant="ghost" className={segmentClassName} key={value} type="button" aria-label={`Capacity ${value}`} aria-pressed={capacity === value} onClick={() => onCapacityChange(value)}>{value}</Button>)}
      </div>
    </div>
    {layoutCount && layoutPreset && <div className="terminal-setting-row">
      <span>Layout</span>
      <TerminalLayoutPresetControl count={layoutCount} value={layoutPreset} onChange={onLayoutPresetChange} />
    </div>}
    <div className="terminal-setting-row">
      <span>Path display</span>
      <div className="tw:ml-auto tw:flex tw:max-w-full tw:rounded-full tw:border tw:border-input tw:bg-card tw:p-0.5" role="group" aria-label="Launch path display">
        {(["folder", "full"] as const).map((mode) => <Button variant="ghost" className={`${segmentClassName} tw:min-w-16 tw:px-3 tw:font-sans`} key={mode} type="button" aria-label={mode === "folder" ? "Show relative paths" : "Show absolute paths"} aria-pressed={pathDisplay === mode} onClick={() => onPathDisplayChange(mode)}>{mode === "folder" ? "Relative" : "Absolute"}</Button>)}
      </div>
    </div>
    {showLaunchPathsHeight && <div className="terminal-setting-row terminal-setting-range">
      <span>Launch paths height</span>
      <PixelRangeControl compact label="Launch paths height" min={160} max={480} step={8} value={launchPathsHeight} onChange={onLaunchPathsHeightChange} />
    </div>}
    {showConfirmClose && <label className="terminal-setting-row tw:cursor-pointer">
      <span>Confirm close</span>
      <Switch className="tw:ml-auto tw:flex-none tw:after:-inset-x-2 tw:after:-inset-y-3 tw:data-checked:bg-[var(--color-accent)]" checked={confirmClose} onCheckedChange={onConfirmCloseChange} />
    </label>}
    <label className="terminal-setting-row tw:cursor-pointer">
      <span>Auto-hide thumbnails</span>
      <Switch className="tw:ml-auto tw:flex-none tw:after:-inset-x-2 tw:after:-inset-y-3 tw:data-checked:bg-[var(--color-accent)]" checked={thumbnailsAutoHide} onCheckedChange={(checked) => { if (checked !== thumbnailsAutoHide) onToggleThumbnailAutoHide(); }} />
    </label>
    <div className="terminal-setting-row">
      <span>Thumbnail side</span>
      <div className="tw:ml-auto tw:flex tw:max-w-full tw:rounded-full tw:border tw:border-input tw:bg-card tw:p-0.5 tw:[@media(pointer:coarse)]:max-w-[94px] tw:[@media(pointer:coarse)]:flex-wrap" role="group" aria-label="Thumbnail side">
        {(["left", "right"] as const).map((side) => <Button variant="ghost" className={segmentClassName} key={side} type="button" aria-label={side === "left" ? "Show thumbnails on the left" : "Show thumbnails on the right"} aria-pressed={thumbnailSide === side} onClick={() => onThumbnailSideChange(side)}>{side === "left" ? "L" : "R"}</Button>)}
      </div>
    </div>
  </>;
}
