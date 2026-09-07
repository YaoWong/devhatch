import { BookOpen, Boxes, FolderGit2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { railMenuLabelClass, railMenuSectionClass } from "../../shared/ui/railStyles";

export type SkillsSection = "repositories" | "skills" | "profiles";

export function SkillsRailPage({ section, onSelect }: { section: SkillsSection; onSelect: (section: SkillsSection) => void }) {
  const items = [
    { id: "repositories" as const, label: "Repos", icon: FolderGit2 },
    { id: "skills" as const, label: "Skill library", icon: BookOpen },
    { id: "profiles" as const, label: "Profiles", icon: UserRound },
  ];
  return (
    <nav className={`skills-section-nav ${railMenuSectionClass}`} aria-label="Skills workspace">
      <p className={`${railMenuLabelClass} skills-menu-label`}>Workspace</p>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Button variant="ghost" type="button" key={item.id} className="tw:h-10 tw:min-w-0 tw:w-full tw:justify-start tw:rounded-xl tw:px-3 tw:py-2 tw:text-sm tw:font-semibold tw:text-[var(--color-text-subtle)] tw:transition-colors tw:duration-150 tw:aria-[current=page]:bg-background tw:aria-[current=page]:text-foreground tw:hover:bg-[var(--color-surface-hover)]! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:h-11" aria-current={section === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
            <Icon className="tw:size-[19px] tw:text-current" />
            <span className="tw:min-w-0 tw:truncate">{item.label}</span>
          </Button>
        );
      })}
      <div className="tw:mx-[8px] tw:my-[16px] tw:flex tw:items-start tw:gap-[7px] tw:rounded-[9px] tw:bg-[var(--color-canvas)] tw:p-[10px] tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground tw:[@media(max-width:920px)]:hidden"><Boxes className="tw:w-[14px] tw:flex-none" />Compose reusable skills into launch profiles.</div>
    </nav>
  );
}
