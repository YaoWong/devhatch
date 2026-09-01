import type { Skill, SkillProfile, SkillProfileDetail, SkillRepository, SkillRepositoryOperation, SkillSyncPlan } from "../../types/skills";

export type SkillsController = {
  repositories: SkillRepository[];
  skills: Skill[];
  profiles: SkillProfile[];
  selectedProfileId: string | null;
  profileDetail: SkillProfileDetail | null;
  profileLoading: boolean;
  syncPlan: SkillSyncPlan | null;
  profileError: string | null;
  dismissProfileError: () => void;
  busy: boolean;
  repositoryOperation: SkillRepositoryOperation | null;
  selectProfile: (id: string) => Promise<void>;
  addRepository: (url: string, gitRef: string) => Promise<boolean>;
  renameRepository: (id: string, name: string) => Promise<boolean>;
  deleteRepository: (id: string) => Promise<boolean>;
  previewSync: (id: string) => Promise<void>;
  syncRepository: (id: string) => Promise<boolean>;
  createSkill: (slug: string, description: string) => Promise<boolean>;
  deleteSkill: (id: string) => Promise<boolean>;
  createProfile: (slug: string) => Promise<boolean>;
  saveProfile: (skillIds: string[]) => Promise<boolean>;
};
