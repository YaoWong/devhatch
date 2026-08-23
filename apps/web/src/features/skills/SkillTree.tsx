import { Check, ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import type { Skill } from "../../types";
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
    return (
      <div className={`skill-tree-node ${isRoot ? "root" : ""}`} key={key}>
        {!isRoot && (
          <button className="skill-tree-folder" style={{ paddingLeft: `${12 + depth * 18}px` }} type="button" aria-expanded={!isCollapsed} onClick={() => onToggle(key)}>
            {isCollapsed ? <ChevronRight /> : <ChevronDown />}<Folder /><strong>{node.name}</strong><span>{countNodeSkills(node)}</span>
          </button>
        )}
        {(isRoot || !isCollapsed) && (
          <div>
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
  return (
    <button className="repository-skill-row" style={{ paddingLeft: `${34 + depth * 18}px` }} type="button" onClick={() => onView?.(skill)}>
      <span><strong>{skill.slug}</strong><small>{skill.description || "No description"}</small></span>
      <span className="skill-row-meta"><code>{skill.relativePath ?? "."}</code><FileText /></span>
    </button>
  );
}

function SelectableSkill({ skill, selected, depth, onToggle }: { skill: Skill; selected: boolean; depth: number; onToggle: () => void }) {
  return (
    <label className="profile-skill-row" style={{ paddingLeft: `${34 + depth * 18}px` }}>
      <span><strong>{skill.slug}</strong><small>{skill.description || "No description"}</small></span>
      <input type="checkbox" checked={selected} onChange={onToggle} />
      <i>{selected && <Check />}</i>
    </label>
  );
}
