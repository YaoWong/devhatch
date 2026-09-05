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
          <Button variant="ghost" className="skill-tree-folder tw:grid tw:h-10 tw:w-full tw:grid-cols-[14px_16px_minmax(0,1fr)_auto] tw:justify-start tw:rounded-none tw:bg-[var(--color-surface-raised)] tw:pr-3 tw:text-left tw:font-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50! tw:[@media(pointer:coarse)]:h-11" style={{ paddingLeft: `${indentation}px` }} type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(key)}>
            {isCollapsed ? <ChevronRight className="tw:size-[13px]" /> : <ChevronDown className="tw:size-[13px]" />}<Folder className="tw:size-[13px]" /><strong>{node.name}</strong><span>{countNodeSkills(node)}</span>
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
    <Button variant="ghost" className="repository-skill-row tw:grid tw:h-auto tw:min-h-[52px] tw:w-full tw:justify-start tw:rounded-none tw:bg-card tw:pr-3.5 tw:py-2 tw:text-left tw:font-normal tw:whitespace-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50! tw:[@media(pointer:coarse)]:min-h-14" style={{ paddingLeft: `${indentation}px` }} type="button" aria-haspopup="dialog" onClick={() => onView?.(skill)}>
      <span><strong>{skill.slug}</strong><small>{skill.description || "No description"}</small></span>
      <span className="skill-row-meta"><code>{skill.relativePath ?? "."}</code><FileText className="tw:size-3.5" /></span>
    </Button>
  );
}

function SelectableSkill({ skill, selected, depth, onToggle }: { skill: Skill; selected: boolean; depth: number; onToggle: () => void }) {
  const indentation = 34 + Math.min(depth, 5) * 18;
  return (
    <label className="profile-skill-row" style={{ paddingLeft: `${indentation}px` }}>
      <span><strong>{skill.slug}</strong><small>{skill.description || "No description"}</small></span>
      <Checkbox className="tw:[@media(pointer:coarse)]:after:-inset-3" checked={selected} onCheckedChange={onToggle} />
    </label>
  );
}
