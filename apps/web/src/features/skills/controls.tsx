import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { SourceFilter } from "./search";

export function SourceFilterControl({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return (
    <div className="skills-filter" aria-label="Filter by source">
      {(["all", "custom", "repository"] as const).map((option) => (
        <button type="button" className={value === option ? "active" : ""} key={option} onClick={() => onChange(option)}>
          {option === "all" ? "All" : option === "custom" ? "My skills" : "Repositories"}
        </button>
      ))}
    </div>
  );
}

export function TreeControls({ allCollapsed, disabled = false, onToggle }: { allCollapsed: boolean; disabled?: boolean; onToggle: () => void }) {
  const label = allCollapsed ? "Expand all" : "Collapse all";
  const Icon = allCollapsed ? ChevronDown : ChevronRight;
  return (
    <div className="tree-controls">
      <button type="button" disabled={disabled} aria-label={label} title={label} onClick={onToggle}><Icon /><span>{label}</span></button>
    </div>
  );
}

export function SearchField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="skills-search"><Search /><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function WorkspaceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="skills-content"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>;
}

export function Empty({ text }: { text: string }) {
  return <div className="skills-empty">{text}</div>;
}
