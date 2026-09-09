import { describe, expect, it } from "vitest";
import { resolveScrollEdges } from "./scrollEdges";

describe("scroll edges", () => {
  it("preserves the current state when the edges are unchanged", () => {
    const current = { top: false, bottom: false };

    expect(resolveScrollEdges(current, { scrollTop: 20, clientHeight: 100, scrollHeight: 200 })).toBe(current);
  });

  it("returns a new state when an edge changes", () => {
    const current = { top: false, bottom: false };

    expect(resolveScrollEdges(current, { scrollTop: 100, clientHeight: 100, scrollHeight: 200 })).toEqual({
      top: false,
      bottom: true,
    });
  });

  it("uses the one-pixel edge tolerance", () => {
    const current = { top: false, bottom: false };

    expect(resolveScrollEdges(current, { scrollTop: 1, clientHeight: 100, scrollHeight: 102 })).toEqual({
      top: true,
      bottom: true,
    });
  });
});
