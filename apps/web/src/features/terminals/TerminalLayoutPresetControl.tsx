import { Columns2, Grid2X2, PanelLeft, PanelRight, Rows2 } from "lucide-react";
import { terminalLayoutLabel, terminalLayoutPresets, type TerminalLayoutCount, type TerminalLayoutPreset } from "./terminalWorkspaceLayout";

function icon(preset: TerminalLayoutPreset) {
  if (preset === "rows") return <Rows2 />;
  if (preset === "main-left") return <PanelLeft />;
  if (preset === "main-right") return <PanelRight />;
  if (preset === "grid") return <Grid2X2 />;
  return <Columns2 />;
}

export function TerminalLayoutPresetControl({ count, value, onChange }: {
  count: TerminalLayoutCount;
  value: TerminalLayoutPreset;
  onChange: (preset: TerminalLayoutPreset) => void;
}) {
  return <div className="terminal-layout-control" role="group" aria-label={`${count} terminal layout`}>
    {terminalLayoutPresets(count).map((preset) => <button key={preset} type="button" title={terminalLayoutLabel(preset)} aria-label={terminalLayoutLabel(preset)} aria-pressed={value === preset} onClick={() => onChange(preset)}>{icon(preset)}</button>)}
  </div>;
}
