import Fuse from "fuse.js";
import type { Skill } from "../../types";

export type SourceFilter = "all" | "custom" | "repository";

export function filterSkills(skills: Skill[], query: string, source: SourceFilter) {
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
