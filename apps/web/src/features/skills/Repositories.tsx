import { ChevronDown, ChevronRight, FolderGit2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RenameDialog } from "../../shared/ui/RenameDialog";
import type { ConfirmAction } from "../../types/app";
import type { Skill } from "../../types/skills";
import type { SkillsController } from "./controller";
import { Empty, SearchField, SkillsIconButton, SkillsPrimaryButton, SkillsSecondaryButton, TreeControls, WorkspaceSection } from "./controls";
import { filterSkills } from "./search";
import { SkillManifestDialog } from "./SkillManifestDialog";
import { SkillTree } from "./SkillTree";
import { buildSkillTree, setKeysCollapsed, toggleSet, treeKeys } from "./treeUtils";

export function Repositories({ controller, onConfirm }: { controller: SkillsController; onConfirm: (action: ConfirmAction) => void }) {
  const [url, setUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [viewer, setViewer] = useState<Skill | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
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
  return (
    <WorkspaceSection title="Repositories" description="Connect Git sources, inspect discovered skills, and keep them synchronized.">
      <form className="skills-form repository-form" onSubmit={(event) => void submit(event)}>
        <label className="skills-form-field">
          <span>Repository URL</span>
          <Input className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11" required type="text" placeholder="GitHub, HTTP(S), or git@host:path" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="skills-form-field">
          <span>Branch or tag <small>Optional</small></span>
          <Input className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11" placeholder="Default branch" value={gitRef} onChange={(event) => setGitRef(event.target.value)} />
        </label>
        <SkillsPrimaryButton className="tw:self-end" type="submit" disabled={controller.busy}><Plus />Add repository</SkillsPrimaryButton>
      </form>
      <div className="repository-list">
        {controller.repositories.map((repository) => {
          const repositorySkills = controller.skills.filter((skill) => skill.repositoryId === repository.id);
          const isExpanded = expanded.has(repository.id);
          const query = queries[repository.id] ?? "";
          const filtered = filterSkills(repositorySkills, query, "all");
          const tree = buildSkillTree(filtered);
          const collapsibleKeys = treeKeys(tree, repository.id);
          const effectiveCollapsed = query.trim() ? new Set<string>() : collapsed;
          const allCollapsed = collapsibleKeys.length > 0 && collapsibleKeys.every((key) => effectiveCollapsed.has(key));
          const plan = controller.syncPlan?.repositoryId === repository.id ? controller.syncPlan : null;
          return (
            <Card role="article" className={`repository-card tw:block tw:gap-0 tw:rounded-[13px] tw:border tw:border-border tw:bg-card tw:py-0 tw:ring-0 ${isExpanded ? "expanded tw:border-input" : ""}`} key={repository.id}>
               <div className="repository-card-header">
                  <Button variant="ghost" className="repository-summary tw:grid tw:h-auto tw:min-h-12 tw:min-w-0 tw:flex-1 tw:grid-cols-[18px_20px_minmax(0,1fr)] tw:justify-start tw:rounded-lg tw:px-0 tw:py-0 tw:text-left tw:font-normal tw:whitespace-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50!" type="button" aria-expanded={isExpanded} onClick={() => setExpanded((current) => toggleSet(current, repository.id))}>
                    <span className="repository-disclosure">{isExpanded ? <ChevronDown className="tw:size-[13px]" /> : <ChevronRight className="tw:size-[13px]" />}</span>
                    <FolderGit2 className="tw:size-[19px]" />
                    <span>
                      <strong>{repository.name}</strong>
                      <small title={repository.url}>{repository.gitRef ?? "Default branch"} · {repositorySkills.length} skills · {repository.commitHash.slice(0, 10)}</small>
                    </span>
                  </Button>
                 <div className="repository-actions">
                    <SkillsIconButton type="button" disabled={controller.busy || renaming === repository.id} aria-label={`Rename ${repository.name}`} onClick={() => setRenaming(repository.id)}><Pencil /></SkillsIconButton>
                    <SkillsSecondaryButton disabled={controller.busy || renaming === repository.id} onClick={() => void controller.previewSync(repository.id)}>Check updates</SkillsSecondaryButton>
                    <SkillsSecondaryButton disabled={controller.busy || renaming === repository.id} onClick={() => void controller.syncRepository(repository.id)}><RefreshCw />Sync</SkillsSecondaryButton>
                    <SkillsIconButton disabled={controller.busy || renaming === repository.id} className="danger tw:text-destructive tw:hover:bg-[var(--color-danger-soft)]! tw:hover:text-destructive!" aria-label={`Delete ${repository.name}`} onClick={() => onConfirm({ title: `Delete ${repository.name}?`, description: "This repository and all skills discovered from it will be removed.", confirmLabel: "Delete repository", danger: true, action: () => controller.deleteRepository(repository.id) })}><Trash2 /></SkillsIconButton>
                 </div>
              </div>
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
                      allCollapsed={allCollapsed}
                      disabled={!collapsibleKeys.length || Boolean(query.trim())}
                      onToggle={() => setCollapsed((current) => setKeysCollapsed(current, collapsibleKeys, !allCollapsed))}
                    />
                  </div>
                  <div className="skill-tree-list">
                    <SkillTree nodes={tree} collapsed={effectiveCollapsed} namespace={repository.id} onToggle={query.trim() ? () => undefined : (key) => setCollapsed((current) => toggleSet(current, key))} onViewSkill={setViewer} />
                    {!filtered.length && <div className="repository-no-skills">{repositorySkills.length ? "No skills match your search." : "No skills discovered in this repository."}</div>}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
        {!controller.repositories.length && <Empty text="No repositories added." />}
      </div>
      {renaming && (() => {
        const repository = controller.repositories.find((item) => item.id === renaming);
        if (!repository) return null;
        return <RenameDialog initialValue={repository.name} label="repository" maxLength={2048} onSubmit={(name) => controller.renameRepository(repository.id, name)} onClose={() => setRenaming(null)} />;
      })()}
      {viewer && <SkillManifestDialog skill={viewer} onClose={() => setViewer(null)} />}
    </WorkspaceSection>
  );
}
