import type { Skill } from "../../types/skills";

export type SkillTreeNode = { name: string; path: string; directories: SkillTreeNode[]; skills: Skill[] };

export function buildSkillTree(skills: Skill[]) {
  const root: SkillTreeNode = { name: "", path: "", directories: [], skills: [] };
  for (const skill of [...skills].sort((left, right) => (left.relativePath ?? left.slug).localeCompare(right.relativePath ?? right.slug))) {
    const parts = skill.relativePath === "." ? [] : (skill.relativePath?.split("/").filter(Boolean) ?? []);
    const relative = parts[0] === "skills" ? parts.slice(1) : parts;
    const directories = relative.slice(0, -1);
    let current = root;
    for (const directory of directories) {
      let next = current.directories.find((node) => node.name === directory);
      if (!next) {
        next = { name: directory, path: [...current.path.split("/").filter(Boolean), directory].join("/"), directories: [], skills: [] };
        current.directories.push(next);
      }
      current = next;
    }
    current.skills.push(skill);
  }
  const sort = (node: SkillTreeNode) => {
    node.directories.sort((left, right) => left.name.localeCompare(right.name));
    node.skills.sort((left, right) => left.slug.localeCompare(right.slug));
    node.directories.forEach(sort);
  };
  sort(root);
  return [root];
}

export function treeKeys(nodes: SkillTreeNode[], namespace: string): string[] {
  return nodes.flatMap((node) => [
    ...(node.path ? [`${namespace}:${node.path}`] : []),
    ...treeKeys(node.directories, namespace),
  ]);
}

export function setKeysCollapsed(current: Set<string>, keys: string[], collapsed: boolean) {
  const next = new Set(current);
  for (const key of keys) {
    if (collapsed) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function countNodeSkills(node: SkillTreeNode): number {
  return node.skills.length + node.directories.reduce((total, child) => total + countNodeSkills(child), 0);
}

export function toggleSet(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function symmetricDifferenceSize(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value)).length + [...right].filter((value) => !left.has(value)).length;
}
