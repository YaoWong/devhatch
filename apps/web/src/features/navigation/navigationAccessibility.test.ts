import { describe, expect, it } from "vitest";
import railSource from "./NavigationRail.tsx?raw";
import navigationSource from "./useNavigation.ts?raw";
import { getRailFocusRequest } from "./useNavigation";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const shellStyles = readFileSync(new URL("../../app/styles/shell.css", import.meta.url), "utf8");

describe("navigation rail accessibility", () => {
  it("targets the destination back button after forward navigation", () => {
    expect(getRailFocusRequest("agent", "forward", "modes", "settings")).toEqual({
      mode: "agent",
      target: "back",
    });
  });

  it("targets the originating mode button after return navigation", () => {
    expect(getRailFocusRequest("modes", "return", "skills", "skills")).toEqual({
      mode: "skills",
      target: "mode",
    });
  });

  it("makes inactive pages inaccessible and focuses after commit", () => {
    expect(railSource).toContain('aria-hidden={railPage !== "modes"}');
    expect(railSource).toContain('inert={railPage !== "modes" ? true : undefined}');
    expect(railSource).toContain("aria-hidden={!active}");
    expect(railSource).toContain("inert={!active ? true : undefined}");
    expect(navigationSource).toContain("useLayoutEffect(() => {");
    expect(navigationSource).toContain("target.focus({ preventScroll: true });");
    expect(navigationSource.match(/focusRequestRef\.current = focusRequest;/g)).toHaveLength(2);
  });

  it("keeps the agent page scrollable and resize targets large", () => {
    expect(shellStyles).toMatch(/\.agent-detail\s*{[^}]*overflow-y:\s*auto/);
    expect(shellStyles).toMatch(/\.app > \.rail-resize-handle\s*{[^}]*width:\s*40px/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.app > \.rail-resize-handle\s*{[^}]*width:\s*44px/);
    expect(shellStyles).toMatch(/\.rail-resize-handle > span\s*{[^}]*width:\s*3px/);
  });
});
