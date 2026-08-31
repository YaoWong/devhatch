export const CANVAS_SIDEBAR_PINNED_KEY = "devhatch-canvas-sidebar-pinned";

export function readCanvasSidebarPinned(storage?: Pick<Storage, "getItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    return target?.getItem(CANVAS_SIDEBAR_PINNED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeCanvasSidebarPinned(pinned: boolean, storage?: Pick<Storage, "setItem"> | null) {
  try {
    const target = storage === undefined ? globalThis.localStorage : storage;
    target?.setItem(CANVAS_SIDEBAR_PINNED_KEY, pinned ? "1" : "0");
  } catch {
    return;
  }
}
