import { BookOpen, Boxes, FolderGit2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SkillsSection = "repositories" | "skills" | "profiles";

export function SkillsRailPage({ section, onSelect }: { section: SkillsSection; onSelect: (section: SkillsSection) => void }) {
  const items = [
    { id: "repositories" as const, label: "Repositories", icon: FolderGit2 },
    { id: "skills" as const, label: "Skill library", icon: BookOpen },
    { id: "profiles" as const, label: "Profiles", icon: UserRound },
  ];
  return (
    <nav className="menu-section" aria-label="Skills workspace">
      <p className="menu-label">Workspace</p>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Button variant="ghost" type="button" key={item.id} className={`settings-nav-item tw:min-h-11 tw:w-full tw:justify-start tw:rounded-xl tw:px-3 tw:py-2 tw:text-[calc(13px*var(--app-font-scale))] tw:font-semibold tw:transition-none tw:hover:bg-[var(--color-surface-hover)]! tw:hover:text-foreground! ${section === item.id ? "active tw:bg-background" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
            <Icon />
            <span>{item.label}</span>
          </Button>
        );
      })}
      <div className="skills-rail-note"><Boxes />Compose reusable skills into launch profiles.</div>
    </nav>
  );
}
