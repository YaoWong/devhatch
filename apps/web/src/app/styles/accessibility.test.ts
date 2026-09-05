import { describe, expect, it } from "vitest";
import terminalSurfaceSource from "../../shared/terminal/TerminalSurface.tsx?raw";

const { readFileSync } = (globalThis as typeof globalThis & {
  process: { getBuiltinModule: (name: "node:fs") => { readFileSync: (url: URL, encoding: "utf8") => string } };
}).process.getBuiltinModule("node:fs");
const responsiveCss = readFileSync(new URL("./responsive.css", import.meta.url), "utf8");
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
});
