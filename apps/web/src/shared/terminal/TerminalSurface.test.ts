import { describe, expect, it, vi } from "vitest";
import { applyTerminalTheme } from "./terminalThemes";

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
