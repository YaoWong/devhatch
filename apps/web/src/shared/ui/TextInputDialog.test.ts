import { describe, expect, it } from "vitest";
import { focusTrapTarget } from "./focusTrap";

describe("text input dialog focus trap", () => {
  const elements = ["input", "cancel", "save"];

  it("wraps forward focus from the last element", () => {
    expect(focusTrapTarget(elements, "save", false)).toBe("input");
  });

  it("wraps backward focus from the first element", () => {
    expect(focusTrapTarget(elements, "input", true)).toBe("save");
  });

  it("captures focus outside the dialog", () => {
    expect(focusTrapTarget(elements, "outside", false)).toBe("input");
    expect(focusTrapTarget(elements, "outside", true)).toBe("save");
  });

  it("leaves interior focus movement to the browser", () => {
    expect(focusTrapTarget(elements, "cancel", false)).toBeNull();
    expect(focusTrapTarget(elements, "cancel", true)).toBeNull();
  });

  it("handles a dialog without focusable elements", () => {
    expect(focusTrapTarget([], null, false)).toBeNull();
  });
});
