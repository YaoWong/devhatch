import { describe, expect, it } from "vitest";
import railSource from "./NavigationRail.tsx?raw";
import appSource from "../../app/App.tsx?raw";
import settingsSource from "../settings/SettingsView.tsx?raw";
import webAppsSource from "../web-apps/WebApps.tsx?raw";
import terminalWorkspaceSource from "../terminals/TerminalWorkspace.tsx?raw";
import terminalSettingsSource from "../terminals/TerminalSettingsControls.tsx?raw";
import resizeHandleSource from "../../shared/ui/RailResizeHandle.tsx?raw";
import pixelRangeSource from "../../shared/ui/PixelRangeControl.tsx?raw";
import navigationSource from "./useNavigation.ts?raw";
import { getRailFocusRequest } from "./useNavigation";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const shellStyles = readFileSync(new URL("../../app/styles/shell.css", import.meta.url), "utf8");
const responsiveStyles = readFileSync(new URL("../../app/styles/responsive.css", import.meta.url), "utf8");
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

  it("owns static navigation and terminal setting leaves in components", () => {
    expect(shellStyles).not.toMatch(/\.terminal-setting-(?:row|range)|\.canvas-mode-actions|\.primary-nav|\.nav-item (?:svg|> span|b)|\.settings-nav-item svg/);
    expect(terminalSettingsSource).toContain("tw:min-h-[40px]");
    expect(terminalSettingsSource).toContain("tw:[@media(pointer:coarse)]:min-h-[44px]");
    expect(terminalSettingsSource).toContain("tw:gap-[7px]");
    expect(terminalSettingsSource).toContain("tw:pt-[3px]");
    expect(railSource).toContain("nav-item tw:h-auto");
    expect(railSource).toContain("tw:h-[20px] tw:min-w-[20px]");
    expect(shellStyles).toContain(".return-enter .nav-item");
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
    expect(shellStyles).toMatch(/@media \(pointer: fine\) \{\s*@container navigation-rail \(min-width: 262px\) \{[\s\S]*?\.path-actions \{ width: max\(160px, calc\(160px \* var\(--app-ui-scale\)\)\) !important; \}[\s\S]*?\.path-actions \.path-wide-action \{ display: inline-flex !important; \}[\s\S]*?\.path-actions \[data-slot="dropdown-menu-trigger"\] \{ display: none !important; \}/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\) \{\s*@container navigation-rail \(min-width: 280px\) \{\s*\.path-actions \{ width: max\(176px, calc\(176px \* var\(--app-ui-scale\)\)\) !important; \}[\s\S]*?\.path-actions \.path-wide-action \{ display: inline-flex !important; \}[\s\S]*?\.path-actions \[data-slot="dropdown-menu-trigger"\] \{ display: none !important; \}/);
    expect(terminalStyles).toMatch(/@container terminal-pane \(min-width: 420px\) \{[\s\S]*?\.terminal-pane-actions \{ display: flex; \}[\s\S]*?\.terminal-pane-overflow \{ display: none !important; \}/);
  });

  it("keeps rail placement authoritative across desktop and portaled mobile layouts", () => {
    expect(appSource).toContain("if (!mobile) return children;");
    expect(appSource).toMatch(/<SheetContent[\s\S]*?\{children\}[\s\S]*?<\/SheetContent>/);
    expect(appSource).toContain('window.matchMedia("(max-width: 920px)")');
    expect(resizeHandleSource).toContain('window.matchMedia("(max-width: 920px)")');
    expect(resizeHandleSource).toContain('window.addEventListener("pageshow", cancel)');
    expect(resizeHandleSource).toContain('window.addEventListener("orientationchange", cancel)');
    expect(shellStyles).toMatch(/\.canvas-rail-pinned[^{}]*> \.rail ~ \.shell/);
    expect(shellStyles).toMatch(/\.app > \.rail\s*\{/);
    expect(shellStyles).toMatch(/\[data-slot="sheet-content"\] > \.rail\s*\{[^}]*width:\s*100%[^}]*container-name:\s*navigation-rail/);
    expect(responsiveStyles).not.toMatch(/\[data-slot="sheet-content"\] > \.rail/);
    expect(responsiveStyles).toContain('.skills-rail-page .skills-section-nav > .menu-label { display: none; }');
  });

  it("contains enlarged text at narrow widths", () => {
    expect(shellStyles).toMatch(/\.path-section-head \.menu-label \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(shellStyles).toMatch(/\.sessions-title-row \{[^}]*flex-wrap: wrap;/);
    expect(settingsSource).toContain("tw:@max-[540px]/settings-workspace:flex-col");
    expect(webAppsSource).toMatch(/<strong className="[^"]*tw:overflow-hidden[^"]*tw:text-ellipsis[^"]*tw:whitespace-nowrap[^"]*">\{app\.name\}<\/strong>/);
    expect(terminalStyles).not.toMatch(/\.error-banner\b/);
    expect(terminalWorkspaceSource).toContain("tw:max-w-[min(560px,calc(100%-32px))]");
    expect(terminalWorkspaceSource).toContain("tw:[overflow-wrap:anywhere]");
    expect(webAppsSource).toContain("tw:max-w-[min(560px,calc(100%-32px))]");
    expect(webAppsSource).toContain("tw:[overflow-wrap:anywhere]");
  });

  it("keeps the agent page scrollable and resize targets large", () => {
    expect(shellStyles).toMatch(/\.agent-detail\s*{[^}]*overflow-y:\s*auto/);
    expect(shellStyles).toMatch(/\.app > \.rail-resize-handle\s*{[^}]*width:\s*40px/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.app > \.rail-resize-handle\s*{[^}]*width:\s*44px/);
    expect(shellStyles).toMatch(/\.rail-resize-handle > span\s*{[^}]*width:\s*3px/);
  });
});
