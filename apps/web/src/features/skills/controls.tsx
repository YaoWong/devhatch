import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SourceFilter } from "./search";

export const skillsPrimaryButtonClass = "skills-primary tw:h-10 tw:rounded-lg tw:bg-foreground tw:px-3.5 tw:text-xs tw:font-semibold tw:text-[var(--color-on-solid)] tw:shadow-sm tw:transition-[background-color,box-shadow,transform] tw:duration-150 tw:hover:bg-[color-mix(in_srgb,var(--color-text)_88%,var(--color-canvas))]! tw:hover:text-[var(--color-on-solid)]! tw:hover:shadow-md tw:active:shadow-none tw:[@media(pointer:coarse)]:h-11";
export const skillsSecondaryButtonClass = "skills-button tw:h-10 tw:rounded-lg tw:px-3 tw:text-xs tw:font-semibold tw:transition-[background-color,border-color,color,box-shadow,transform] tw:duration-150 tw:hover:shadow-sm tw:[@media(pointer:coarse)]:h-11";
export const skillsIconButtonClass = "skills-icon-button tw:size-10 tw:rounded-lg tw:transition-[background-color,border-color,color,box-shadow,transform] tw:duration-150 tw:hover:shadow-sm tw:[@media(pointer:coarse)]:size-11";

type SkillsButtonProps = Omit<React.ComponentProps<typeof Button>, "variant">;
type SkillsIconButtonProps = Omit<SkillsButtonProps, "size">;

export function SkillsPrimaryButton({ className, ...props }: SkillsButtonProps) {
  return <Button variant="default" className={cn(skillsPrimaryButtonClass, className)} {...props} />;
}

export function SkillsSecondaryButton({ className, ...props }: SkillsButtonProps) {
  return <Button variant="outline" className={cn(skillsSecondaryButtonClass, className)} {...props} />;
}

export function SkillsIconButton({ className, ...props }: SkillsIconButtonProps) {
  return <Button variant="outline" size="icon" className={cn(skillsIconButtonClass, className)} {...props} />;
}

export function SourceFilterControl({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return (
    <div className="skills-filter" role="group" aria-label="Filter by source">
      {(["all", "custom", "repository"] as const).map((option) => (
        <Button
          type="button"
          variant="ghost"
          className={`tw:h-10 tw:min-w-0 tw:rounded-none tw:px-2.5 tw:text-xs tw:font-medium tw:transition-colors tw:duration-150 tw:first:rounded-l-lg tw:last:rounded-r-lg tw:[@media(pointer:coarse)]:h-11 ${value === option ? "active tw:bg-card tw:text-foreground tw:shadow-sm" : "tw:text-muted-foreground"}`}
          aria-label={option === "repository" ? "Repos, filter to repository skills" : undefined}
          aria-pressed={value === option}
          key={option}
          onClick={() => onChange(option)}
        >
          {option === "all" ? "All" : option === "custom" ? "My skills" : "Repos"}
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
      <SkillsSecondaryButton type="button" disabled={disabled} aria-label={label} title={label} onClick={onToggle}><Icon className="tw:size-[13px]" /><span>{label}</span></SkillsSecondaryButton>
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
