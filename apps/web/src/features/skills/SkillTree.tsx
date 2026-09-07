import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Skill } from "../../types/skills";
import { countNodeSkills, type SkillTreeNode } from "./treeUtils";

export function SkillTree({ nodes, collapsed, namespace, onToggle, selected, onToggleSkill, onViewSkill, depth = 0 }: {
  nodes: SkillTreeNode[];
  collapsed: Set<string>;
  namespace: string;
  onToggle: (key: string) => void;
  selected?: Set<string>;
  onToggleSkill?: (id: string) => void;
  onViewSkill?: (skill: Skill) => void;
  depth?: number;
}) {
  return <>{nodes.map((node) => {
    const key = `${namespace}:${node.path || "root"}`;
    const isRoot = !node.path;
    const isCollapsed = collapsed.has(key);
    const indentation = 12 + Math.min(depth, 6) * 18;
    return (
      <div className={`skill-tree-node ${isRoot ? "root" : ""}`} key={key}>
        {!isRoot && (
          <Button variant="ghost" className="skill-tree-folder tw:grid tw:h-10 tw:w-full tw:grid-cols-[14px_16px_minmax(0,1fr)_auto] tw:items-center tw:justify-start tw:gap-[7px] tw:rounded-none tw:border-t tw:border-border tw:bg-[var(--color-surface-raised)] tw:pr-3 tw:text-left tw:font-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50! tw:[@media(pointer:coarse)]:h-11" style={{ paddingLeft: `${indentation}px` }} type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(key)}>
            {isCollapsed ? <ChevronRight className="tw:size-[13px] tw:text-muted-foreground" /> : <ChevronDown className="tw:size-[13px] tw:text-muted-foreground" />}<Folder className="tw:size-[13px] tw:text-[var(--color-accent)]" /><strong className="tw:overflow-hidden tw:text-sm tw:leading-[1.3] tw:text-ellipsis tw:whitespace-nowrap">{node.name}</strong><span className="tw:min-w-[24px] tw:rounded-[99px] tw:bg-muted tw:px-[6px] tw:py-[2px] tw:text-center tw:text-[calc(11px*var(--app-font-scale))] tw:text-[var(--color-text-subtle)]">{countNodeSkills(node)}</span>
          </Button>
        )}
        {(isRoot || !isCollapsed) && (
          <div className="skill-tree-children">
            {node.skills.map((skill) => selected && onToggleSkill
              ? <SelectableSkill key={skill.id} skill={skill} selected={selected.has(skill.id)} depth={depth + (isRoot ? 0 : 1)} onToggle={() => onToggleSkill(skill.id)} />
              : <RepositorySkill key={skill.id} skill={skill} depth={depth + (isRoot ? 0 : 1)} onView={onViewSkill} />)}
            <SkillTree nodes={node.directories} collapsed={collapsed} namespace={namespace} onToggle={onToggle} selected={selected} onToggleSkill={onToggleSkill} onViewSkill={onViewSkill} depth={depth + (isRoot ? 0 : 1)} />
          </div>
        )}
      </div>
    );
  })}</>;
}

function RepositorySkill({ skill, depth, onView }: { skill: Skill; depth: number; onView?: (skill: Skill) => void }) {
  const indentation = 34 + Math.min(depth, 5) * 18;
  return (
    <Button variant="ghost" className="tw:grid tw:h-auto tw:min-h-[52px] tw:w-full tw:grid-cols-[minmax(0,1fr)_minmax(80px,auto)] tw:items-center tw:justify-start tw:gap-[10px] tw:rounded-none tw:border-t tw:border-border tw:bg-card tw:pr-3.5 tw:py-2 tw:text-left tw:font-normal tw:whitespace-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50! tw:[@media(pointer:coarse)]:min-h-14 tw:skills-max-480:grid-cols-[minmax(0,1fr)]" style={{ paddingLeft: `${indentation}px` }} type="button" aria-haspopup="dialog" onClick={() => onView?.(skill)}>
      <span className="tw:min-w-0"><strong className="tw:block tw:text-sm tw:leading-[1.3]">{skill.slug}</strong><small className="tw:mt-[3px] tw:block tw:overflow-hidden tw:text-xs tw:leading-[1.35] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">{skill.description || "No description"}</small></span>
      <span className="tw:flex tw:min-w-0 tw:items-center tw:justify-end tw:gap-[8px]"><code className="tw:max-w-[260px] tw:overflow-hidden tw:text-[calc(11px*var(--app-font-scale))] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap tw:skills-max-480:hidden">{skill.relativePath ?? "."}</code><FileText className="tw:size-[14px] tw:text-muted-foreground" /></span>
    </Button>
  );
}

function SelectableSkill({ skill, selected, depth, onToggle }: { skill: Skill; selected: boolean; depth: number; onToggle: () => void }) {
  const indentation = 34 + Math.min(depth, 5) * 18;
  return (
    <label className="profile-skill-row tw:relative tw:grid tw:min-h-[56px] tw:grid-cols-[minmax(0,1fr)_24px] tw:items-center tw:gap-[12px] tw:border-t tw:border-border tw:py-[8px] tw:pr-[12px] tw:hover:bg-[var(--color-surface-hover)] tw:focus-within:outline-[2px] tw:focus-within:outline-[color-mix(in_srgb,var(--color-accent)_36%,transparent)] tw:focus-within:outline-offset-[-2px]" style={{ paddingLeft: `${indentation}px` }}>
      <span className="tw:min-w-0"><strong className="tw:block tw:text-sm tw:leading-[1.3]">{skill.slug}</strong><small className="tw:mt-[3px] tw:block tw:overflow-hidden tw:text-xs tw:leading-[1.35] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">{skill.description || "No description"}</small></span>
      <Checkbox className="tw:[@media(pointer:coarse)]:after:-inset-3" checked={selected} onCheckedChange={onToggle} />
    </label>
  );
}
