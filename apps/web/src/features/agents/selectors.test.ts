import { describe, expect, it } from "vitest";
import { shouldShowAgentSessionSearch } from "./selectors";

describe("agent session selectors", () => {
  it("shows search for large session collections", () => {
    expect(shouldShowAgentSessionSearch(5, 3, "")).toBe(true);
  });

  it("keeps an active search visible below the collection threshold", () => {
    expect(shouldShowAgentSessionSearch(2, 1, "  query  ")).toBe(true);
  });

  it("hides an empty search for small session collections", () => {
    expect(shouldShowAgentSessionSearch(3, 4, "   ")).toBe(false);
  });
});
