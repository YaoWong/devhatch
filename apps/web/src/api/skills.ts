import type { Skill, SkillProfile, SkillProfileDetail, SkillRepository, SkillSyncPlan, SkillSyncResult } from "../types/skills";
import { requestEmpty, requestJson } from "./client";

export function deleteSkillProfileSkill(profileId: string, skillId: string) {
  return requestEmpty(
    `/api/skill-profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
    { method: "DELETE" },
    "Unable to disable skill",
  );
}

export function addSkillProfileSkill(profileId: string, skillId: string) {
  return requestEmpty(
    `/api/skill-profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
    { method: "POST" },
    "Unable to enable skill",
  );
}

export function replaceSkillProfileSkills(profileId: string, skillIds: string[]) {
  return requestEmpty(
    `/api/skill-profiles/${encodeURIComponent(profileId)}/skills`,
    { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ skillIds }) },
    "Unable to save profile",
  );
}

export function listSkillRepositories() {
  return requestJson<{ skillRepositories: SkillRepository[] }>("/api/skill-repositories");
}

export function createSkillRepository(input: { url: string; gitRef?: string }) {
  return requestJson<{ skillRepository: SkillRepository }>(
    "/api/skill-repositories",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to add repository",
  );
}

export function updateSkillRepository(id: string, input: { name: string }) {
  return requestJson<{ skillRepository: SkillRepository }>(
    `/api/skill-repositories/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to rename repository",
  );
}

export function deleteSkillRepository(id: string) {
  return requestEmpty(`/api/skill-repositories/${encodeURIComponent(id)}`, { method: "DELETE" }, "Unable to delete repository");
}

export function previewSkillRepositorySync(id: string) {
  return requestJson<{ syncPlan: SkillSyncPlan }>(
    `/api/skill-repositories/${encodeURIComponent(id)}/sync-preview`,
    { method: "POST" },
    "Unable to preview repository sync",
  );
}

export function syncSkillRepository(id: string) {
  return requestJson<{ syncResult: SkillSyncResult }>(
    `/api/skill-repositories/${encodeURIComponent(id)}/sync`,
    { method: "POST" },
    "Unable to sync repository",
  );
}

export function listSkills() {
  return requestJson<{ skills: Skill[] }>("/api/skills");
}

export function createSkill(input: { slug: string; description: string }) {
  return requestJson<{ skill: Skill }>(
    "/api/skills",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to create skill",
  );
}

export function importSkill(input: { source: string; slug?: string }) {
  return requestJson<{ skill: Skill }>(
    "/api/skills/import",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to import skill",
  );
}

export function getSkillManifest(id: string) {
  return requestJson<{ content: string }>(
    `/api/skills/${encodeURIComponent(id)}/manifest`,
    undefined,
    "Unable to load skill content",
  );
}

export function deleteSkill(id: string) {
  return requestEmpty(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" }, "Unable to delete skill");
}

export function listSkillProfiles() {
  return requestJson<{ skillProfiles: SkillProfile[] }>("/api/skill-profiles");
}

export function createSkillProfile(input: { slug: string }) {
  return requestJson<{ skillProfile: SkillProfile }>(
    "/api/skill-profiles",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Unable to create profile",
  );
}

export function getSkillProfile(id: string) {
  return requestJson<{ skillProfileDetail: SkillProfileDetail }>(
    `/api/skill-profiles/${encodeURIComponent(id)}`,
    undefined,
    "Unable to load profile",
  );
}
