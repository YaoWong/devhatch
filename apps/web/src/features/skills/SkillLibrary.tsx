import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import type { Skill } from "../../types/skills";
import type { SkillsController } from "./controller";
import { Empty, SearchField, SourceFilterControl, WorkspaceSection } from "./controls";
import { filterSkills, type SourceFilter } from "./search";
import { SkillManifestDialog } from "./SkillManifestDialog";

export function SkillLibrary({ controller }: { controller: SkillsController }) {
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
        <button className="skills-primary" type="button" onClick={() => setCreating((value) => !value)}><Plus />New skill</button>
      </div>
      {creating && (
        <form className="skills-form create-skill-form" onSubmit={(event) => void submit(event)}>
          <input required placeholder="skill-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
          <input required maxLength={1024} placeholder="When should an agent use this skill?" value={description} onChange={(event) => setDescription(event.target.value)} />
          <div>
            <button className="skills-button quiet" type="button" onClick={() => setCreating(false)}>Cancel</button>
            <button className="skills-primary" disabled={controller.busy}>Create</button>
          </div>
        </form>
      )}
      <div className="skill-library-summary"><strong>{filtered.length}</strong><span>skills shown</span></div>
      <div className="skills-grid two-column">
        {filtered.map((skill) => (
          <article className="skill-card" key={skill.id}>
            <div className={`skill-source ${skill.sourceType}`}>{skill.sourceType === "custom" ? "Mine" : "Git"}</div>
            <div className={`skill-card-copy ${viewer?.id === skill.id ? "viewing" : ""}`} role="button" tabIndex={0} onClick={() => setViewer(skill)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setViewer(skill); }}><strong>{skill.slug}</strong><small>{skill.description || "No description"}</small></div>
            {skill.sourceType === "custom" && <button className="skills-icon-button danger" aria-label={`Delete ${skill.slug}`} onClick={() => void controller.deleteSkill(skill.id)}><Trash2 /></button>}
          </article>
        ))}
        {!filtered.length && <Empty text={controller.skills.length ? "No skills match these filters." : "No skills available."} />}
      </div>
      {viewer && <SkillManifestDialog skill={viewer} onClose={() => setViewer(null)} />}
    </WorkspaceSection>
  );
}
