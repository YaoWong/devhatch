import { describe, expect, it, vi } from "vitest";
import { clampTerminalLayoutCut, createTerminalLayoutDrag, defaultTerminalLayoutRatios, terminalLayoutPresets, terminalLayoutWeights } from "./terminalWorkspaceLayout";

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
