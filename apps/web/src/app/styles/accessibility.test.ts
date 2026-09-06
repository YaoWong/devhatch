import { describe, expect, it } from "vitest";
import agentConfigSource from "../../features/agents/AgentConfigDialog.tsx?raw";
import terminalWorkspaceSource from "../../features/terminals/TerminalWorkspace.tsx?raw";
import workspacePickerSource from "../../features/terminals/WorkspacePicker.tsx?raw";
import brandingSource from "../../shared/branding/Branding.tsx?raw";
import terminalSurfaceSource from "../../shared/terminal/TerminalSurface.tsx?raw";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const responsiveCss = readFileSync(new URL("./responsive.css", import.meta.url), "utf8");
const baseCss = readFileSync(new URL("./base.css", import.meta.url), "utf8");
const dialogsCss = readFileSync(new URL("./dialogs.css", import.meta.url), "utf8");
const indexCss = readFileSync(new URL("./index.css", import.meta.url), "utf8");
const shadcnCss = readFileSync(new URL("./shadcn.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("./shell.css", import.meta.url), "utf8");
const terminalCss = readFileSync(new URL("./terminal.css", import.meta.url), "utf8");

describe("terminal accessibility styles", () => {
  it("keeps authored components before direct shadcn components", () => {
    expect(baseCss).toContain("@layer theme, base, vendor, components, utilities;");
    expect(baseCss).toContain("@layer components.authored;");
    expect(baseCss).toContain("@layer components.authored {");
    expect(baseCss).not.toMatch(/\bproduct\b/);
    expect(indexCss).toBe([
      '@import "@xterm/xterm/css/xterm.css" layer(vendor);',
      '@import "./shell.css" layer(components.authored);',
      '@import "./dialogs.css" layer(components.authored);',
      '@import "./skills.css" layer(components.authored);',
      '@import "./terminal.css" layer(components.authored);',
      '@import "./responsive.css" layer(components.authored);',
      "",
    ].join("\n"));
    expect(`${baseCss}\n${indexCss}`).not.toMatch(/\blegacy\b/);
  });

  it("keeps migrated config dialog presentation colocated", () => {
    expect(dialogsCss).not.toMatch(/\.config-|\.new-config|\.default-check|\.form-(?:message|error)|\.script-field/);
    expect(responsiveCss).not.toMatch(/\.config-(?:body|editor)/);
    expect(agentConfigSource).not.toMatch(/\b(?:config-dialog|config-header-copy|config-body|new-config|config-option|config-editor|default-check|form-message|form-error|script-field)\b/);
    expect(agentConfigSource).toContain("tw:grid-cols-[210px_minmax(0,1fr)]");
    expect(agentConfigSource).toContain("tw:[@media(max-width:640px)]:min-h-[132px]");
    expect(agentConfigSource).toContain("tw:[@media(max-width:640px)]:max-h-[150px]");
    expect(agentConfigSource).toContain("tw:[@media(max-width:640px)]:p-[16px]");
    expect(agentConfigSource).not.toMatch(/tw:max-sm:(?:grid-cols-1|overflow-y-auto|min-h-\[132px\]|max-h-\[150px\]|p-\[16px\])/);
  });

  it("keeps only picker pseudo-element and motion hooks authored", () => {
    expect(dialogsCss).toMatch(/^\.picker-breadcrumbs::-webkit-scrollbar \{ display: none; \}\n\.picker-spinner \{/);
    expect(dialogsCss).not.toMatch(/\.picker-(?:header|title|close|toolbar|location|browser|message|loading|footer|selection)\b|\.folder-(?:row|icon)\b/);
    expect(workspacePickerSource).toContain("picker-breadcrumbs tw:flex");
    expect(workspacePickerSource).toContain("picker-spinner tw:size-[13px]");
    expect(workspacePickerSource).toContain("tw:active:[transform:scale(.995)]");
    expect(workspacePickerSource).toContain("tw:[fill-opacity:0.12]");
    expect(workspacePickerSource).not.toContain("tw:fill-opacity-[0.12]");
    expect(workspacePickerSource).toContain("tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:font-normal");
    expect(workspacePickerSource).toContain("tw:[@media(max-width:640px)]:grid-cols-2");
    expect(workspacePickerSource).not.toMatch(/tw:max-sm:(?:px-\[16px\]|grid|grid-cols-2|col-span-full)/);
    expect(responsiveCss).not.toMatch(/\.picker-(?:header|toolbar|breadcrumbs|footer|selection)\b/);
  });

  it("keeps migrated brand and terminal leaves colocated", () => {
    expect(shellCss).not.toMatch(/\.brand(?:-mark)?\b/);
    expect(brandingSource).toContain("tw:size-[40px]");
    expect(brandingSource).toContain("tw:size-[32px]");
    expect(terminalCss).not.toMatch(/\.stage\s*\{|\.terminal-stage-empty|\.empty-state|\.error-banner|\.terminal-thumbnail img|\.terminal-image-paste-status\s*\{/);
    expect(terminalWorkspaceSource).toContain("terminal-stage tw:relative tw:min-h-0 tw:overflow-hidden");
    expect(terminalWorkspaceSource).toContain("tw:place-content-center");
    expect(terminalWorkspaceSource).toContain("tw:max-w-[min(560px,calc(100%-32px))]");
    expect(terminalWorkspaceSource).toContain("tw:[overflow-wrap:anywhere]");
    expect(terminalWorkspaceSource).toContain("tw:[&:not([src])]:invisible");
    expect(terminalSurfaceSource).toContain("terminal-image-paste-status tw:pointer-events-none");
    expect(terminalSurfaceSource).toContain("spin tw:size-[13px]");
  });

  it("enables xterm screen reader mode and themed IME composition", () => {
    expect(terminalSurfaceSource).toContain("screenReaderMode: true");
    expect(terminalCss).toMatch(/\.terminal-xterm-host \.xterm \.composition-view \{[^}]*background: var\(--color-surface\);[^}]*color: var\(--color-text\);[^}]*\}/);
  });

  it("suppresses authored motion without removing structural transforms", () => {
    expect(responsiveCss).toMatch(/\*, \*::before, \*::after \{[^}]*scroll-behavior: auto !important;[^}]*transition-duration: \.01ms !important;[^}]*animation-duration: \.01ms !important;/);
    expect(responsiveCss).toContain("button:active { transform: none !important; }");
    expect(responsiveCss).toMatch(/\.spin, \.picker-spinner, \.profile-skills\.loading::after, \.terminal-image-paste-status svg \{ animation: none !important; \}/);
    expect(responsiveCss).toMatch(/::view-transition-group\(\*\), ::view-transition-old\(\*\), ::view-transition-new\(\*\) \{ animation: none !important; \}/);
    expect(responsiveCss).not.toMatch(/\*, \*::before, \*::after \{[^}]*transform: none/s);
  });

  it("keeps global scale tokens dynamic without shrinking interaction targets", () => {
    expect(shadcnCss).toMatch(/@theme inline \{[\s\S]*--spacing: calc\(0\.25rem \* var\(--app-ui-scale\)\);/);
    expect(shadcnCss).toMatch(/@theme inline \{[\s\S]*--text-sm: calc\(0\.875rem \* var\(--app-font-scale\)\);/);
    expect(shadcnCss).toMatch(/@layer utilities \{[\s\S]*?\[data-slot="button"\],\s*\[data-slot="dropdown-menu-trigger"\] \{[^}]*min-width: 40px;[^}]*min-height: 40px;/);
    expect(shadcnCss).toMatch(/\[data-settings-section-link\] \{\s*min-height: 40px;/);
    expect(shadcnCss).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\[data-slot="button"\],\s*\[data-slot="dropdown-menu-trigger"\] \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  });
});
