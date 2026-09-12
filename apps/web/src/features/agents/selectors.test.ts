import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../../types/agents";
import { agentHistoryPollDelay, replaceAgentSessions, runWhenVisible, sameAgentSessions, shouldShowAgentSessionSearch, subscribeVisiblePolling } from "./selectors";

const session = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: "session-1",
  agentId: "opencode",
  agentName: "OpenCode",
  kind: "agent",
  name: "Session",
  cwd: "/tmp",
  shell: "sh",
  status: "running",
  cols: 80,
  rows: 24,
  createdAt: 1,
  updatedAt: 1,
  exitCode: null,
  ...overrides,
});

describe("agent session selectors", () => {
  it("shows search for large session collections", () => {
    expect(shouldShowAgentSessionSearch(5, 3, "")).toBe(true);
  });

  it("keeps an active search visible below the collection threshold", () => {
    expect(shouldShowAgentSessionSearch(2, 1, "  query  ")).toBe(true);
  });

  it("chooses history polling from semantic session state", () => {
    expect(agentHistoryPollDelay(false, "opencode", true)).toBeNull();
    expect(agentHistoryPollDelay(true, null, true)).toBeNull();
    expect(agentHistoryPollDelay(true, "opencode", false)).toBe(10000);
    expect(agentHistoryPollDelay(true, "opencode", true)).toBe(1000);
  });

  it("polls only while visible and refreshes when visibility returns", () => {
    let visibilityState: DocumentVisibilityState = "hidden";
    const visibilityListeners: Array<() => void> = [];
    const intervalCallbacks = new Map<number, () => void>();
    const target = {
      get visibilityState() { return visibilityState; },
      addEventListener: (_type: "visibilitychange", listener: () => void) => { visibilityListeners.push(listener); },
      removeEventListener: (_type: "visibilitychange", listener: () => void) => {
        const index = visibilityListeners.indexOf(listener);
        if (index >= 0) visibilityListeners.splice(index, 1);
      },
    };
    const scheduler = {
      setInterval: vi.fn((callback: () => void) => {
        intervalCallbacks.set(1, callback);
        return 1;
      }),
      clearInterval: vi.fn((handle: number) => { intervalCallbacks.delete(handle); }),
    };
    const refresh = vi.fn();

    const unsubscribe = subscribeVisiblePolling(target, scheduler, refresh, 5000, true);
    expect(refresh).not.toHaveBeenCalled();
    expect(scheduler.setInterval).not.toHaveBeenCalled();

    visibilityState = "visible";
    visibilityListeners[0]?.();
    expect(refresh).toHaveBeenCalledOnce();
    expect(scheduler.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);

    intervalCallbacks.get(1)?.();
    expect(refresh).toHaveBeenCalledTimes(2);

    visibilityState = "hidden";
    const queuedInterval = intervalCallbacks.get(1);
    visibilityListeners[0]?.();
    expect(scheduler.clearInterval).toHaveBeenCalledWith(1);
    queuedInterval?.();
    expect(refresh).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(visibilityListeners).toHaveLength(0);
  });

  it("gates event-driven work by current visibility", () => {
    const target = { visibilityState: "hidden" as DocumentVisibilityState };
    const refresh = vi.fn(() => Promise.resolve());

    expect(runWhenVisible(target, refresh)).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();

    target.visibilityState = "visible";
    expect(runWhenVisible(target, refresh)).toBeInstanceOf(Promise);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("can schedule a visible poll without an initial refresh", () => {
    const listeners: Array<() => void> = [];
    const target = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_type: "visibilitychange", listener: () => void) => { listeners.push(listener); },
      removeEventListener: (_type: "visibilitychange", listener: () => void) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
    const scheduler = { setInterval: vi.fn(() => 2), clearInterval: vi.fn() };
    const refresh = vi.fn();

    const unsubscribe = subscribeVisiblePolling(target, scheduler, refresh, 5000, false);

    expect(refresh).not.toHaveBeenCalled();
    expect(scheduler.setInterval).toHaveBeenCalledWith(expect.any(Function), 5000);
    unsubscribe();
    expect(listeners).toHaveLength(0);
  });

  it("preserves equivalent session snapshots despite output timestamps", () => {
    const current = [session()];
    expect(sameAgentSessions(current, [{ ...current[0], updatedAt: 2 }])).toBe(true);
    expect(sameAgentSessions(current, [{ ...current[0], upstreamSessionId: "upstream" }])).toBe(false);
    expect(sameAgentSessions(current, [session({ id: "session-2" })])).toBe(false);
  });

  it("replaces titles only for the selected agent when raw IDs collide", () => {
    const selected = session({ name: "Updated" });
    const other = session({ agentId: "codex", agentName: "Codex", name: "Original" });
    expect(replaceAgentSessions([other, session()], "opencode", [selected])).toEqual([other, selected]);
  });

  it("hides an empty search for small session collections", () => {
    expect(shouldShowAgentSessionSearch(3, 4, "   ")).toBe(false);
  });
});
