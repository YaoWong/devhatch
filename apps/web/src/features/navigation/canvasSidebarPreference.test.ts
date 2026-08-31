import { describe, expect, it, vi } from "vitest";
import { CANVAS_SIDEBAR_PINNED_KEY, readCanvasSidebarPinned, writeCanvasSidebarPinned } from "./canvasSidebarPreference";

describe("canvas sidebar preference", () => {
  it("defaults to pinned and reads an explicit unpinned value", () => {
    expect(readCanvasSidebarPinned({ getItem: () => null })).toBe(true);
    expect(readCanvasSidebarPinned({ getItem: () => "0" })).toBe(false);
  });

  it("survives unavailable storage", () => {
    expect(readCanvasSidebarPinned({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
    expect(() => writeCanvasSidebarPinned(false, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("does not access global storage when storage is injected", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const getter = vi.fn(() => { throw new Error("unexpected access"); });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: getter });
    try {
      expect(readCanvasSidebarPinned({ getItem: () => "0" })).toBe(false);
      writeCanvasSidebarPinned(true, { setItem: vi.fn() });
      expect(getter).not.toHaveBeenCalled();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("persists only the pinned choice", () => {
    const setItem = vi.fn();
    writeCanvasSidebarPinned(false, { setItem });
    expect(setItem).toHaveBeenCalledWith(CANVAS_SIDEBAR_PINNED_KEY, "0");
  });
});
