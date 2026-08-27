import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSkill,
  createSkillProfile,
  createSkillRepository,
  deleteSkill,
  deleteSkillRepository,
  getSkillProfile,
  listSkillProfiles,
  listSkillRepositories,
  listSkills,
  previewSkillRepositorySync,
  replaceSkillProfileSkills,
  syncSkillRepository,
  updateSkillRepository,
} from "../api";
import type { Skill, SkillProfile, SkillProfileDetail, SkillRepository, SkillSyncPlan } from "../types";

export function useSkillsWorkspace(active: boolean, reportError: (message: string) => void) {
  const [repositories, setRepositories] = useState<SkillRepository[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [profiles, setProfiles] = useState<SkillProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<SkillProfileDetail | null>(null);
  const [syncPlan, setSyncPlan] = useState<SkillSyncPlan | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const syncGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      syncGeneration.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [repositoryData, skillData, profileData] = await Promise.all([
      listSkillRepositories(),
      listSkills(),
      listSkillProfiles(),
    ]);
    setRepositories(repositoryData.skillRepositories);
    setSkills(skillData.skills);
    setProfiles(profileData.skillProfiles);
    setSelectedProfileId((current) =>
      current && profileData.skillProfiles.some((profile) => profile.id === current)
        ? current
        : (profileData.skillProfiles[0]?.id ?? null),
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh().catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)));
  }, [active, refresh, reportError]);

  useEffect(() => {
    if (!selectedProfileId) {
      setProfileDetail(null);
      return;
    }
    let current = true;
    setProfileDetail(null);
    void getSkillProfile(selectedProfileId)
      .then(({ skillProfileDetail }) => {
        if (current) setProfileDetail(skillProfileDetail);
      })
      .catch((reason) => {
        if (current) setProfileError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [reportError, selectedProfileId]);

  const mutate = useCallback(async (
    action: () => Promise<unknown>,
    after?: () => Promise<void>,
    onError: (message: string) => void = reportError,
  ) => {
    setBusy(true);
    try {
      await action();
      await (after?.() ?? refresh());
      return true;
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh, reportError]);

  const selectProfile = useCallback(async (id: string) => {
    setProfileError(null);
    setSelectedProfileId(id);
  }, []);
  const reloadProfile = useCallback(async () => {
    if (!selectedProfileId) return;
    const { skillProfileDetail } = await getSkillProfile(selectedProfileId);
    setProfileDetail(skillProfileDetail);
  }, [selectedProfileId]);

  return {
    repositories,
    skills,
    profiles,
    selectedProfileId,
    profileDetail,
    syncPlan,
    profileError,
    dismissProfileError: () => setProfileError(null),
    busy,
    selectProfile,
    addRepository: (url: string, gitRef: string) => mutate(() => createSkillRepository({ url, gitRef: gitRef || undefined })),
    renameRepository: (id: string, name: string) => mutate(() => updateSkillRepository(id, { name })),
    deleteRepository: (id: string) => mutate(() => deleteSkillRepository(id)),
    previewSync: async (id: string) => {
      const generation = ++syncGeneration.current;
      setBusy(true);
      try {
        const { syncPlan: next } = await previewSkillRepositorySync(id);
        if (mounted.current && syncGeneration.current === generation && next.repositoryId === id) {
          setSyncPlan(next);
        }
      } catch (reason) {
        if (mounted.current && syncGeneration.current === generation) {
          reportError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (mounted.current && syncGeneration.current === generation) setBusy(false);
      }
    },
    syncRepository: async (id: string) => {
      const generation = ++syncGeneration.current;
      setBusy(true);
      try {
        await syncSkillRepository(id);
        if (mounted.current && syncGeneration.current === generation) {
          setSyncPlan((current) => (current?.repositoryId === id ? null : current));
        }
        await refresh();
        return true;
      } catch (reason) {
        if (mounted.current && syncGeneration.current === generation) {
          reportError(reason instanceof Error ? reason.message : String(reason));
        }
        return false;
      } finally {
        if (mounted.current && syncGeneration.current === generation) setBusy(false);
      }
    },
    createSkill: (slug: string, description: string) => mutate(() => createSkill({ slug, description })),
    deleteSkill: (id: string) => mutate(() => deleteSkill(id)),
    createProfile: async (slug: string) => {
      setProfileError(null);
      let id: string | null = null;
      const saved = await mutate(async () => {
        const { skillProfile } = await createSkillProfile({ slug });
        id = skillProfile.id;
      }, undefined, setProfileError);
      if (saved && id) setSelectedProfileId(id);
      return saved;
    },
    saveProfile: (skillIds: string[]) => {
      if (!selectedProfileId) return Promise.resolve(false);
      setProfileError(null);
      return mutate(
        () => replaceSkillProfileSkills(selectedProfileId, skillIds),
        reloadProfile,
        setProfileError,
      );
    },
  };
}
