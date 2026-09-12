import { describe, expect, it, vi } from "vitest";
import { clampTerminalWorkspaceCapacity, minimizeTerminal, readTerminalThumbnailsAutoHide, reconcileTerminalWorkspaceDock, resizeTerminalWorkspaceDock, retainTerminalSurfaces, stageTerminal, TERMINAL_THUMBNAILS_AUTO_HIDE_STORAGE_KEY, terminalSurfaceIds, terminalViewTransitionName, writeTerminalThumbnailsAutoHide } from "./terminalWorkspaceDock";

const state = (stagedIds: string[], minimizedIds: string[] = []) => ({ stagedIds, minimizedIds });

describe("terminal thumbnail auto-hide preference", () => {
  it("defaults to disabled and reads only the enabled value", () => {
    expect(readTerminalThumbnailsAutoHide({ getItem: () => null })).toBe(false);
    expect(readTerminalThumbnailsAutoHide({ getItem: () => "0" })).toBe(false);
    expect(readTerminalThumbnailsAutoHide({ getItem: () => "invalid" })).toBe(false);
    expect(readTerminalThumbnailsAutoHide({ getItem: () => "1" })).toBe(true);
  });

  it("persists enabled and disabled values", () => {
    const setItem = vi.fn();
    writeTerminalThumbnailsAutoHide(true, { setItem });
    writeTerminalThumbnailsAutoHide(false, { setItem });
    expect(setItem).toHaveBeenNthCalledWith(1, TERMINAL_THUMBNAILS_AUTO_HIDE_STORAGE_KEY, "1");
    expect(setItem).toHaveBeenNthCalledWith(2, TERMINAL_THUMBNAILS_AUTO_HIDE_STORAGE_KEY, "0");
  });

  it("survives unavailable storage", () => {
    expect(readTerminalThumbnailsAutoHide({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(() => writeTerminalThumbnailsAutoHide(true, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(readTerminalThumbnailsAutoHide()).toBe(false);
      expect(() => writeTerminalThumbnailsAutoHide(true)).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

describe("terminal workspace dock", () => {
  it("creates stable valid transition names from terminal identities", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000/终端";
    const name = terminalViewTransitionName(id);
    expect(terminalViewTransitionName(id)).toBe(name);
    expect(terminalViewTransitionName(`${id}-other`)).not.toBe(name);
    expect(name).toMatch(/^terminal-pane-[0-9a-f]{16}$/);
  });

  it("orders visible workspace surfaces with staged surfaces first", () => {
    expect(terminalSurfaceIds(true, { workspaceId: null, ids: [] }, "workspace", state(["b", "a"], ["c"]), ["a", "b", "c", "d"])).toEqual(["b", "a", "c", "d"]);
    expect(terminalSurfaceIds(true, { workspaceId: "other", ids: ["outside"] }, "workspace", state(["gone", "a"], ["b"]), ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("keeps only retained surfaces from the selected workspace while hidden", () => {
    expect(terminalSurfaceIds(false, { workspaceId: null, ids: [] }, "workspace", state(["a"]), ["a", "b"])).toEqual([]);
    expect(terminalSurfaceIds(false, { workspaceId: "workspace", ids: ["b", "a", "removed"] }, "workspace", state(["a"]), ["a", "b", "new"])).toEqual(["b", "a"]);
    expect(terminalSurfaceIds(false, { workspaceId: "other", ids: ["a"] }, "workspace", state(["a"]), ["a", "b"])).toEqual([]);
  });

  it("retains staged surfaces across a hidden round trip", () => {
    const initial = { workspaceId: null, ids: [] };
    const mounted = retainTerminalSurfaces(true, initial, "workspace", state(["a", "b"]), ["a", "b", "thumbnail"]);
    expect(mounted).toEqual({ workspaceId: "workspace", ids: ["a", "b"] });
    expect(terminalSurfaceIds(false, mounted, "workspace", state(["a", "b"]), ["a", "b", "thumbnail"])).toEqual(["a", "b"]);

    const pruned = retainTerminalSurfaces(false, mounted, "workspace", state(["a"]), ["a", "thumbnail"]);
    expect(pruned).toEqual({ workspaceId: "workspace", ids: ["a"] });
    expect(retainTerminalSurfaces(false, pruned, "other", state(["other"]), ["other"])).toEqual({ workspaceId: "other", ids: [] });
  });

  it("appends a restored terminal", () => {
    expect(stageTerminal(state(["a"]), "b", "a", 2)).toEqual(state(["a", "b"]));
  });

  it("supports four staged terminals", () => {
    expect(clampTerminalWorkspaceCapacity(4)).toBe(4);
    expect(clampTerminalWorkspaceCapacity(8)).toBe(4);
    expect(stageTerminal(state(["a", "b", "c"]), "d", "a", 4)).toEqual(state(["a", "b", "c", "d"]));
  });

  it("does not reorder an already staged terminal when activated", () => {
    expect(stageTerminal(state(["a", "b", "c"]), "b", "a", 3)).toEqual(state(["a", "b", "c"]));
  });

  it("evicts the oldest non-active terminal at capacity", () => {
    expect(stageTerminal(state(["a", "b"]), "c", "a", 2)).toEqual(state(["a", "c"]));
  });

  it("keeps the active terminal when capacity shrinks", () => {
    expect(resizeTerminalWorkspaceDock(state(["a", "b", "c"]), 2, "a")).toEqual(state(["a", "c"]));
  });

  it("filters state to workspace members", () => {
    expect(reconcileTerminalWorkspaceDock(state(["a", "outside"], ["gone"]), ["a", "b"], "b", 3)).toEqual(state(["a", "b"]));
  });

  it("does not immediately restore an explicitly minimized active terminal", () => {
    const minimized = minimizeTerminal(state(["a", "b"]), "a");
    expect(reconcileTerminalWorkspaceDock(minimized, ["a", "b"], "a", 2)).toEqual(state(["b"], ["a"]));
  });

  it("restores a minimized terminal explicitly", () => {
    expect(stageTerminal(state(["b"], ["a"]), "a", "a", 2)).toEqual(state(["b", "a"]));
  });
});
