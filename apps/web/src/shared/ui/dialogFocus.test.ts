import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCanvasNavigationFocusFallback, resolveDialogFinalFocus } from "./dialogFocus";

type FocusTarget = HTMLElement & { display: string; visibility: string };

function target(display = "block", visibility = "visible") {
  return { display, visibility, isConnected: true, closest: () => null } as unknown as FocusTarget;
}

function installDocument(entries: Record<string, HTMLElement | null>) {
  const body = target();
  vi.stubGlobal("document", {
    body,
    querySelector: (selector: string) => entries[selector] ?? null,
  });
  vi.stubGlobal("getComputedStyle", (element: FocusTarget) => ({ display: element.display, visibility: element.visibility }));
  return body;
}

afterEach(() => vi.unstubAllGlobals());

describe("dialog focus", () => {
  it("prefers visible mobile and desktop navigation triggers", () => {
    const mobile = target();
    const edge = target();
    installDocument({ ".canvas-mobile-trigger": mobile, ".canvas-edge-trigger": edge });
    expect(resolveCanvasNavigationFocusFallback()).toBe(mobile);

    mobile.display = "none";
    expect(resolveCanvasNavigationFocusFallback()).toBe(edge);
  });

  it("falls back to the rail and then the document body", () => {
    const rail = target();
    installDocument({ ".rail:not([inert])": rail });
    expect(resolveCanvasNavigationFocusFallback()).toBe(rail);

    const fallbackBody = installDocument({});
    expect(resolveCanvasNavigationFocusFallback()).toBe(fallbackBody);
  });

  it("restores an eligible previous target", () => {
    const previous = target();
    installDocument({});
    expect(resolveDialogFinalFocus(previous)).toBe(previous);
  });

  it("rejects hidden or inert previous targets", () => {
    const edge = target();
    installDocument({ ".canvas-edge-trigger": edge });
    const previous = target("none");
    expect(resolveDialogFinalFocus(previous)).toBe(edge);

    previous.display = "block";
    previous.closest = (selector: string) => selector.includes("[inert]") ? previous : null;
    expect(resolveDialogFinalFocus(previous)).toBe(edge);
  });
});
