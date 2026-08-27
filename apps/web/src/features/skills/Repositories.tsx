import { ChevronDown, ChevronRight, FolderGit2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Skill } from "../../types/skills";
import type { SkillsController } from "./controller";
import { Empty, SearchField, TreeControls, WorkspaceSection } from "./controls";
import { filterSkills } from "./search";
import { SkillManifestDialog } from "./SkillManifestDialog";
import { SkillTree } from "./SkillTree";
import { buildSkillTree, setKeysCollapsed, toggleSet, treeKeys } from "./treeUtils";

export function Repositories({ controller }: { controller: SkillsController }) {
  const [url, setUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [viewer, setViewer] = useState<Skill | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await controller.addRepository(url.trim(), gitRef.trim())) {
      setUrl("");
      setGitRef("");
    }
  };
  const saveName = async (id: string) => {
    if (await controller.renameRepository(id, name.trim())) setRenaming(null);
  };
  return (
    <WorkspaceSection title="Repositories" description="Connect Git sources, inspect discovered skills, and keep them synchronized.">
      <form className="skills-form repository-form" onSubmit={(event) => void submit(event)}>
        <input required type="text" placeholder="GitHub, HTTP(S), or git@host:path" value={url} onChange={(event) => setUrl(event.target.value)} />
        <input placeholder="Branch or tag (optional)" value={gitRef} onChange={(event) => setGitRef(event.target.value)} />
        <button className="skills-primary" disabled={controller.busy}><Plus />Add repository</button>
      </form>
      <div className="repository-list">
        {controller.repositories.map((repository) => {
          const repositorySkills = controller.skills.filter((skill) => skill.repositoryId === repository.id);
          const isExpanded = expanded.has(repository.id);
          const query = queries[repository.id] ?? "";
          const filtered = filterSkills(repositorySkills, query, "all");
          const plan = controller.syncPlan?.repositoryId === repository.id ? controller.syncPlan : null;
          return (
            <article className={`repository-card ${isExpanded ? "expanded" : ""}`} key={repository.id}>
              <div className="repository-card-header">
                <button className="repository-summary" type="button" aria-expanded={isExpanded} onClick={() => setExpanded((current) => toggleSet(current, repository.id))}>
                  <span className="repository-disclosure">{isExpanded ? <ChevronDown /> : <ChevronRight />}</span>
                  <FolderGit2 />
                  <span>
                    <strong>{repository.name}</strong>
                    <small title={repository.url}>{repository.gitRef ?? "Default branch"} · {repositorySkills.length} skills · {repository.commitHash.slice(0, 10)}</small>
                  </span>
                </button>
                <div className="repository-actions">
                  <button className="skills-icon-button" type="button" aria-label={`Rename ${repository.name}`} onClick={() => { setRenaming(repository.id); setName(repository.name); }}><Pencil /></button>
                  <button className="skills-button quiet" disabled={controller.busy} onClick={() => void controller.previewSync(repository.id)}>Check updates</button>
                  <button className="skills-button" disabled={controller.busy} onClick={() => void controller.syncRepository(repository.id)}><RefreshCw />Sync</button>
                  <button disabled={controller.busy} className="skills-icon-button danger" aria-label="Delete repository" onClick={() => void controller.deleteRepository(repository.id)}><Trash2 /></button>
                </div>
              </div>
              {renaming === repository.id && (
                <form className="repository-rename" onSubmit={(event) => { event.preventDefault(); void saveName(repository.id); }}>
                  <input autoFocus required maxLength={2048} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setRenaming(null); }} />
                  <button className="skills-button quiet" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  <button className="skills-primary" disabled={controller.busy || !name.trim() || name.trim() === repository.name}>Save name</button>
                </form>
              )}
              {plan && (
                <div className={`repository-sync-result ${plan.noop ? "current" : "changed"}`}>
                  <strong>{plan.noop ? "Up to date" : "Updates available"}</strong>
                  <span>{plan.add.length} new · {plan.update.length} changed · {plan.remove.length} removed</span>
                </div>
              )}
              {isExpanded && (
                <div className="repository-browser">
                  <div className="skill-tree-toolbar">
                    <SearchField value={query} placeholder={`Search ${repositorySkills.length} skills`} onChange={(value) => setQueries((current) => ({ ...current, [repository.id]: value }))} />
                    <TreeControls
                      onExpand={() => setCollapsed((current) => setKeysCollapsed(current, treeKeys(buildSkillTree(filtered), repository.id), false))}
                      onCollapse={() => setCollapsed((current) => setKeysCollapsed(current, treeKeys(buildSkillTree(filtered), repository.id), true))}
                    />
                  </div>
                  <div className="skill-tree-shell">
                    <SkillTree nodes={buildSkillTree(filtered)} collapsed={collapsed} namespace={repository.id} onToggle={(key) => setCollapsed((current) => toggleSet(current, key))} onViewSkill={setViewer} />
                    {!filtered.length && <div className="repository-no-skills">{repositorySkills.length ? "No skills match your search." : "No skills discovered in this repository."}</div>}
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {!controller.repositories.length && <Empty text="No repositories added." />}
      </div>
      {viewer && <SkillManifestDialog skill={viewer} onClose={() => setViewer(null)} />}
    </WorkspaceSection>
  );
}
