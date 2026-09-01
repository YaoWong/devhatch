export type SkillRepository = {
  id: string;
  name: string;
  url: string;
  gitRef: string | null;
  commitHash: string;
  syncVersion: number;
};
export type Skill = {
  id: string;
  slug: string;
  description: string;
  sourceType: string;
  repositoryId: string | null;
  revision: string | null;
  relativePath: string | null;
};
export type SkillProfile = { id: string; slug: string };
export type SkillProfileDetail = { profile: SkillProfile; skills: Skill[] };
export type SkillSyncItem = { id: string | null; slug: string; relativePath: string };
export type SkillSyncPlan = {
  repositoryId: string;
  oldCommit: string | null;
  newCommit: string;
  noop: boolean;
  add: SkillSyncItem[];
  update: SkillSyncItem[];
  remove: SkillSyncItem[];
};
export type SkillSyncResult = SkillSyncPlan;
export type SkillRepositoryOperationStage =
  | "queued"
  | "cloning"
  | "counting"
  | "compressing"
  | "receiving"
  | "resolving"
  | "updating-files"
  | "discovering"
  | "planning"
  | "publishing"
  | "saving";
export type SkillRepositoryOperation = {
  id: string;
  kind: "add" | "preview" | "sync";
  repositoryId: string | null;
  stage: SkillRepositoryOperationStage;
  progress: number;
  downloadedBytes: number | null;
  totalBytes: number | null;
};
export type SkillRepositoryOperationStatus = {
  operation: SkillRepositoryOperation | null;
  revision: number;
};
