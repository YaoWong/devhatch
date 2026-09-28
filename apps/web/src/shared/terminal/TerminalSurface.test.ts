import { describe, expect, it, vi } from "vitest";
import terminalSurfaceSource from "./TerminalSurface.tsx?raw";
import { shouldCopyTerminalSelection, terminalKeyInput, terminalSocketPath } from "./socketConnection";
import { applyTerminalTheme } from "./terminalThemes";

describe("terminal transport", () => {
  it("encodes the raw session id without a composite prefix", () => {
    expect(terminalSocketPath("/api/agent-sessions", "same/id")).toBe("/api/agent-sessions/same%2Fid/socket");
  });

  it("copies a terminal selection without replacing Ctrl+C interrupt behavior", () => {
    const copy = {
      type: "keydown",
      key: "c",
      shiftKey: false,
      altKey: false,
      ctrlKey: true,
      metaKey: false,
    } as const;

    expect(shouldCopyTerminalSelection(true, copy)).toBe(true);
    expect(shouldCopyTerminalSelection(false, copy)).toBe(false);
    expect(shouldCopyTerminalSelection(true, { ...copy, metaKey: true, ctrlKey: false })).toBe(true);
    expect(shouldCopyTerminalSelection(true, { ...copy, key: "C", shiftKey: true })).toBe(false);
    expect(shouldCopyTerminalSelection(true, { ...copy, type: "keyup" })).toBe(false);
  });

  it("encodes Shift+Enter for OpenCode multiline input", () => {
    const shiftEnter = {
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    } as const;

    expect(terminalKeyInput("opencode", shiftEnter)).toBe("\x1b[13;2u");
    expect(terminalKeyInput("codex", shiftEnter)).toBeNull();
    expect(terminalKeyInput(null, shiftEnter)).toBeNull();
    expect(terminalKeyInput("opencode", { ...shiftEnter, shiftKey: false })).toBeNull();
    expect(terminalKeyInput("opencode", { ...shiftEnter, type: "keyup" })).toBeNull();
  });
});

describe("terminal renderer recovery", () => {
  it("refits, rebuilds the texture atlas, and repaints every row after reveal", () => {
    expect(terminalSurfaceSource).toContain("function refreshTerminalRenderer(");
    expect(terminalSurfaceSource).toContain("fit.fit();\n  terminal.clearTextureAtlas();\n  terminal.refresh(0, Math.max(0, terminal.rows - 1));");
    expect(terminalSurfaceSource).toContain("activateRef.current = () => {\n      recoverRenderer();");
  });

  it("disposes WebGL and repaints with the fallback renderer after context loss", () => {
    expect(terminalSurfaceSource).toContain("addon.onContextLoss(() => {");
    expect(terminalSurfaceSource).toContain("addon?.dispose();\n      addon = null;\n      terminal.refresh(0, Math.max(0, terminal.rows - 1));");
  });
});

describe("terminal theme", () => {
  it("repaints an existing terminal when the theme changes", () => {
    const options: { theme?: unknown } = {};
    const terminal = {
      options,
      rows: 24,
      clearTextureAtlas: vi.fn(),
      refresh: vi.fn(),
    } as unknown as Parameters<typeof applyTerminalTheme>[0];

    applyTerminalTheme(terminal, "mocha");

    expect(options.theme).toMatchObject({ background: "#1e1e2e", foreground: "#cdd6f4" });
    expect(terminal.clearTextureAtlas).toHaveBeenCalledOnce();
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
  });
});
