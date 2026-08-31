import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_ID_KEY, readDefaultAgentId, writeDefaultAgentId } from "./defaultAgentPreference";

describe("default agent preference", () => {
  it("defaults to no preference and reads the stored agent", () => {
    expect(readDefaultAgentId({ getItem: () => null })).toBeNull();
    expect(readDefaultAgentId({ getItem: () => "opencode" })).toBe("opencode");
  });

  it("survives unavailable storage", () => {
    expect(readDefaultAgentId({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(() => writeDefaultAgentId("codex", { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("persists the selected agent", () => {
    const setItem = vi.fn();
    writeDefaultAgentId("pi", { setItem });
    expect(setItem).toHaveBeenCalledWith(DEFAULT_AGENT_ID_KEY, "pi");
  });
});
