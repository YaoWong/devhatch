import { describe, expect, it } from "vitest";
import railSource from "./NavigationRail.tsx?raw";
import appSource from "../../app/App.tsx?raw";
import settingsSource from "../settings/SettingsView.tsx?raw";
import webAppsSource from "../web-apps/WebApps.tsx?raw";
import terminalSettingsSource from "../terminals/TerminalSettingsControls.tsx?raw";
import terminalLayoutSource from "../terminals/TerminalLayoutPresetControl.tsx?raw";
import launchPathsSource from "../terminals/LaunchPaths.tsx?raw";
import terminalWorkspaceSource from "../terminals/TerminalWorkspace.tsx?raw";
import workspaceControllerSource from "../terminals/useWorkspaceController.ts?raw";
import agentRailSource from "../agents/AgentRailPage.tsx?raw";
import agentSessionListSource from "../agents/AgentSessionList.tsx?raw";
import appNavigationRailSource from "../../app/AppNavigationRail.tsx?raw";
import resizeHandleSource from "../../shared/ui/RailResizeHandle.tsx?raw";
import floatingAlertSource from "../../shared/ui/FloatingAlert.tsx?raw";
import pixelRangeSource from "../../shared/ui/PixelRangeControl.tsx?raw";
import workspaceListSource from "../../shared/ui/RailWorkspaceList.tsx?raw";
import navigationSource from "./useNavigation.ts?raw";
import { getRailFocusRequest } from "./useNavigation";
import { MIN_NAVIGATION_RAIL_WIDTH_PX } from "../../shared/theme/displaySettings";

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
    expect(navigationSource).toContain('terminal: { label: "Workbench", icon: Hammer }');
    expect(railSource.match(/terminal: \{ icon: Hammer, label: "Workbench" \}/g)).toHaveLength(2);
    expect(railSource).toContain("Workbench settings");
    expect(railSource).not.toContain("Terminal settings");
    expect(terminalLayoutSource).toContain('aria-label={`${count}-pane layout`}');
  });

  it("expands desktop actions on interaction without reserving text space", () => {
    expect(launchPathsSource).toContain("launch-path-row");
    expect(launchPathsSource).toContain("path-actions tw:flex tw:w-0");
    expect(launchPathsSource).toContain("tw:[@media(pointer:coarse)]:w-[max(88px,calc(88px*var(--app-ui-scale)))]");
    expect(launchPathsSource).toContain("path-launch-action");
    expect(launchPathsSource).toContain("path-pin-action");
    expect(launchPathsSource).toContain('pathOverflowMenu(item, false, "path-overflow-secondary")');
    expect(launchPathsSource).toContain('pathOverflowMenu(item, true, "path-overflow-all")');
    expect(workspaceListSource).toContain("workspace-actions tw:flex tw:w-[max(40px,calc(40px*var(--app-ui-scale)))]");
    expect(workspaceListSource).not.toMatch(/group-(?:hover|focus-within)\/workspace:w/);
    expect(agentSessionListSource).not.toMatch(/group-(?:hover|focus-within)\/session-row:pr/);
    expect(shellStyles).toContain(".launch-path-row:hover .path-actions, .launch-path-row:focus-within .path-actions, .launch-path-row:has(.path-actions [data-popup-open]) .path-actions { width: max(80px, calc(80px * var(--app-ui-scale))) !important; }");
    expect(shellStyles).toContain(".rail-width-264 .launch-path-row:hover .path-actions, .rail-width-264 .launch-path-row:focus-within .path-actions, .rail-width-264 .launch-path-row:has(.path-actions [data-popup-open]) .path-actions { width: max(120px, calc(120px * var(--app-ui-scale))) !important; }");
    expect(shellStyles).toContain(".rail-width-320 .launch-path-row:hover .path-actions, .rail-width-320 .launch-path-row:focus-within .path-actions, .rail-width-320 .launch-path-row:has(.path-actions [data-popup-open]) .path-actions { width: max(160px, calc(160px * var(--app-ui-scale))) !important; }");
    expect(shellStyles).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\.rail-width-280 \.path-actions \{ width: max\(132px, calc\(132px \* var\(--app-ui-scale\)\)\) !important; \}[\s\S]*?\.rail-width-336 \.path-actions \{ width: max\(176px, calc\(176px \* var\(--app-ui-scale\)\)\) !important; \}/);
    expect(shellStyles).not.toContain("@container navigation-rail");
    expect(shellStyles).not.toContain("container-name: navigation-rail");
    expect(railSource).toContain("rail-width-264");
    expect(railSource).toContain("rail-width-320");
    expect(railSource).toContain("rail-width-336");
    expect(MIN_NAVIGATION_RAIL_WIDTH_PX).toBe(256);
    expect(settingsSource).toContain('min={MIN_NAVIGATION_RAIL_WIDTH_PX}');
    expect(resizeHandleSource).toContain("aria-valuemin={MIN_NAVIGATION_RAIL_WIDTH_PX}");
    expect(appSource).toContain("railWidthPx={mobileNavigation ? null : navigationRailWidthPx}");
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
    expect(shellStyles).toMatch(/\[data-slot="sheet-content"\] > \.rail\s*\{[^}]*width:\s*100%[^}]*transform:\s*none/);
    expect(shellStyles).not.toMatch(/\.app > \.rail\s*\{[^}]*container-type:/);
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

  it("orders unified Workbench launch controls and renders history only for Agent targets", () => {
    const workspaceIndex = appNavigationRailSource.indexOf("<WorkspaceList");
    const setupIndex = appNavigationRailSource.indexOf("<AgentRailPage");
    const pathsIndex = appNavigationRailSource.indexOf("<WorkspaceLaunchPaths");
    const historyIndex = appNavigationRailSource.indexOf("{agent.selectedAgent && (");
    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(setupIndex).toBeGreaterThan(workspaceIndex);
    expect(pathsIndex).toBeGreaterThan(setupIndex);
    expect(historyIndex).toBeGreaterThan(pathsIndex);
    expect(appNavigationRailSource).not.toContain("selectedAgentLaunchOptions");
    expect(agentRailSource).not.toContain("<Play />");
    expect(agentRailSource).not.toContain("onClick={onLaunch}");
    expect(appNavigationRailSource).not.toContain("ensureLaunchPathSelected");
    expect(appNavigationRailSource).toMatch(/onLaunch=\{\(path\) => \{\s*void agent\.launch\(\{ cwd: path\.path \}\);/);
    expect(launchPathsSource).toContain('aria-label={`Launch ${launchTargetName ?? "session"} in ${item.path}`}');
  });

  it("allocates remaining Workbench rail height by launch target", () => {
    expect(appNavigationRailSource).toContain("workbench-rail-layout ${agent.selectedAgent ? \"has-agent-history\" : \"terminal-target\"}");
    expect(appNavigationRailSource).toContain('style={{ "--launch-paths-max-height": `${launchPathsHeight}px`, "--workspace-list-max-height": `${workspaceHeight}px` } as CSSProperties}');
    expect(agentSessionListSource).toContain(">Agent History</p>");
    expect(shellStyles).toMatch(/\.agent-detail\s*\{[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.workbench-rail-layout\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.workspace-section\s*\{[^}]*max-height:\s*var\(--workspace-list-max-height, 286px\)[^}]*flex:\s*none[^}]*overflow:\s*hidden/);
    expect(workspaceListSource).toContain('className="workspace-list tw:grid tw:min-h-0');
    expect(workspaceListSource).toContain("workspaces.map((workspace) => {");
    expect(workspaceListSource).toContain("aria-pressed={selected}");
    expect(workspaceListSource).toContain("if (!selected) onSelect(workspace.id);");
    expect(workspaceListSource).not.toContain("ChevronsUpDown");
    expect(workspaceListSource).not.toContain("Switch workspace");
    expect(workspaceControllerSource).toMatch(/const activateWorkspace[\s\S]*?closeSidebar\(\);[\s\S]*?bumpFocus\(\);/);
    expect(terminalWorkspaceSource).toContain("if (visible && !activeId) stageRef.current?.focus({ preventScroll: true });");
    expect(agentRailSource).toContain("disabled={busy || launching || configsLoading}");
    expect(workspaceListSource).toContain("workspace-actions tw:flex tw:w-[max(40px,calc(40px*var(--app-ui-scale)))]");
    expect(workspaceListSource).toContain("workspace-overflow-action");
    expect(workspaceListSource).toContain("portalOwner={portalOwnerId}");
    expect(workspaceListSource).toContain("dispatchCustomSelectOpenChange(portalOwnerRef.current, open)");
    expect(workspaceListSource.match(/aria-label="Rename workspace"/g)).toHaveLength(1);
    expect(workspaceListSource.match(/aria-label="Delete workspace"/g)).toHaveLength(1);
    expect(shellStyles).toMatch(/\.paths-section\s*{[^}]*flex:\s*1 1 120px[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.has-agent-history \.paths-section\s*{[^}]*max-height:\s*var\(--launch-paths-max-height, 286px\)[^}]*flex:\s*0 1 auto/);
    expect(shellStyles).toMatch(/\.agent-launch-section\s*{[^}]*max-height:\s*min\(420px, 48%\)[^}]*overflow-y:\s*auto/);
    expect(shellStyles).toMatch(/\.sessions-section\s*{[^}]*flex:\s*1 1 120px[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.agent-session-list\s*{[^}]*flex:\s*1[^}]*overflow-y:\s*auto/);
  });

  it("keeps Workbench list chrome fixed and search focus rounded", () => {
    expect(agentSessionListSource).not.toContain("onScroll={() => {");
    expect(agentSessionListSource).toMatch(/<div ref=\{portalOwnerRef\} id=\{portalOwnerId\} className=\{`\$\{railMenuSectionClass\} sessions-section`\}>[\s\S]*?<div className="tw:mb-\[8px\][^"]*">[\s\S]*?<div className="agent-session-list[^"]*">/);
    expect(agentSessionListSource).toContain("tw:has-[:focus-visible]:border-[var(--color-accent)]");
    expect(agentSessionListSource).toContain("tw:has-[:focus-visible]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]");
    expect(agentSessionListSource).not.toContain("tw:focus-visible:[outline:2px_solid_var(--color-accent)]");
    expect(launchPathsSource).toMatch(/>Launch Paths<\/p>[\s\S]*?<div className="tw:grid tw:min-h-0 tw:flex-1[^"]*tw:overflow-y-auto/);
    expect(workspaceListSource).toMatch(/>Workspace<\/p>[\s\S]*?<div className="workspace-list[^"]*tw:overflow-y-auto/);
    expect(shellStyles).toMatch(/\.workspace-list\s*\{[^}]*scrollbar-gutter:\s*stable/);
    expect(shellStyles).toMatch(/\.agent-session-list\s*{[^}]*overflow-y:\s*auto/);
    expect(shellStyles).not.toContain(".sessions-section.is-scrolling");
    expect(shellStyles).toMatch(/\.app > \.rail\s*{[^}]*background:\s*transparent;/);
    expect(shellStyles).toMatch(/\.app > \.rail::before\s*{[^}]*background:\s*color-mix\(in srgb, var\(--color-surface\) 92%, transparent\);[^}]*backdrop-filter:\s*blur\(18px\) saturate\(120%\);/);
    expect(shellStyles).not.toMatch(/\.app > \.rail\s*{[^}]*backdrop-filter:/);
    expect(shellStyles).not.toMatch(/\.rail\s*{[^}]*will-change:\s*width/);
    expect(shellStyles).toContain(".rail-page.active { opacity: 1; visibility: visible; pointer-events: auto; transform: none;");
  });

  it("keeps the agent history internally scrollable and resize targets large", () => {
    expect(shellStyles).toMatch(/\.agent-detail\s*{[^}]*overflow:\s*hidden/);
    expect(shellStyles).toMatch(/\.app > \.rail-resize-handle\s*{[^}]*width:\s*40px/);
    expect(shellStyles).toMatch(/@media \(pointer: coarse\)\s*{[\s\S]*?\.app > \.rail-resize-handle\s*{[^}]*width:\s*44px/);
    expect(shellStyles).toMatch(/\.rail-resize-handle > span\s*{[^}]*width:\s*3px/);
  });
});
