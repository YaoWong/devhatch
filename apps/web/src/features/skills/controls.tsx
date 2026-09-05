import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SourceFilter } from "./search";

const compactButtonClass = "tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11";

export function SourceFilterControl({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return (
    <div className="skills-filter" role="group" aria-label="Filter by source">
      {(["all", "custom", "repository"] as const).map((option) => (
        <Button
          type="button"
          variant="ghost"
          className={`tw:h-10 tw:rounded-none tw:px-2.5 tw:text-xs tw:font-medium tw:transition-none tw:first:rounded-l-lg tw:last:rounded-r-lg tw:[@media(pointer:coarse)]:h-11 ${value === option ? "active tw:bg-card tw:text-foreground tw:shadow-sm" : "tw:text-muted-foreground"}`}
          aria-pressed={value === option}
          key={option}
          onClick={() => onChange(option)}
        >
          {option === "all" ? "All" : option === "custom" ? "My skills" : "Repositories"}
        </Button>
      ))}
    </div>
  );
}

export function TreeControls({ allCollapsed, disabled = false, onToggle }: { allCollapsed: boolean; disabled?: boolean; onToggle: () => void }) {
  const label = allCollapsed ? "Expand all" : "Collapse all";
  const Icon = allCollapsed ? ChevronDown : ChevronRight;
  return (
    <div className="tree-controls">
      <Button type="button" variant="secondary" className={compactButtonClass} disabled={disabled} aria-label={label} title={label} onClick={onToggle}><Icon className="tw:size-[13px]" /><span>{label}</span></Button>
    </div>
  );
}

export function SearchField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="skills-search"><span className="sr-only">{placeholder}</span><Search className="tw:size-[15px]" /><Input variant="bare" type="search" spellCheck={false} className="tw:h-full tw:w-full tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.3] tw:font-normal tw:text-foreground tw:placeholder:text-muted-foreground" aria-label={placeholder} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function WorkspaceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="skills-content"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>;
}

export function Empty({ text }: { text: string }) {
  return <div className="skills-empty">{text}</div>;
}
