import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderGit2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { getSkillManifest } from "../api";
import type { useSkillsWorkspace } from "../controllers/useSkillsWorkspace";
import type { Skill } from "../types";
import type { SkillsSection } from "./SkillsRailPage";

type SkillsController = ReturnType<typeof useSkillsWorkspace>;
type SourceFilter = "all" | "custom" | "repository";
type SkillTreeNode = { name: string; path: string; directories: SkillTreeNode[]; skills: Skill[] };

export function SkillsWorkspace({ section, controller, error, onDismissError }: {
  section: SkillsSection;
  controller: SkillsController;
  error: string | null;
  onDismissError: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: true, bottom: false });
  const updateScrollEdges = (element: HTMLDivElement) => setScrollEdges({
    top: element.scrollTop <= 1,
    bottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
  });
  const scrollTo = (edge: "top" | "bottom") => {
    const element = scrollRef.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: edge === "top" ? 0 : element.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  };
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => updateScrollEdges(element);
    update();
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [section]);
  return (
    <div className="skills-workspace" ref={scrollRef} onScroll={(event: UIEvent<HTMLDivElement>) => updateScrollEdges(event.currentTarget)}>
      {controller.busy && <LoaderCircle className="skills-spinner spin" />}
      {section === "repositories" && <Repositories controller={controller} />}
      {section === "skills" && <SkillLibrary controller={controller} />}
      {section === "profiles" && <Profiles controller={controller} />}
      {error && <div className={`error-banner ${section === "profiles" ? "skills-error-top" : ""}`}>{error}<button aria-label="Dismiss" onClick={onDismissError}>×</button></div>}
      <div className="skills-scroll-controls" aria-label="Page navigation">
        <button type="button" aria-label="Scroll to top" title="Scroll to top" disabled={scrollEdges.top} onClick={() => scrollTo("top")}><ArrowUpToLine /></button>
        <button type="button" aria-label="Scroll to bottom" title="Scroll to bottom" disabled={scrollEdges.bottom} onClick={() => scrollTo("bottom")}><ArrowDownToLine /></button>
      </div>
    </div>
  );
}

function Repositories({ controller }: { controller: SkillsController }) {
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

function SkillLibrary({ controller }: { controller: SkillsController }) {
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

function Profiles({ controller }: { controller: SkillsController }) {
  const [slug, setSlug] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set(controller.profileDetail?.skills.map((skill) => skill.id) ?? []);
    setDraft(next);
    setSaved(new Set(next));
  }, [controller.profileDetail]);
  const dirty = !sameSet(draft, saved);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await controller.createProfile(slug.trim())) setSlug("");
  };
  const save = async () => {
    if (await controller.saveProfile([...draft])) setSaved(new Set(draft));
  };
  const filtered = filterSkills(controller.skills, query, "all");
  const customSkills = filtered.filter((skill) => skill.sourceType === "custom");
  const visibleSources = [
    ...(customSkills.length ? [{ namespace: "custom", skills: customSkills }] : []),
    ...controller.repositories
      .map((repository) => ({ namespace: repository.id, skills: filtered.filter((skill) => skill.repositoryId === repository.id) }))
      .filter((source) => source.skills.length || !query.trim()),
  ];
  const visibleTreeKeys = visibleSources.flatMap((source) => [
    `profile:${source.namespace}`,
    ...treeKeys(buildSkillTree(source.skills), `profile:${source.namespace}`),
  ]);
  const effectiveCollapsed = query.trim() ? new Set<string>() : collapsed;
  return (
    <WorkspaceSection title="Profiles" description="Build a reusable skill set, then save all changes in one update.">
      {controller.profileError && (
        <div className="profile-error" role="alert">
          <span>{controller.profileError}</span>
          <button type="button" aria-label="Dismiss profile error" onClick={controller.dismissProfileError}><X /></button>
        </div>
      )}
      <form className="skills-form compact-form" onSubmit={(event) => void submit(event)}>
        <input required placeholder="profile-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
        <button className="skills-primary" disabled={controller.busy}><Plus />Create profile</button>
      </form>
      <div className="profile-layout">
        <nav className="profile-list">
          <p>Profiles</p>
          {controller.profiles.map((profile) => (
            <button key={profile.id} className={controller.selectedProfileId === profile.id ? "active" : ""} onClick={() => void controller.selectProfile(profile.id)}>
              <span>{profile.slug}</span>
              {controller.selectedProfileId === profile.id && <b>{draft.size}</b>}
            </button>
          ))}
          {!controller.profiles.length && <Empty text="No profiles yet." />}
        </nav>
        <div className="profile-skills">
          <div className="profile-skills-header">
            <span>
              <h3>{controller.profileDetail?.profile.slug ?? "Select a profile"}</h3>
              <small>{draft.size} selected{dirty ? ` · ${symmetricDifferenceSize(draft, saved)} pending changes` : " · All changes saved"}</small>
            </span>
            <SearchField value={query} placeholder="Find skills or folders" onChange={setQuery} />
            <div className="profile-header-actions">
              <button className="skills-button quiet" type="button" disabled={!dirty || controller.busy} onClick={() => setDraft(new Set(saved))}><RotateCcw />Reset</button>
              <button className="skills-primary save-profile" type="button" disabled={!dirty || !controller.selectedProfileId || controller.busy} onClick={() => void save()}><Save />Save changes</button>
            </div>
          </div>
          <div className="profile-tree-toolbar">
            <TreeControls
              onExpand={() => setCollapsed((current) => setKeysCollapsed(current, visibleTreeKeys, false))}
              onCollapse={() => setCollapsed((current) => setKeysCollapsed(current, visibleTreeKeys, true))}
            />
          </div>
          <div className="profile-tree">
            {customSkills.length > 0 && (
              <ProfileSourceGroup
                title="My skills"
                icon={<Folder />}
                skills={customSkills}
                namespace="custom"
                draft={draft}
                collapsed={effectiveCollapsed}
                onToggleSkill={(id) => setDraft((current) => toggleSet(current, id))}
                onToggleGroup={(key) => setCollapsed((current) => toggleSet(current, key))}
              />
            )}
            {controller.repositories.map((repository) => {
              const skills = filtered.filter((skill) => skill.repositoryId === repository.id);
              if (!skills.length && query.trim()) return null;
              return (
                <ProfileSourceGroup
                  key={repository.id}
                  title={repository.name}
                  subtitle={`${skills.length} skills`}
                  icon={<FolderGit2 />}
                  skills={skills}
                  namespace={repository.id}
                  draft={draft}
                collapsed={effectiveCollapsed}
                  onToggleSkill={(id) => setDraft((current) => toggleSet(current, id))}
                  onToggleGroup={(key) => setCollapsed((current) => toggleSet(current, key))}
                />
              );
            })}
            {!filtered.length && <Empty text="No skills match your search." />}
          </div>
        </div>
      </div>
    </WorkspaceSection>
  );
}

function ProfileSourceGroup({ title, subtitle, icon, skills, namespace, draft, collapsed, onToggleSkill, onToggleGroup }: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  skills: Skill[];
  namespace: string;
  draft: Set<string>;
  collapsed: Set<string>;
  onToggleSkill: (id: string) => void;
  onToggleGroup: (key: string) => void;
}) {
  const key = `profile:${namespace}`;
  const isCollapsed = collapsed.has(key);
  const selected = skills.filter((skill) => draft.has(skill.id)).length;
  return (
    <section className="profile-source-group">
      <button className="profile-source-header" type="button" aria-expanded={!isCollapsed} onClick={() => onToggleGroup(key)}>
        {isCollapsed ? <ChevronRight /> : <ChevronDown />}
        {icon}
        <span><strong>{title}</strong><small>{subtitle ?? `${skills.length} skills`}</small></span>
        <b>{selected}/{skills.length}</b>
      </button>
      {!isCollapsed && (
        <div className="profile-source-tree">
          <SkillTree nodes={buildSkillTree(skills)} collapsed={collapsed} namespace={`profile:${namespace}`} onToggle={onToggleGroup} selected={draft} onToggleSkill={onToggleSkill} />
        </div>
      )}
    </section>
  );
}

function SkillTree({ nodes, collapsed, namespace, onToggle, selected, onToggleSkill, onViewSkill, depth = 0 }: {
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

function SkillManifestDialog({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    void getSkillManifest(skill.id)
      .then((result) => { if (current) setContent(result.content); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      current = false;
      window.removeEventListener("keydown", close);
    };
  }, [onClose, skill.id]);
  return createPortal(
    <div className="dialog-backdrop skill-manifest-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="skill-manifest-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-manifest-title">
        <header>
          <span><FileText /><div><h2 id="skill-manifest-title">{skill.slug}</h2><p>SKILL.md</p></div></span>
          <button className="skills-icon-button" type="button" aria-label="Close skill content" onClick={onClose}><X /></button>
        </header>
        <div className="skill-manifest-body">
          {content === null && !error && <div className="skill-manifest-loading"><LoaderCircle className="spin" />Loading content…</div>}
          {error && <div className="skill-manifest-error">{error}</div>}
          {content !== null && <pre>{content}</pre>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function SourceFilterControl({ value, onChange }: { value: SourceFilter; onChange: (value: SourceFilter) => void }) {
  return (
    <div className="skills-filter" aria-label="Filter by source">
      {(["all", "custom", "repository"] as const).map((option) => (
        <button type="button" className={value === option ? "active" : ""} key={option} onClick={() => onChange(option)}>
          {option === "all" ? "All" : option === "custom" ? "My skills" : "Repositories"}
        </button>
      ))}
    </div>
  );
}

function TreeControls({ onExpand, onCollapse }: { onExpand: () => void; onCollapse: () => void }) {
  return (
    <div className="tree-controls">
      <button type="button" onClick={onExpand}><ChevronDown />Expand all</button>
      <button type="button" onClick={onCollapse}><ChevronRight />Collapse all</button>
    </div>
  );
}

function SearchField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="skills-search"><Search /><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function WorkspaceSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="skills-content"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>;
}

function Empty({ text }: { text: string }) {
  return <div className="skills-empty">{text}</div>;
}

function filterSkills(skills: Skill[], query: string, source: SourceFilter) {
  const candidates = skills.filter((skill) => source === "all" || skill.sourceType === source);
  const phrase = normalizeSearch(query);
  if (!phrase) return candidates;
  const foldedPhrase = foldSearchSeparators(phrase);
  const terms = foldedPhrase.split(/\s+/).filter(Boolean);
  const documents = candidates.map((skill) => {
    const slug = normalizeSearch(skill.slug);
    const path = normalizeSearch(skill.relativePath ?? "");
    const description = normalizeSearch(skill.description);
    return {
      skill,
      slug,
      path,
      description,
      foldedSlug: foldSearchSeparators(slug),
      foldedPath: foldSearchSeparators(path),
    };
  });
  const fuse = new Fuse(documents, {
    includeScore: true,
    keys: [
      { name: "slug", weight: 0.48 },
      { name: "foldedSlug", weight: 0.3 },
      { name: "path", weight: 0.12 },
      { name: "foldedPath", weight: 0.07 },
      { name: "description", weight: 0.03 },
    ],
    threshold: 0.3,
    ignoreLocation: true,
  });
  const scores = new Map<string, number[]>();
  for (const term of terms) {
    for (const result of fuse.search(term)) {
      const current = scores.get(result.item.skill.id) ?? [];
      current.push(result.score ?? 1);
      scores.set(result.item.skill.id, current);
    }
  }
  return documents
    .filter(({ skill }) => scores.get(skill.id)?.length === terms.length)
    .sort((left, right) => {
      const leftRank = searchRank(left, phrase, foldedPhrase, terms, scores.get(left.skill.id) ?? []);
      const rightRank = searchRank(right, phrase, foldedPhrase, terms, scores.get(right.skill.id) ?? []);
      return leftRank[0] - rightRank[0]
        || leftRank[1] - rightRank[1]
        || leftRank[2] - rightRank[2]
        || left.skill.slug.localeCompare(right.skill.slug);
    })
    .map(({ skill }) => skill);
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function foldSearchSeparators(value: string) {
  return value.replace(/[-_/\\]+/g, " ").replace(/\s+/g, " ").trim();
}

function searchRank(
  document: { slug: string; path: string; description: string; foldedSlug: string; foldedPath: string },
  phrase: string,
  foldedPhrase: string,
  terms: string[],
  scores: number[],
): [number, number, number] {
  const slugPath = `${document.foldedSlug} ${document.foldedPath}`;
  const allText = `${slugPath} ${document.description}`;
  const tier = document.slug === phrase
    ? 0
    : document.path === phrase
      ? 1
      : document.slug.includes(phrase) || document.path.includes(phrase) || document.foldedSlug.includes(foldedPhrase) || document.foldedPath.includes(foldedPhrase)
        ? 2
        : terms.every((term) => slugPath.includes(term))
          ? 3
          : terms.every((term) => allText.includes(term))
            ? 4
            : 5;
  return [tier, Math.max(...scores), scores.reduce((total, score) => total + score, 0) / scores.length];
}

function buildSkillTree(skills: Skill[]) {
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

function treeKeys(nodes: SkillTreeNode[], namespace: string): string[] {
  return nodes.flatMap((node) => [
    ...(node.path ? [`${namespace}:${node.path}`] : []),
    ...treeKeys(node.directories, namespace),
  ]);
}

function setKeysCollapsed(current: Set<string>, keys: string[], collapsed: boolean) {
  const next = new Set(current);
  for (const key of keys) {
    if (collapsed) next.add(key);
    else next.delete(key);
  }
  return next;
}

function countNodeSkills(node: SkillTreeNode): number {
  return node.skills.length + node.directories.reduce((total, child) => total + countNodeSkills(child), 0);
}

function toggleSet(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function symmetricDifferenceSize(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value)).length + [...right].filter((value) => !left.has(value)).length;
}
