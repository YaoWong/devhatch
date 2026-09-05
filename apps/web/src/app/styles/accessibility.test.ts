import { describe, expect, it } from "vitest";
import terminalSurfaceSource from "../../shared/terminal/TerminalSurface.tsx?raw";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const responsiveCss = readFileSync(new URL("./responsive.css", import.meta.url), "utf8");
const shadcnCss = readFileSync(new URL("./shadcn.css", import.meta.url), "utf8");
const terminalCss = readFileSync(new URL("./terminal.css", import.meta.url), "utf8");

describe("terminal accessibility styles", () => {
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
    expect(shadcnCss).toMatch(/@layer utilities \{[\s\S]*?\[data-slot="button"\] \{[^}]*min-width: 40px;[^}]*min-height: 40px;/);
    expect(shadcnCss).toMatch(/\[data-settings-section-link\] \{\s*min-height: 40px;/);
    expect(shadcnCss).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?\[data-slot="button"\] \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
  });
});
