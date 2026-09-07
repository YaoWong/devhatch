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
      <form className="tw:mb-[20px] tw:grid tw:w-[min(56rem,100%)] tw:grid-cols-[minmax(280px,1fr)_minmax(160px,.42fr)_auto] tw:items-end tw:gap-[12px] tw:skills-max-860:grid-cols-1" onSubmit={(event) => void submit(event)}>
        <label className="tw:grid tw:min-w-0 tw:gap-[6px]">
          <span className="tw:flex tw:items-baseline tw:justify-between tw:gap-[8px] tw:text-sm tw:font-[650] tw:leading-[1.25] tw:text-[var(--color-text-subtle)]">Repository URL</span>
          <Input className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11" required type="text" placeholder="GitHub, HTTP(S), or git@host:path" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <label className="tw:grid tw:min-w-0 tw:gap-[6px]">
          <span className="tw:flex tw:items-baseline tw:justify-between tw:gap-[8px] tw:text-sm tw:font-[650] tw:leading-[1.25] tw:text-[var(--color-text-subtle)]">Branch or tag <small className="tw:text-[calc(10px*var(--app-font-scale))] tw:font-medium tw:text-muted-foreground">Optional</small></span>
          <Input className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11" placeholder="Default branch" value={gitRef} onChange={(event) => setGitRef(event.target.value)} />
        </label>
        <SkillsPrimaryButton className="tw:self-end" type="submit" disabled={controller.busy}><Plus />Add repository</SkillsPrimaryButton>
      </form>
      <div className="tw:grid tw:gap-[9px]">
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
            <Card role="article" className={`tw:block tw:gap-0 tw:rounded-[13px] tw:border tw:border-border tw:bg-card tw:py-0 tw:ring-0 ${isExpanded ? "tw:border-input" : ""}`} key={repository.id}>
               <div className="tw:flex tw:min-h-[72px] tw:min-w-0 tw:items-center tw:gap-[12px] tw:pt-[10px] tw:pr-[12px] tw:pb-[10px] tw:pl-[8px] tw:skills-max-860:flex-wrap tw:skills-max-860:items-start">
                  <Button variant="ghost" className="tw:grid tw:h-auto tw:min-h-12 tw:min-w-0 tw:flex-1 tw:grid-cols-[18px_20px_minmax(0,1fr)] tw:items-center tw:justify-start tw:rounded-lg tw:px-0 tw:py-0 tw:text-left tw:font-normal tw:whitespace-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50! tw:skills-max-860:w-full tw:skills-max-860:basis-full" type="button" aria-expanded={isExpanded} onClick={() => setExpanded((current) => toggleSet(current, repository.id))}>
                    <span className="tw:grid tw:place-items-center">{isExpanded ? <ChevronDown className="tw:size-[13px] tw:text-muted-foreground" /> : <ChevronRight className="tw:size-[13px] tw:text-muted-foreground" />}</span>
                    <FolderGit2 className="tw:size-[19px] tw:text-muted-foreground" />
                    <span className="tw:min-w-0">
                      <strong className="tw:block tw:overflow-hidden tw:text-sm tw:leading-[1.3] tw:text-ellipsis tw:whitespace-nowrap">{repository.name}</strong>
                      <small className="tw:mt-[4px] tw:block tw:overflow-hidden tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.3] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap" title={repository.url}>{repository.gitRef ?? "Default branch"} · {repositorySkills.length} skills · {repository.commitHash.slice(0, 10)}</small>
                    </span>
                  </Button>
                 <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-[6px] tw:skills-max-860:w-full tw:skills-max-860:pl-[47px] tw:skills-max-480:pl-0 tw:skills-max-480:[&>*]:flex-1 tw:skills-max-480:[&>.skills-icon-button]:flex-none">
                    <SkillsIconButton type="button" disabled={controller.busy || renaming === repository.id} aria-label={`Rename ${repository.name}`} onClick={() => setRenaming(repository.id)}><Pencil /></SkillsIconButton>
                    <SkillsSecondaryButton disabled={controller.busy || renaming === repository.id} onClick={() => void controller.previewSync(repository.id)}>Check updates</SkillsSecondaryButton>
                    <SkillsSecondaryButton disabled={controller.busy || renaming === repository.id} onClick={() => void controller.syncRepository(repository.id)}><RefreshCw />Sync</SkillsSecondaryButton>
                    <SkillsIconButton disabled={controller.busy || renaming === repository.id} className="tw:text-destructive tw:hover:bg-[var(--color-danger-soft)]! tw:hover:text-destructive!" aria-label={`Delete ${repository.name}`} onClick={() => onConfirm({ title: `Delete ${repository.name}?`, description: "This repository and all skills discovered from it will be removed.", confirmLabel: "Delete repository", danger: true, action: () => controller.deleteRepository(repository.id) })}><Trash2 /></SkillsIconButton>
                 </div>
              </div>
              {plan && (
                <div className={`tw:flex tw:justify-between tw:gap-[8px] tw:border-t tw:border-border tw:bg-[var(--color-accent-soft)] tw:px-[14px] tw:py-[10px] tw:text-xs tw:leading-[1.35] tw:text-[var(--color-text-subtle)] tw:skills-max-860:flex-wrap ${plan.noop ? "tw:bg-[var(--color-success-soft)]" : ""}`}>
                  <strong>{plan.noop ? "Up to date" : "Updates available"}</strong>
                  <span>{plan.add.length} new · {plan.update.length} changed · {plan.remove.length} removed</span>
                </div>
              )}
              {isExpanded && (
                <div className="tw:border-t tw:border-border tw:bg-[var(--color-surface-raised)] tw:pt-[12px] tw:pr-[14px] tw:pb-[14px] tw:pl-[14px] tw:skills-max-480:px-0">
                  <div className="tw:mb-[8px] tw:flex tw:items-center tw:gap-[10px] tw:skills-max-860:flex-col tw:skills-max-860:items-stretch tw:skills-max-480:px-[10px]">
                    <SearchField className="tw:w-[min(460px,100%)] tw:flex-1 tw:skills-max-860:w-full" value={query} placeholder={`Search ${repositorySkills.length} skills`} onChange={(value) => setQueries((current) => ({ ...current, [repository.id]: value }))} />
                    <TreeControls
                      allCollapsed={allCollapsed}
                      disabled={!collapsibleKeys.length || Boolean(query.trim())}
                      onToggle={() => setCollapsed((current) => setKeysCollapsed(current, collapsibleKeys, !allCollapsed))}
                    />
                  </div>
                  <div className="tw:border-b tw:border-border">
                    <SkillTree nodes={tree} collapsed={effectiveCollapsed} namespace={repository.id} onToggle={query.trim() ? () => undefined : (key) => setCollapsed((current) => toggleSet(current, key))} onViewSkill={setViewer} />
                    {!filtered.length && <div className="tw:px-[14px] tw:py-[16px] tw:text-center tw:text-xs tw:leading-[1.4] tw:text-muted-foreground">{repositorySkills.length ? "No skills match your search." : "No skills discovered in this repository."}</div>}
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
