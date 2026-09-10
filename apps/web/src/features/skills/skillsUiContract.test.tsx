import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import workspaceSource from "./SkillsWorkspace.tsx?raw";
import railSource from "./SkillsRailPage.tsx?raw";

import controlsSource from "./controls.tsx?raw";
import manifestSource from "./SkillManifestDialog.tsx?raw";
import profilesSource from "./Profiles.tsx?raw";
import repositoriesSource from "./Repositories.tsx?raw";
import skillLibrarySource from "./SkillLibrary.tsx?raw";
import skillTreeSource from "./SkillTree.tsx?raw";
import { SourceFilterControl } from "./controls";
import navigationSource from "../../app/AppNavigationRail.tsx?raw";
import navigationRailSource from "../navigation/NavigationRail.tsx?raw";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const shadcnCss = readFileSync(new URL("../../app/styles/shadcn.css", import.meta.url), "utf8");
const skillsCss = readFileSync(new URL("../../app/styles/skills.css", import.meta.url), "utf8");

function count(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

describe("Skills UI contracts", () => {
  it("uses compact, accessible section labels", () => {
    expect(railSource).toContain('label: "Repos"');
    expect(railSource).toContain("tw:h-10");
    expect(railSource).toContain("tw:[@media(pointer:coarse)]:h-11");
    expect(railSource).toContain('aria-current={section === item.id ? "page" : undefined}');
    expect(railSource).toContain("tw:aria-[current=page]:bg-background");
    expect(railSource).not.toContain("settings-nav-item");
    expect(railSource).not.toContain('"active ');
    expect(railSource).toContain("tw:truncate");
  });

  it("uses the portaled mobile rail class and closes the sheet after selection", () => {
    expect(navigationRailSource).toContain('className={`${pageClass("skills")} skills-rail-page`}');
    expect(navigationSource).toMatch(/onSelect=\{\(section\) => \{\s+onSelectSkillsSection\(section\);\s+navigation\.closeSidebar\(\);\s+\}\}/);
    expect(railSource).toContain("tw:[@media(max-width:920px)]:hidden");
    expect(railSource).toContain("skills-menu-label`}");
    expect(railSource).not.toContain("tw:skills-menu-label");
    expect(workspaceSource).toContain("tw:[@media(max-width:920px)]:pt-[58px]!");
  });

  it("owns skill manifest presentation without legacy hooks", () => {
    expect(manifestSource).not.toMatch(/skill-manifest-(?:dialog|body|loading|error)/);
    expect(skillsCss).not.toContain(".skill-manifest-");
    expect(manifestSource).toContain("tw:min-h-[66px]");
    expect(manifestSource).toContain("tw:gap-[16px]");
    expect(manifestSource).toContain("tw:size-[20px]");
    expect(manifestSource).toContain("tw:p-[24px]");
    expect(manifestSource).toContain("tw:[@media(max-width:480px)]:px-[16px]");
    expect(manifestSource).toContain("tw:[@media(max-width:480px)]:py-[18px]");
    expect(manifestSource).toContain("tw:[tab-size:2]");
    expect(manifestSource).toContain("tw:[overflow-wrap:anywhere]");
  });

  it("keeps recursive tree coordination authored and leaf presentation colocated", () => {
    expect(skillsCss).toContain(".skill-tree-node:not(.root) > .skill-tree-children, .profile-source-tree");
    expect(skillsCss).toContain(":first-child.profile-skill-row { border-top: 0 !important; }");
    expect(skillsCss).toContain(".profile-source-group + .profile-source-group");
    expect(skillsCss).not.toMatch(/\.skill-tree-folder \{|\.skill-row-meta|\.repository-no-skills|\.profile-source-header|\.profile-tree \{|\.profile-skill-row:focus-within/);
    expect(skillTreeSource).toContain("tw:grid-cols-[minmax(0,1fr)_minmax(80px,auto)]");
    expect(skillTreeSource).toContain("tw:text-[var(--color-accent)]");
    expect(skillTreeSource).toContain("profile-skill-row tw:relative");
    expect(skillTreeSource).toContain("tw:focus-within:outline-offset-[-2px]");
    expect(profilesSource).toContain("profile-source-tree tw:border-t");
    expect(repositoriesSource).toContain("tw:px-[14px] tw:py-[16px]");
  });

  it("preserves inclusive skills container breakpoints", () => {
    expect(shadcnCss).toContain("@custom-variant skills-max-860 (@container skills-workspace (max-width: 860px));");
    expect(shadcnCss).toContain("@custom-variant skills-max-480 (@container skills-workspace (max-width: 480px));");
    expect(`${controlsSource}\n${profilesSource}\n${repositoriesSource}\n${skillLibrarySource}\n${skillTreeSource}`).not.toMatch(/@max-\[(?:860|480)px\]\/skills-workspace/);
    expect(repositoriesSource).toContain("tw:skills-max-480:[&>.skills-icon-button]:flex-none");
    expect(repositoriesSource).not.toContain(":has(svg)");
    expect(controlsSource).toContain('skillsIconButtonClass = "skills-icon-button');
  });

  it("keeps only motion, generated state, and recursive coordination authored", () => {
    expect(skillsCss).toContain("@keyframes skills-section-enter");
    expect(skillsCss).toContain("@keyframes skill-tree-expand");
    expect(skillsCss).toContain(".profile-skills.loading::after");
    expect(skillsCss).toContain("@keyframes profile-detail-enter");
    expect(skillsCss).not.toContain("@container skills-workspace");
  });

  it("renders the source filter as a pressed-state group", () => {
    const html = renderToStaticMarkup(<SourceFilterControl value="repository" onChange={vi.fn()} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Filter by source"');
    expect(html).toContain('aria-label="Repos, filter to repository skills"');
    expect(html).toContain(">Repos</button>");
    expect(count(html, /aria-pressed="true"/g)).toBe(1);
  });
});
