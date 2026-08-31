import { describe, expect, it } from "vitest";
import { clampTerminalWorkspaceCapacity, minimizeTerminal, reconcileTerminalWorkspaceDock, resizeTerminalWorkspaceDock, stageTerminal, terminalViewTransitionName } from "./terminalWorkspaceDock";

const state = (stagedIds: string[], minimizedIds: string[] = []) => ({ stagedIds, minimizedIds });

describe("terminal workspace dock", () => {
  it("creates stable valid transition names from terminal identities", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000/终端";
    const name = terminalViewTransitionName(id);
    expect(terminalViewTransitionName(id)).toBe(name);
    expect(terminalViewTransitionName(`${id}-other`)).not.toBe(name);
    expect(name).toMatch(/^terminal-pane-[0-9a-f]{16}$/);
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
