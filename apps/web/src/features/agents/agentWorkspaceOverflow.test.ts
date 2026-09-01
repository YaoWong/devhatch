import { describe, expect, it } from "vitest";
import { selectVisibleWorkspaceIndexes } from "./agentWorkspaceOverflow";

describe("agent workspace overflow", () => {
  it("keeps all workspaces visible when they fit", () => {
    expect(selectVisibleWorkspaceIndexes([40, 50, 60], 158, 1)).toEqual({ visible: [0, 1, 2], overflow: [] });
  });

  it("moves workspaces that do not fit into overflow", () => {
    expect(selectVisibleWorkspaceIndexes([60, 60, 60], 124, 0)).toEqual({ visible: [0, 1], overflow: [2] });
  });

  it("swaps the selected workspace into narrow visible space", () => {
    expect(selectVisibleWorkspaceIndexes([60, 60, 60], 64, 2)).toEqual({ visible: [2], overflow: [0, 1] });
  });

  it("keeps a selected workspace visible when space is narrower than its tab", () => {
    expect(selectVisibleWorkspaceIndexes([60, 80, 70], 24, 1)).toEqual({ visible: [1], overflow: [0, 2] });
  });

  it("supports unlimited workspace arrays", () => {
    const widths = Array.from({ length: 1000 }, () => 20);
    const result = selectVisibleWorkspaceIndexes(widths, 68, 999);
    expect(result.visible).toContain(999);
    expect(result.visible.length + result.overflow.length).toBe(1000);
    expect(new Set([...result.visible, ...result.overflow]).size).toBe(1000);
  });

  it("handles empty and zero-width space", () => {
    expect(selectVisibleWorkspaceIndexes([], 100, -1)).toEqual({ visible: [], overflow: [] });
    expect(selectVisibleWorkspaceIndexes([40, 40], 0, 1)).toEqual({ visible: [], overflow: [0, 1] });
  });
});
