import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSkill,
  createSkillProfile,
  createSkillRepository,
  deleteSkill,
  deleteSkillRepository,
  getSkillRepositoryOperation,
  getSkillProfile,
  listSkillProfiles,
  listSkillRepositories,
  listSkills,
  previewSkillRepositorySync,
  replaceSkillProfileSkills,
  syncSkillRepository,
  updateSkillProfile,
  updateSkillRepository,
} from "../../api/skills";
import type { Skill, SkillProfile, SkillProfileDetail, SkillRepository, SkillRepositoryOperation, SkillRepositoryOperationStatus, SkillSyncPlan } from "../../types/skills";
import { shouldRefreshForRepositoryOperation } from "./repositoryOperation";

export function useSkillsWorkspace(active: boolean, reportError: (message: string) => void, repositoryOperationsActive = active) {
  const [repositories, setRepositories] = useState<SkillRepository[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [profiles, setProfiles] = useState<SkillProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileDetail, setProfileDetail] = useState<SkillProfileDetail | null>(null);
  const [syncPlan, setSyncPlan] = useState<SkillSyncPlan | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [repositoryOperation, setRepositoryOperation] = useState<SkillRepositoryOperation | null>(null);
  const syncGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const repositoryOperationStatus = useRef<SkillRepositoryOperationStatus | null>(null);
  const profileGeneration = useRef(0);
  const selectedProfileIdRef = useRef<string | null>(null);
  const mutationRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      profileGeneration.current += 1;
      syncGeneration.current += 1;
      refreshGeneration.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    refreshQueued.current = true;
    if (refreshInFlight.current) return refreshInFlight.current;
    const request = (async () => {
      while (refreshQueued.current && mounted.current) {
        refreshQueued.current = false;
        const generation = ++refreshGeneration.current;
        const [repositoryData, skillData, profileData] = await Promise.all([
          listSkillRepositories(),
          listSkills(),
          listSkillProfiles(),
        ]);
        if (!mounted.current || refreshGeneration.current !== generation) return;
        setRepositories(repositoryData.skillRepositories);
        setSkills(skillData.skills);
        setProfiles(profileData.skillProfiles);
        setSelectedProfileId((current) => {
          const next = current && profileData.skillProfiles.some((profile) => profile.id === current)
            ? current
            : (profileData.skillProfiles[0]?.id ?? null);
          selectedProfileIdRef.current = next;
          return next;
        });
      }
    })();
    refreshInFlight.current = request;
    try {
      await request;
    } finally {
      if (refreshInFlight.current === request) refreshInFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh().catch((reason) => {
      if (mounted.current) reportError(reason instanceof Error ? reason.message : String(reason));
    });
  }, [active, refresh, reportError]);

  const pollRepositoryOperation = repositoryOperationsActive || busy || repositoryOperation !== null;
  useEffect(() => {
    if (!pollRepositoryOperation) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const status = await getSkillRepositoryOperation();
        if (cancelled || !mounted.current) return;
        const previous = repositoryOperationStatus.current;
        repositoryOperationStatus.current = status;
        setRepositoryOperation(status.operation);
        if (shouldRefreshForRepositoryOperation(previous, status)) {
          void refresh().catch((reason) => {
            if (!cancelled && mounted.current) reportError(reason instanceof Error ? reason.message : String(reason));
          });
        }
      } catch {
        if (cancelled || !mounted.current) return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 850);
    };
    timer = setTimeout(() => void poll(), 100);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollRepositoryOperation, refresh, reportError]);

  useEffect(() => {
    selectedProfileIdRef.current = selectedProfileId;
    const generation = ++profileGeneration.current;
    if (!selectedProfileId) {
      setProfileDetail(null);
      setProfileLoading(false);
      return;
    }
    const targetId = selectedProfileId;
    setProfileLoading(true);
    void getSkillProfile(targetId)
      .then(({ skillProfileDetail }) => {
        if (mounted.current && profileGeneration.current === generation && selectedProfileIdRef.current === targetId) {
          setProfileDetail(skillProfileDetail);
        }
      })
      .catch((reason) => {
        if (mounted.current && profileGeneration.current === generation && selectedProfileIdRef.current === targetId) {
          setProfileError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (mounted.current && profileGeneration.current === generation && selectedProfileIdRef.current === targetId) {
          setProfileLoading(false);
        }
      });
  }, [selectedProfileId]);

  const mutate = useCallback(async (
    action: () => Promise<unknown>,
    after?: () => Promise<void>,
    onError: (message: string) => void = reportError,
  ) => {
    if (mutationRef.current) return false;
    mutationRef.current = true;
    setBusy(true);
    try {
      await action();
      await (after?.() ?? refresh());
      return true;
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      mutationRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [refresh, reportError]);

  const selectProfile = useCallback(async (id: string) => {
    selectedProfileIdRef.current = id;
    setProfileError(null);
    setSelectedProfileId(id);
  }, []);
  const reloadProfile = useCallback(async (targetId: string) => {
    const generation = ++profileGeneration.current;
    const { skillProfileDetail } = await getSkillProfile(targetId);
    if (mounted.current && profileGeneration.current === generation && selectedProfileIdRef.current === targetId) {
      setProfileDetail(skillProfileDetail);
    }
  }, []);

  return {
    repositories,
    skills,
    profiles,
    selectedProfileId,
    profileDetail,
    profileLoading,
    syncPlan,
    profileError,
    dismissProfileError: () => setProfileError(null),
    busy: busy || repositoryOperation !== null,
    repositoryOperation,
    selectProfile,
    addRepository: (url: string, gitRef: string) => mutate(() => createSkillRepository({ url, gitRef: gitRef || undefined })),
    renameRepository: (id: string, name: string) => mutate(() => updateSkillRepository(id, { name })),
    deleteRepository: (id: string) => mutate(() => deleteSkillRepository(id)),
    previewSync: async (id: string) => {
      if (mutationRef.current) return;
      mutationRef.current = true;
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
        if (mounted.current && syncGeneration.current === generation) {
          mutationRef.current = false;
          setBusy(false);
        }
      }
    },
    syncRepository: async (id: string) => {
      if (mutationRef.current) return false;
      mutationRef.current = true;
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
        if (mounted.current && syncGeneration.current === generation) {
          mutationRef.current = false;
          setBusy(false);
        }
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
       if (saved && id) {
         selectedProfileIdRef.current = id;
         setSelectedProfileId(id);
       }
       return saved;
     },
     renameProfile: async (id: string, slug: string) => {
       setProfileError(null);
       const saved = await mutate(
         async () => {
           const { skillProfile } = await updateSkillProfile(id, { slug });
           if (!mounted.current) return;
           setProfiles((current) => current
             .map((profile) => profile.id === id ? skillProfile : profile)
             .sort((left, right) => left.slug.localeCompare(right.slug)));
           setProfileDetail((current) => current?.profile.id === id
             ? { ...current, profile: skillProfile }
             : current);
         },
         async () => {},
         setProfileError,
       );
       return saved && selectedProfileIdRef.current === id;
     },
     saveProfile: async (skillIds: string[]) => {
       const targetId = selectedProfileIdRef.current;
       if (!targetId) return false;
       setProfileError(null);
       const saved = await mutate(
         () => replaceSkillProfileSkills(targetId, skillIds),
         () => reloadProfile(targetId),
         setProfileError,
       );
       return saved && selectedProfileIdRef.current === targetId;
     },
  };
}
