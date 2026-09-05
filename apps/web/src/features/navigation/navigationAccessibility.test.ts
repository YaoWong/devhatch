import { describe, expect, it } from "vitest";
import railSource from "./NavigationRail.tsx?raw";
import pixelRangeSource from "../../shared/ui/PixelRangeControl.tsx?raw";
import navigationSource from "./useNavigation.ts?raw";
import { getRailFocusRequest } from "./useNavigation";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const shellStyles = readFileSync(new URL("../../app/styles/shell.css", import.meta.url), "utf8");
const terminalStyles = readFileSync(new URL("../../app/styles/terminal.css", import.meta.url), "utf8");

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

  it("keeps settings floating and the compact range control contained", () => {
    expect(railSource).toContain('<Popover open={settingsAvailable && terminalSettingsOpen}');
    expect(railSource).not.toContain('className="canvas-terminal-settings pinned"');
    expect(railSource).toContain("tw:backdrop-blur-xl");
    expect(shellStyles).not.toContain(".canvas-terminal-settings.pinned");
    expect(pixelRangeSource).toContain("<Slider");
    expect(pixelRangeSource).toContain("tw:grid-cols-[minmax(40px,1fr)_56px]");
    expect(pixelRangeSource).not.toContain("Increase ${label}");
    expect(pixelRangeSource).not.toContain("Decrease ${label}");
  });

  it("reveals direct actions when their containers are wide enough", () => {
    expect(shellStyles).toMatch(/@container navigation-rail \(min-width: 340px\) \{[\s\S]*?\.path-actions \{ width: max\(160px, calc\(160px \* var\(--app-ui-scale\)\)\) !important; \}[\s\S]*?\.path-actions \.path-wide-action \{ display: inline-flex !important; \}[\s\S]*?\.path-actions \[data-slot="dropdown-menu-trigger"\] \{ display: none !important; \}/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\) \{\s*@container navigation-rail \(min-width: 340px\) \{\s*\.path-actions \{ width: max\(176px, calc\(176px \* var\(--app-ui-scale\)\)\) !important; \}/);
    expect(terminalStyles).toMatch(/@container terminal-pane \(min-width: 420px\) \{[\s\S]*?\.terminal-pane-actions \{ display: flex; \}[\s\S]*?\.terminal-pane-overflow \{ display: none !important; \}/);
  });

  it("keeps the agent page scrollable and resize targets large", () => {
    expect(shellStyles).toMatch(/\.agent-detail\s*{[^}]*overflow-y:\s*auto/);
    expect(shellStyles).toMatch(/\.app > \.rail-resize-handle\s*{[^}]*width:\s*40px/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.app > \.rail-resize-handle\s*{[^}]*width:\s*44px/);
    expect(shellStyles).toMatch(/\.rail-resize-handle > span\s*{[^}]*width:\s*3px/);
  });
});
