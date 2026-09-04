import { Columns2, Grid2X2, PanelLeft, PanelRight, Rows2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  return <div className="terminal-layout-control tw:ml-auto tw:flex tw:max-w-full tw:gap-0.5 tw:rounded-[9px] tw:border tw:border-border tw:bg-card tw:p-0.5 tw:[@media(pointer:coarse)]:max-w-[96px] tw:[@media(pointer:coarse)]:flex-wrap" role="group" aria-label={`${count} terminal layout`}>
    {terminalLayoutPresets(count).map((preset) => <Button variant="ghost" size="icon" className="tw:size-10 tw:rounded-md tw:border-0 tw:text-muted-foreground tw:transition-none tw:hover:bg-muted! tw:aria-pressed:bg-foreground tw:aria-pressed:text-[var(--color-on-solid)] tw:aria-pressed:hover:bg-foreground! tw:aria-pressed:hover:text-[var(--color-on-solid)]! tw:active:not-aria-[haspopup]:translate-y-0! tw:[@media(pointer:coarse)]:size-11" key={preset} type="button" title={terminalLayoutLabel(preset)} aria-label={terminalLayoutLabel(preset)} aria-pressed={value === preset} onClick={() => onChange(preset)}>{icon(preset)}</Button>)}
  </div>;
}
