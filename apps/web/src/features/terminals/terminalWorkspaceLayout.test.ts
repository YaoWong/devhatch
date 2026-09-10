import { describe, expect, it, vi } from "vitest";
import { AGENT_WORKSPACE_LAYOUT_STORAGE_KEY, clampTerminalLayoutCut, createTerminalLayoutDrag, defaultTerminalLayoutRatios, migrateWorkspaceLayouts, readWorkspaceLayouts, TERMINAL_WORKSPACE_LAYOUT_STORAGE_KEY, terminalLayoutPresets, terminalLayoutWeights, WORKSPACE_LAYOUT_STORAGE_KEY } from "./terminalWorkspaceLayout";

describe("terminal workspace layouts", () => {
  it("provides presets for every multi-terminal count", () => {
    expect(terminalLayoutPresets(2)).toEqual(["columns", "rows"]);
    expect(terminalLayoutPresets(3)).toEqual(["main-left", "main-right", "columns", "rows"]);
    expect(terminalLayoutPresets(4)).toEqual(["grid", "columns", "rows"]);
  });

  it("converts divider cuts into grid weights", () => {
    expect(terminalLayoutWeights([0.25, 0.5, 0.75])).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("keeps divider cuts between adjacent panes", () => {
    const cuts = defaultTerminalLayoutRatios(4, "columns");
    expect(clampTerminalLayoutCut(cuts, 1, 0.1, 0.2)).toBe(0.45);
    expect(clampTerminalLayoutCut(cuts, 1, 0.9, 0.2)).toBe(0.55);
  });

  it("namespaces legacy layouts and prefers terminal values on collisions", () => {
    const terminal = { presets: { 2: "columns" as const }, ratios: {} };
    const agent = { presets: { 2: "rows" as const }, ratios: {} };
    expect(migrateWorkspaceLayouts({ same: terminal }, { same: agent })).toEqual({
      "terminal:same": terminal,
      "agent:same": agent,
    });
  });

  it("merges missing legacy layouts without overwriting current values", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const values = new Map<string, string>([
      [TERMINAL_WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify({ shared: { presets: { 2: "columns" }, ratios: {} } })],
      [AGENT_WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify({ shared: { presets: { 2: "rows" }, ratios: {} } })],
      [WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify({ "terminal:shared": { presets: { 2: "rows" }, ratios: {} } })],
    ]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (key: string) => values.get(key) ?? null },
    });
    try {
      expect(readWorkspaceLayouts()).toEqual({
        "terminal:shared": { presets: { 2: "rows" }, ratios: {} },
        "agent:shared": { presets: { 2: "rows" }, ratios: {} },
      });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("coalesces drag previews by animation frame and commits only the final ratio", () => {
    const frames: Array<() => void> = [];
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const drag = createTerminalLayoutDrag({
      initialRatios: [0.25, 0.5, 0.75],
      ratioIndex: 1,
      clamp: (value) => Math.min(0.7, Math.max(0.3, value)),
      onPreview,
      onCommit,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame: vi.fn(),
    });

    drag.preview(0.55);
    drag.preview(0.6);

    expect(frames).toHaveLength(1);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    frames[0]();

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenLastCalledWith([0.25, 0.6, 0.75]);

    drag.finish(0.65);

    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith([0.25, 0.65, 0.75]);
  });

  it("cancels a drag without committing and clears a pending preview", () => {
    const frames: Array<() => void> = [];
    const cancelFrame = vi.fn();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const drag = createTerminalLayoutDrag({
      initialRatios: [0.5],
      ratioIndex: 0,
      clamp: (value) => value,
      onPreview,
      onCommit,
      scheduleFrame: (callback) => frames.push(callback),
      cancelFrame,
    });

    drag.preview(0.7);
    frames[0]();
    drag.preview(0.8);
    drag.cancel();
    frames[1]();

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview).toHaveBeenNthCalledWith(1, [0.7]);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
