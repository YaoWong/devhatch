import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import railSource from "./SkillsRailPage.tsx?raw";
import { SourceFilterControl } from "./controls";
import navigationSource from "../../app/AppNavigationRail.tsx?raw";
import navigationRailSource from "../navigation/NavigationRail.tsx?raw";

function count(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

describe("Skills UI contracts", () => {
  it("uses compact, accessible section labels", () => {
    expect(railSource).toContain('label: "Repos"');
    expect(railSource).toContain("tw:h-10");
    expect(railSource).toContain("tw:[@media(pointer:coarse)]:h-11");
    expect(railSource).toContain("tw:truncate");
  });

  it("uses the portaled mobile rail class and closes the sheet after selection", () => {
    expect(navigationRailSource).toContain('className={`${pageClass("skills")} skills-rail-page`}');
    expect(navigationSource).toContain("onSelect={(section) => {\n             onSelectSkillsSection(section);\n             navigation.closeSidebar();\n           }}");
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
