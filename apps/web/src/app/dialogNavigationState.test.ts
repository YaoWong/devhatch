import { describe, expect, it, vi } from "vitest";
import { resolveDialogNavigationState, subscribeMobileNavigationLifecycle, type ConfirmAction } from "../types/app";

const sources = import.meta.glob("../**/*.{ts,tsx}", { eager: true, import: "default", query: "?raw" }) as Record<string, string>;

const confirmAction = (preserveMobileNavigation?: boolean): ConfirmAction => ({
  title: "Confirm",
  description: "Confirm action",
  confirmLabel: "Confirm",
  preserveMobileNavigation,
  action: () => true,
});

describe("dialog mobile navigation policy", () => {
  const cases: Array<[string, boolean, ConfirmAction | null, boolean, boolean, boolean]> = [
    ["no dialog", false, null, false, false, false],
    ["picker", true, null, false, true, true],
    ["session delete", false, null, true, true, true],
    ["ordinary confirmation", false, confirmAction(), false, true, true],
    ["preserved confirmation", false, confirmAction(true), false, true, false],
  ];

  it.each(cases)("handles %s", (_name, pickerOpen, action, sessionDeleteOpen, anyDialogOpen, requiresMobileNavigationClose) => {
    expect(resolveDialogNavigationState({ pickerOpen, confirmAction: action, sessionDeleteOpen })).toEqual({
      anyDialogOpen,
      requiresMobileNavigationClose,
    });
  });

  it("opts in only launch-config deletion", () => {
    const optIns = Object.entries(sources)
      .filter(([path]) => !path.endsWith("dialogNavigationState.test.ts"))
      .filter(([, source]) => /preserveMobileNavigation\s*:\s*true/.test(source))
      .map(([path]) => path);
    expect(optIns).toHaveLength(1);
    expect(optIns[0]).toMatch(/\/features\/agents\/AgentConfigDialog\.tsx$/);
  });

  it("synchronizes navigation on setup, media changes, restoration, and orientation changes", () => {
    const query = new EventTarget() as EventTarget & { matches: boolean };
    const lifecycle = new EventTarget();
    const onChange = vi.fn();
    query.matches = false;

    const cleanup = subscribeMobileNavigationLifecycle(query, lifecycle, onChange);
    expect(onChange).toHaveBeenLastCalledWith(false);

    query.matches = true;
    query.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenLastCalledWith(true);

    query.matches = false;
    lifecycle.dispatchEvent(new Event("pageshow"));
    expect(onChange).toHaveBeenLastCalledWith(false);

    query.matches = true;
    lifecycle.dispatchEvent(new Event("orientationchange"));
    expect(onChange).toHaveBeenLastCalledWith(true);

    cleanup();
    query.matches = false;
    query.dispatchEvent(new Event("change"));
    lifecycle.dispatchEvent(new Event("pageshow"));
    lifecycle.dispatchEvent(new Event("orientationchange"));
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("keeps the desktop edge target at least 40px and the coarse target at least 44px", () => {
    const appSource = Object.entries(sources).find(([path]) => path.endsWith("/App.tsx"))?.[1];
    expect(appSource).toMatch(/canvas-edge-trigger[^"\n]*\btw:size-10\b/);
    expect(appSource).toMatch(/canvas-edge-trigger[^"\n]*\btw:\[@media\(pointer:coarse\)\]:size-11\b/);
  });
});
