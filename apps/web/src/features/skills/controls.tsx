import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SourceFilter } from "./search";

export const skillsPrimaryButtonClass = "tw:h-10 tw:rounded-lg tw:bg-foreground tw:px-3.5 tw:text-xs tw:font-semibold tw:text-[var(--color-on-solid)] tw:shadow-sm tw:transition-[background-color,box-shadow,transform] tw:duration-150 tw:hover:bg-[color-mix(in_srgb,var(--color-text)_88%,var(--color-canvas))]! tw:hover:text-[var(--color-on-solid)]! tw:hover:shadow-md tw:active:shadow-none tw:[@media(pointer:coarse)]:h-11";
export const skillsSecondaryButtonClass = "tw:h-10 tw:rounded-lg tw:px-3 tw:text-xs tw:font-semibold tw:transition-[background-color,border-color,color,box-shadow,transform] tw:duration-150 tw:hover:shadow-sm tw:[@media(pointer:coarse)]:h-11";
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
    <div className="tw:flex tw:w-fit tw:overflow-hidden tw:rounded-[9px] tw:border tw:border-border tw:bg-[var(--color-surface-muted)] tw:skills-max-480:w-full" role="group" aria-label="Filter by source">
      {(["all", "custom", "repository"] as const).map((option) => (
        <Button
          type="button"
          variant="ghost"
          className={`tw:h-10 tw:min-w-0 tw:flex-1 tw:rounded-none tw:px-2.5 tw:text-xs tw:font-medium tw:transition-colors tw:duration-150 tw:first:rounded-l-lg tw:last:rounded-r-lg tw:[@media(pointer:coarse)]:h-11 ${value === option ? "active tw:bg-card tw:text-foreground tw:shadow-sm" : "tw:text-muted-foreground"}`}
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
    <div className="tw:ml-auto tw:flex tw:gap-[4px] tw:skills-max-860:ml-0">
      <SkillsSecondaryButton type="button" disabled={disabled} aria-label={label} title={label} onClick={onToggle}><Icon className="tw:size-[13px]" /><span>{label}</span></SkillsSecondaryButton>
    </div>
  );
}

export function SearchField({ value, placeholder, className, onChange }: { value: string; placeholder: string; className?: string; onChange: (value: string) => void }) {
  return <label className={cn("skills-search tw:flex tw:h-[40px] tw:min-w-0 tw:items-center tw:gap-[8px] tw:rounded-[9px] tw:border tw:border-[var(--color-border-strong)] tw:bg-card tw:px-[11px] tw:text-muted-foreground tw:transition-[border-color,box-shadow] tw:duration-150 tw:focus-within:border-[var(--color-accent)] tw:focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_16%,transparent)] tw:[@media(pointer:coarse)]:h-[44px]", className)}><span className="tw:sr-only">{placeholder}</span><Search className="tw:size-[15px] tw:flex-none" /><Input variant="bare" type="search" spellCheck={false} className="tw:h-full tw:w-full tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.3] tw:font-normal tw:text-foreground tw:placeholder:text-muted-foreground" aria-label={placeholder} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function WorkspaceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="tw:mx-auto tw:w-[min(1040px,100%)]"><header className="tw:mb-[22px]"><h2 className="tw:m-0 tw:text-[calc(24px*var(--app-font-scale))] tw:tracking-[-0.03em]">{title}</h2><p className="tw:mt-[7px] tw:mr-0 tw:mb-0 tw:ml-0 tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground">{description}</p></header>{children}</section>;
}

export function Empty({ text, className }: { text: string; className?: string }) {
  return <div className={cn("tw:col-span-full tw:rounded-[12px] tw:border tw:border-dashed tw:border-[var(--color-border-strong)] tw:p-[28px] tw:text-center tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground", className)}>{text}</div>;
}
