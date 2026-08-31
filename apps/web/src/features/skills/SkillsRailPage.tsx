import { BookOpen, Boxes, FolderGit2, UserRound } from "lucide-react";

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
          <button type="button" key={item.id} className={`settings-nav-item ${section === item.id ? "active" : ""}`} aria-current={section === item.id ? "page" : undefined} onClick={() => onSelect(item.id)}>
            <Icon />
            <span>{item.label}</span>
          </button>
        );
      })}
      <div className="skills-rail-note"><Boxes />Compose reusable skills into launch profiles.</div>
    </nav>
  );
}
