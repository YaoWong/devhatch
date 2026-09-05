import { ChevronDown, ChevronRight, Folder, FolderGit2, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Skill } from "../../types/skills";
import { RenameDialog } from "../../shared/ui/RenameDialog";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type { SkillsController } from "./controller";
import { Empty, SearchField, SkillsIconButton, SkillsPrimaryButton, SkillsSecondaryButton, TreeControls, WorkspaceSection } from "./controls";
import { filterSkills } from "./search";
import { SkillTree } from "./SkillTree";
import { buildSkillTree, sameSet, setKeysCollapsed, symmetricDifferenceSize, toggleSet, treeKeys } from "./treeUtils";

export function Profiles({ controller }: { controller: SkillsController }) {
  const [slug, setSlug] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingProfileId, setRenamingProfileId] = useState<string | null>(null);
  const saveRef = useRef(false);
  const showProfileLoading = useDelayedLoading(controller.profileLoading);
  const detailProfileId = controller.profileDetail?.profile.id;
  const detailSkills = controller.profileDetail?.skills;
  useLayoutEffect(() => {
    if (!detailProfileId || detailProfileId !== controller.selectedProfileId || !detailSkills) return;
    const next = new Set(detailSkills.map((skill) => skill.id));
    setDraft(next);
    setSaved(new Set(next));
  }, [detailProfileId, detailSkills, controller.selectedProfileId]);
  const dirty = !sameSet(draft, saved);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await controller.createProfile(slug.trim())) setSlug("");
  };
  const save = async () => {
    if (saveRef.current) return;
    const targetId = controller.selectedProfileId;
    if (!targetId) return;
    const targetDraft = new Set(draft);
    saveRef.current = true;
    try {
      if (await controller.saveProfile([...targetDraft]) && controller.selectedProfileId === targetId) {
        setSaved(targetDraft);
      }
    } finally {
      saveRef.current = false;
    }
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
  const allCollapsed = visibleTreeKeys.length > 0 && visibleTreeKeys.every((key) => effectiveCollapsed.has(key));
  const selectedProfile = controller.profiles.find((profile) => profile.id === controller.selectedProfileId);
  const detailReady = controller.profileDetail?.profile.id === controller.selectedProfileId;
  return (
    <WorkspaceSection title="Profiles" description="Build a reusable skill set, then save all changes in one update.">
      {controller.profileError && (
        <div className="profile-error" role="alert">
          <span>{controller.profileError}</span>
          <Button variant="ghost" size="icon" className="tw:size-10 tw:rounded-full tw:text-[var(--color-text-subtle)] tw:hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]! tw:hover:text-destructive! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Dismiss profile error" onClick={controller.dismissProfileError}><X className="tw:size-3.5" /></Button>
        </div>
      )}
      <form className="skills-form compact-form" onSubmit={(event) => void submit(event)}>
        <label className="skills-form-field">
          <span>Profile slug</span>
          <Input className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11" required maxLength={64} placeholder="profile-slug" value={slug} onChange={(event) => setSlug(event.target.value)} />
        </label>
        <SkillsPrimaryButton className="tw:self-end" type="submit" disabled={controller.busy}><Plus />Create profile</SkillsPrimaryButton>
      </form>
      <div className="profile-layout">
        <nav className="profile-list">
          <p>Profiles</p>
          {controller.profiles.map((profile) => (
            <Button variant="ghost" key={profile.id} className={`tw:h-10 tw:w-full tw:justify-start tw:rounded-lg tw:px-2.5 tw:text-xs tw:font-semibold tw:transition-colors tw:duration-150 tw:hover:bg-muted/70! tw:[@media(pointer:coarse)]:h-11 ${controller.selectedProfileId === profile.id ? "active tw:bg-muted" : ""}`} aria-current={controller.selectedProfileId === profile.id ? "page" : undefined} onClick={() => void controller.selectProfile(profile.id)}>
              <span>{profile.slug}</span>
              {controller.selectedProfileId === profile.id && <b>{draft.size}</b>}
            </Button>
          ))}
          {!controller.profiles.length && <Empty text="No profiles yet." />}
        </nav>
        {!selectedProfile ? (
          <div className="profile-no-selection">
            <strong>No profile selected</strong>
            <span>{controller.profiles.length ? "Choose a profile to edit its saved skills." : "Create a profile to choose and save a reusable set of skills."}</span>
          </div>
        ) : (
          <div className={`profile-skills ${showProfileLoading ? "loading" : ""}`} aria-busy={controller.profileLoading} aria-live="polite">
            <div className="profile-detail-transition" key={controller.profileDetail?.profile.id ?? controller.selectedProfileId ?? "empty"} inert={!detailReady ? true : undefined}>
              <div className="profile-skills-header">
              <span className="profile-title">
                <span className="profile-title-row">
                  <h3>{controller.profileDetail?.profile.slug ?? selectedProfile?.slug ?? "Select a profile"}</h3>
                  {selectedProfile && <SkillsIconButton className="profile-rename" type="button" disabled={controller.busy} aria-label={`Rename ${selectedProfile.slug}`} onClick={() => setRenamingProfileId(selectedProfile.id)}><Pencil className="tw:size-[13px]" /></SkillsIconButton>}
                </span>
                <small>{draft.size} selected{dirty ? ` · ${symmetricDifferenceSize(draft, saved)} pending changes` : " · All changes saved"}</small>
              </span>
              <SearchField value={query} placeholder="Find skills or folders" onChange={setQuery} />
              <div className="profile-header-actions">
                <SkillsSecondaryButton type="button" disabled={!dirty || controller.busy} onClick={() => setDraft(new Set(saved))}><RotateCcw />Reset</SkillsSecondaryButton>
                <SkillsPrimaryButton className="save-profile" type="button" disabled={!dirty || !controller.selectedProfileId || controller.busy} onClick={() => void save()}><Save />Save changes</SkillsPrimaryButton>
              </div>
            </div>
            <div className="profile-tree-toolbar">
              <TreeControls
                allCollapsed={allCollapsed}
                disabled={!visibleTreeKeys.length || Boolean(query.trim())}
                onToggle={() => setCollapsed((current) => setKeysCollapsed(current, visibleTreeKeys, !allCollapsed))}
              />
            </div>
            <div className="profile-tree">
              {customSkills.length > 0 && (
                <ProfileSourceGroup
                  title="My skills"
                  icon={<Folder className="tw:size-[17px]" />}
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
                    icon={<FolderGit2 className="tw:size-[17px]" />}
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
        )}
      </div>
      {renamingProfileId && (() => {
        const profile = controller.profiles.find((item) => item.id === renamingProfileId);
        if (!profile) return null;
        return <RenameDialog initialValue={profile.slug} label="profile" maxLength={64} onSubmit={(nextSlug) => controller.renameProfile(profile.id, nextSlug)} onClose={() => setRenamingProfileId(null)} />;
      })()}
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
      <Button variant="ghost" className="profile-source-header tw:grid tw:h-auto tw:min-h-[52px] tw:w-full tw:grid-cols-[14px_18px_minmax(0,1fr)_auto] tw:justify-start tw:rounded-none tw:bg-[var(--color-surface-raised)] tw:px-3 tw:py-[7px] tw:text-left tw:font-normal tw:whitespace-normal tw:transition-colors tw:duration-150 tw:hover:bg-muted/50!" type="button" aria-expanded={!isCollapsed} onClick={() => onToggleGroup(key)}>
        {isCollapsed ? <ChevronRight className="tw:size-3.5" /> : <ChevronDown className="tw:size-3.5" />}
        {icon}
        <span><strong>{title}</strong><small>{subtitle ?? `${skills.length} skills`}</small></span>
        <b>{selected}/{skills.length}</b>
      </Button>
      {!isCollapsed && (
        <div className="profile-source-tree">
          <SkillTree nodes={buildSkillTree(skills)} collapsed={collapsed} namespace={`profile:${namespace}`} onToggle={onToggleGroup} selected={draft} onToggleSkill={onToggleSkill} />
        </div>
      )}
    </section>
  );
}
