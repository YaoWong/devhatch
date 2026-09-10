import { describe, expect, it } from "vitest";
import railSource from "./NavigationRail.tsx?raw";
import appSource from "../../app/App.tsx?raw";
import settingsSource from "../settings/SettingsView.tsx?raw";
import webAppsSource from "../web-apps/WebApps.tsx?raw";
import terminalSettingsSource from "../terminals/TerminalSettingsControls.tsx?raw";
import terminalLayoutSource from "../terminals/TerminalLayoutPresetControl.tsx?raw";
import launchPathsSource from "../terminals/LaunchPaths.tsx?raw";
import agentSessionListSource from "../agents/AgentSessionList.tsx?raw";
import appNavigationRailSource from "../../app/AppNavigationRail.tsx?raw";
import resizeHandleSource from "../../shared/ui/RailResizeHandle.tsx?raw";
import floatingAlertSource from "../../shared/ui/FloatingAlert.tsx?raw";
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
    expect(getRailFocusRequest("terminal", "forward", "modes", "settings")).toEqual({
      mode: "terminal",
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
    expect(railSource).toContain("tw:gap-[12px]");
    expect(railSource).toContain("tw:text-[calc(16px*var(--app-font-scale))] tw:font-[650]");
    expect(railSource).toContain("tw:h-[20px] tw:min-w-[20px]");
    expect(shellStyles).not.toContain(".return-enter .nav-item");
  });

  it("keeps rail motion typographically continuous without background flashes", () => {
    expect(navigationSource).toContain('const sourceLabel = source.querySelector<HTMLElement>("span")');
    expect(navigationSource).toContain('const detailLabel = detail.querySelector<HTMLElement>("strong")');
    expect(navigationSource).toContain('flight.setAttribute("aria-hidden", "true")');
    expect(navigationSource).toContain("const sourceBackground = sourceStyle.backgroundColor");
    expect(navigationSource).toContain("fontSize: numericStyle(labelStyle.fontSize)");
    expect(navigationSource).toContain("fontWeight: numericStyle(labelStyle.fontWeight, 400)");
    expect(navigationSource).toContain('const toBackground = motion === "forward" || showSettingsOnReturn ? "transparent" : sourceBackground');
    expect(navigationSource).not.toContain("requestAnimationFrame(() => {");
    expect(navigationSource).not.toContain("shared-title-backdrop");
    expect(shellStyles).toContain("[data-rail-flight-source] > * { opacity: 0 !important; }");
    expect(shellStyles).toContain(".mode-title strong { min-width: 0; overflow: hidden; font-weight: inherit;");
    expect(shellStyles).toContain("@keyframes detail-enter { from { opacity: 0; transform: translateX(16px);");
    expect(shellStyles).toContain("@keyframes modes-return { from { opacity: 0; transform: translateX(-16px);");
    expect(shellStyles).toContain("@keyframes rail-detail-enter { from { opacity: 0; } to { opacity: 1; } }");
    expect(shellStyles).not.toContain("rail-item-reveal");
    expect(shellStyles).not.toMatch(/\.rail-page[^{]*{[^}]*filter:/);
  });

  it("keeps settings floating and the compact range control contained", () => {
    expect(railSource).toContain('<Popover open={settingsAvailable && terminalSettingsOpen}');
    expect(railSource).not.toContain('className="canvas-terminal-settings pinned"');
    expect(railSource).toContain("tw:backdrop-blur-xl");
    expect(railSource).toContain("tw:bg-transparent!");
    expect(railSource).toContain("tw:hover:bg-transparent!");
    expect(railSource).not.toContain("tw:hover:bg-[var(--color-surface-hover)]!");
    expect(railSource).toContain("tw:aria-expanded:bg-transparent!");
    expect(railSource).toContain("tw:data-popup-open:bg-transparent!");
    expect(railSource).not.toContain("tw:data-popup-open:bg-[var(--color-canvas)]!");
    expect(shellStyles).not.toContain(".canvas-terminal-settings.pinned");
    expect(pixelRangeSource).toContain("<Slider");
    expect(pixelRangeSource).toContain("tw:grid-cols-[minmax(40px,1fr)_56px]");
    expect(pixelRangeSource).not.toContain("Increase ${label}");
    expect(pixelRangeSource).not.toContain("Decrease ${label}");
  });

  it("uses Workbench for the unified product surface", () => {
    expect(navigationSource).toContain('terminal: { label: "Workbench", icon: SquareTerminal }');
    expect(railSource.match(/label: "Workbench"/g)).toHaveLength(2);
    expect(railSource).toContain("Workbench settings");
    expect(railSource).not.toContain("Terminal settings");
    expect(terminalLayoutSource).toContain('aria-label={`${count}-pane layout`}');
  });

  it("reveals direct actions when their containers are wide enough", () => {
    expect(launchPathsSource).toContain("launch-path-row");
    expect(launchPathsSource).toContain("path-actions tw:flex tw:w-0");
    expect(shellStyles).toMatch(/@media \(pointer: fine\) \{\s*@container navigation-rail \(min-width: 262px\) \{[\s\S]*?\.launch-path-row:hover \.path-actions,[\s\S]*?\.launch-path-row:focus-within \.path-actions,[\s\S]*?\.launch-path-row:has\(\.path-actions \[data-popup-open\]\) \.path-actions \{ width: max\(160px, calc\(160px \* var\(--app-ui-scale\)\)\) !important; \}[\s\S]*?\.path-actions \.path-wide-action \{ display: inline-flex !important; \}[\s\S]*?\.path-actions \[data-slot="dropdown-menu-trigger"\] \{ display: none !important; \}/);
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
    expect(shellStyles).toContain(".canvas-edge-hot-zone { display: none; }");
    expect(shellStyles).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\.canvas-edge-hot-zone \{[^}]*inset: 0 auto 0 0;[^}]*z-index: 39;[^}]*width: 4px;[^}]*\}[\s\S]*?\.canvas-rail-open > \.canvas-edge-hot-zone \{ width: 12px; \}[\s\S]*?\.canvas-edge-trigger \{ pointer-events: none; \}/);
    expect(shellStyles).toMatch(/\[data-slot="sheet-content"\] > \.rail\s*\{[^}]*width:\s*100%[^}]*container-name:\s*navigation-rail/);
    expect(responsiveStyles).not.toMatch(/\[data-slot="sheet-content"\] > \.rail/);
    expect(responsiveStyles).toContain('.skills-rail-page .skills-section-nav > .skills-menu-label { display: none; }');
  });

  it("previews rail resizing without updating App state", () => {
    expect(appSource).toContain('appRef.current?.style.setProperty("--navigation-rail-width", `${value}px`)');
    expect(appSource).toContain("onPreview={previewRailWidth}");
    expect(appSource).not.toContain("setDraftRailWidth");
    expect(resizeHandleSource).toContain("onPointerMove={(event) => {");
    expect(resizeHandleSource).toContain("onPreview(next);");
    expect(resizeHandleSource).toContain("if (commit) onCommit(drag.currentWidth);");
    expect(resizeHandleSource).toContain("onPreview(valueRef.current);");
    expect(resizeHandleSource).not.toContain("onPreview(drag.startWidth);");
  });

  it("contains enlarged text at narrow widths", () => {
    expect(railSource).toContain("tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap");
    expect(agentSessionListSource).toContain("tw:flex tw:min-h-[20px] tw:flex-wrap");
    expect(agentSessionListSource).toContain("tw:[&_strong]:text-xs");
    expect(agentSessionListSource).toContain("tw:[&_strong]:font-medium");
    expect(settingsSource).toContain("tw:@max-[540px]/settings-workspace:flex-col");
    expect(webAppsSource).toMatch(/<strong className="[^"]*tw:overflow-hidden[^"]*tw:text-ellipsis[^"]*tw:whitespace-nowrap[^"]*">\{app\.name\}<\/strong>/);
    expect(terminalStyles).not.toMatch(/\.error-banner\b/);
    expect(floatingAlertSource).toContain("tw:max-w-[min(560px,calc(100%-32px))]");
    expect(floatingAlertSource).toContain("tw:[overflow-wrap:anywhere]");
    expect(webAppsSource).toContain('<FloatingAlert className="tw:absolute tw:left-1/2 tw:bottom-[18px]');
  });

  it("allocates remaining Workbench rail height to Agent History", () => {
    expect(appNavigationRailSource).toContain('className="workbench-rail-layout"');
    expect(appNavigationRailSource).toContain('style={{ "--launch-paths-max-height": `${launchPathsHeight}px` } as CSSProperties}');
    expect(agentSessionListSource).toContain(">Agent History</p>");
    expect(shellStyles).toMatch(/\.agent-detail\s*{[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.workbench-rail-layout\s*{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.workspace-section\s*{[^}]*max-height:\s*min\(240px, 34%\)[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.paths-section\s*{[^}]*max-height:\s*var\(--launch-paths-max-height, 286px\)[^}]*flex:\s*0 1 auto[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.agent-rail-layout\s*{[^}]*min-height:\s*min\(220px, 40%\)[^}]*flex:\s*1 1 220px[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.agent-launch-section\s*{[^}]*max-height:\s*45%[^}]*overflow-y:\s*auto/);
    expect(shellStyles).toMatch(/\.sessions-section\s*{[^}]*flex:\s*1 1 120px[^}]*overflow-y:\s*auto/);
    expect(shellStyles).toMatch(/\.agent-session-list\s*{[^}]*flex:\s*none[^}]*overflow:\s*visible/);
  });

  it("keeps the agent history internally scrollable and resize targets large", () => {
    expect(shellStyles).toMatch(/\.agent-detail\s*{[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.app > \.rail-resize-handle\s*{[^}]*width:\s*40px/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.app > \.rail-resize-handle\s*{[^}]*width:\s*44px/);
    expect(shellStyles).toMatch(/\.rail-resize-handle > span\s*{[^}]*width:\s*3px/);
  });
});
