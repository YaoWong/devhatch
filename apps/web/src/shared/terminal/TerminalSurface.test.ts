import { describe, expect, it, vi } from "vitest";
import { terminalSocketPath } from "./socketConnection";
import { applyTerminalTheme } from "./terminalThemes";

describe("terminal transport", () => {
  it("encodes the raw session id without a composite prefix", () => {
    expect(terminalSocketPath("/api/agent-sessions", "same/id")).toBe("/api/agent-sessions/same%2Fid/socket");
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
