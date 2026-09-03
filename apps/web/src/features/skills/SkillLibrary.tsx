import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ConfirmAction } from "../../types/app";
import type { Skill } from "../../types/skills";
import type { SkillsController } from "./controller";
import { Empty, SearchField, SourceFilterControl, WorkspaceSection } from "./controls";
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
    <WorkspaceSection title="Skills" description="Browse every available skill or create reusable instructions of your own.">
      <div className="skills-toolbar">
        <SearchField value={query} placeholder={`Search ${controller.skills.length} skills`} onChange={setQuery} />
        <SourceFilterControl value={source} onChange={setSource} />
        <Button className="skills-primary tw:h-10 tw:rounded-[9px] tw:bg-foreground tw:px-3.5 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-foreground! tw:[@media(pointer:coarse)]:h-11" type="button" aria-expanded={creating} onClick={() => setCreating((value) => !value)}><Plus />New skill</Button>
      </div>
      {creating && (
        <form className="skills-form create-skill-form" onSubmit={(event) => void submit(event)}>
          <Input className="tw:h-10 tw:text-sm" required aria-label="Skill slug" placeholder="skill-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
          <Input className="tw:h-10 tw:text-sm" required maxLength={1024} aria-label="Skill description" placeholder="When should an agent use this skill?" value={description} onChange={(event) => setDescription(event.target.value)} />
          <div>
            <Button variant="secondary" className="skills-button quiet tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" onClick={() => setCreating(false)}>Cancel</Button>
            <Button className="skills-primary tw:h-10 tw:bg-foreground tw:px-3 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-foreground! tw:[@media(pointer:coarse)]:h-11" type="submit" disabled={controller.busy}>Create</Button>
          </div>
        </form>
      )}
      <div className="skill-library-summary"><strong>{filtered.length}</strong><span>skills shown</span></div>
      <div className="skills-grid two-column">
        {filtered.map((skill) => (
          <Card role="article" className="skill-card tw:flex-row tw:gap-3 tw:rounded-[13px] tw:border tw:border-border tw:bg-card tw:px-3.5 tw:py-3 tw:ring-0" key={skill.id}>
            <div className={`skill-source ${skill.sourceType}`}>{skill.sourceType === "custom" ? "Mine" : "Git"}</div>
            <Button variant="ghost" className="skill-card-copy tw:h-auto tw:min-w-0 tw:flex-1 tw:justify-start tw:rounded-lg tw:px-2 tw:py-1 tw:text-left tw:font-normal tw:whitespace-normal tw:hover:bg-muted/60!" aria-haspopup="dialog" onClick={() => setViewer(skill)}><span><strong>{skill.slug}</strong><small>{skill.description || "No description"}</small></span></Button>
            {skill.sourceType === "custom" && <Button variant="ghost" size="icon" disabled={controller.busy} className="skills-icon-button danger tw:size-10 tw:rounded-[9px] tw:text-destructive tw:hover:bg-[var(--color-danger-soft)]! tw:hover:text-destructive! tw:[@media(pointer:coarse)]:size-11" aria-label={`Delete ${skill.slug}`} onClick={() => onConfirm({ title: `Delete ${skill.slug}?`, description: "This custom skill and its reusable instructions will be permanently deleted.", confirmLabel: "Delete skill", danger: true, action: async () => { await controller.deleteSkill(skill.id); return true; } })}><Trash2 /></Button>}
          </Card>
        ))}
        {!filtered.length && <Empty text={controller.skills.length ? "No skills match these filters." : "No skills available."} />}
      </div>
      {viewer && <SkillManifestDialog skill={viewer} onClose={() => setViewer(null)} />}
    </WorkspaceSection>
  );
}
