import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ConfirmAction } from "../../types/app";
import type { Skill } from "../../types/skills";
import type { SkillsController } from "./controller";
import { Empty, SearchField, SkillsIconButton, SkillsPrimaryButton, SkillsSecondaryButton, SourceFilterControl, WorkspaceSection } from "./controls";
import { filterSkills, type SourceFilter } from "./search";
import { SkillManifestDialog } from "./SkillManifestDialog";

export function SkillLibrary({ controller, onConfirm }: { controller: SkillsController; onConfirm: (action: ConfirmAction) => void }) {
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceFilter>("all");
  const [creating, setCreating] = useState(false);
  const [viewer, setViewer] = useState<Skill | null>(null);
  const filtered = useMemo(() => filterSkills(controller.skills, query, source), [controller.skills, query, source]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await controller.createSkill(slug.trim(), description.trim())) {
      setSlug("");
      setDescription("");
      setCreating(false);
    }
  };
  return (
    <WorkspaceSection title="Skill library" description="Browse every available skill or create reusable instructions of your own.">
      <div className="tw:mb-[12px] tw:grid tw:grid-cols-[minmax(280px,1fr)_auto_auto] tw:items-center tw:gap-[10px] tw:skills-max-860:grid-cols-[minmax(0,1fr)_auto] tw:skills-max-480:grid-cols-1">
        <SearchField className="tw:skills-max-860:col-span-full" value={query} placeholder={`Search ${controller.skills.length} skills`} onChange={setQuery} />
        <SourceFilterControl value={source} onChange={setSource} />
        <SkillsPrimaryButton className="tw:skills-max-480:w-full" type="button" aria-expanded={creating} onClick={() => setCreating((value) => !value)}><Plus />New skill</SkillsPrimaryButton>
      </div>
      {creating && (
        <form className="tw:mb-[20px] tw:grid tw:w-[min(56rem,100%)] tw:grid-cols-[minmax(180px,.5fr)_minmax(280px,1fr)] tw:items-end tw:gap-[12px] tw:skills-max-860:grid-cols-1" onSubmit={(event) => void submit(event)}>
          <label className="tw:grid tw:min-w-0 tw:gap-[6px]">
            <span className="tw:flex tw:items-baseline tw:justify-between tw:gap-[8px] tw:text-sm tw:font-[650] tw:leading-[1.25] tw:text-[var(--color-text-subtle)]">Slug</span>
            <Input className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11" required maxLength={64} placeholder="skill-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
          </label>
          <label className="tw:grid tw:min-w-0 tw:gap-[6px]">
            <span className="tw:flex tw:items-baseline tw:justify-between tw:gap-[8px] tw:text-sm tw:font-[650] tw:leading-[1.25] tw:text-[var(--color-text-subtle)]">Description</span>
            <Textarea className="tw:min-h-20 tw:max-h-[160px] tw:resize-y tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:min-h-20" required maxLength={1024} rows={3} placeholder="When should an agent use this skill?" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="tw:col-span-full tw:flex tw:justify-end tw:gap-[8px] tw:skills-max-480:[&>*]:flex-1">
            <SkillsSecondaryButton type="button" onClick={() => setCreating(false)}>Cancel</SkillsSecondaryButton>
            <SkillsPrimaryButton type="submit" disabled={controller.busy}>Create</SkillsPrimaryButton>
          </div>
        </form>
      )}
      <div className="tw:mt-0 tw:mr-[2px] tw:mb-[8px] tw:ml-[2px] tw:flex tw:items-baseline tw:gap-[5px] tw:text-xs tw:leading-[1.3] tw:text-muted-foreground"><strong className="tw:text-[calc(13px*var(--app-font-scale))] tw:text-foreground">{filtered.length}</strong><span>skills shown</span></div>
      <div className="tw:grid tw:grid-cols-2 tw:gap-[8px] tw:skills-max-860:grid-cols-1">
        {filtered.map((skill) => (
          <Card role="article" className="tw:min-h-[76px] tw:min-w-0 tw:flex-row tw:items-center tw:gap-3 tw:rounded-[13px] tw:border tw:border-border tw:bg-card tw:px-3.5 tw:py-3 tw:ring-0 tw:transition-[background-color,border-color,box-shadow] tw:duration-150 tw:hover:border-input tw:hover:bg-muted/30 tw:hover:shadow-[0_3px_12px_rgb(0_0_0/5%)] tw:focus-within:border-input tw:focus-within:bg-muted/30 tw:focus-within:shadow-[0_3px_12px_rgb(0_0_0/5%)]" key={skill.id}>
            <div className={`tw:flex-none tw:rounded-[99px] tw:px-[7px] tw:py-[4px] tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.2] tw:text-[var(--color-text-subtle)] tw:uppercase ${skill.sourceType === "custom" ? "tw:bg-[var(--color-success-soft)]" : "tw:bg-muted"}`}>{skill.sourceType === "custom" ? "Mine" : "Git"}</div>
            <Button variant="ghost" className="tw:h-auto tw:min-w-0 tw:flex-1 tw:justify-start tw:rounded-none tw:px-0 tw:py-1 tw:text-left tw:font-normal tw:whitespace-normal tw:hover:bg-transparent!" aria-haspopup="dialog" onClick={() => setViewer(skill)}><span className="tw:w-full tw:min-w-0"><strong className="tw:block tw:overflow-hidden tw:text-sm tw:leading-[1.3] tw:text-ellipsis tw:whitespace-nowrap tw:group-hover/button:underline tw:group-hover/button:underline-offset-2">{skill.slug}</strong><small className="tw:mt-[4px] tw:block tw:overflow-hidden tw:text-xs tw:leading-[1.35] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">{skill.description || "No description"}</small></span></Button>
            {skill.sourceType === "custom" && <SkillsIconButton disabled={controller.busy} className="danger tw:text-destructive tw:hover:bg-[var(--color-danger-soft)]! tw:hover:text-destructive!" aria-label={`Delete ${skill.slug}`} onClick={() => onConfirm({ title: `Delete ${skill.slug}?`, description: "This custom skill and its reusable instructions will be permanently deleted.", confirmLabel: "Delete skill", danger: true, action: () => controller.deleteSkill(skill.id) })}><Trash2 /></SkillsIconButton>}
          </Card>
        ))}
        {!filtered.length && <Empty text={controller.skills.length ? "No skills match these filters." : "No skills available."} />}
      </div>
      {viewer && <SkillManifestDialog skill={viewer} onClose={() => setViewer(null)} />}
    </WorkspaceSection>
  );
}
