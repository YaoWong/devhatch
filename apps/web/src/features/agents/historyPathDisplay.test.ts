import { describe, expect, it, vi } from "vitest";
import {
  AGENT_HISTORY_RELATIVE_PATHS_KEY,
  displayAgentHistoryPath,
  readAgentHistoryRelativePaths,
  writeAgentHistoryRelativePaths,
} from "./historyPathDisplay";

describe("agent history path display", () => {
  it("shows the selected path and its descendants relatively", () => {
    expect(displayAgentHistoryPath("/work/project", "/work/project", true)).toBe(".");
    expect(displayAgentHistoryPath("/work/project/src/components", "/work/project/", true)).toBe("src/components");
    expect(displayAgentHistoryPath("/work/project-two", "/work/project", true)).toBe("/work/project-two");
  });

  it("handles the root path without a leading slash", () => {
    expect(displayAgentHistoryPath("/work/project", "/", true)).toBe("work/project");
    expect(displayAgentHistoryPath("/", "/", true)).toBe(".");
  });

  it("matches logical and resolved home paths", () => {
    expect(displayAgentHistoryPath(
      "/resolved/home/work/project/src",
      "/home/user/work/project",
      true,
      "/home/user",
      "/resolved/home",
    )).toBe("src");
  });

  it("keeps the normal path display when relative paths are disabled or outside the selected path", () => {
    expect(displayAgentHistoryPath("/home/user/work/project", "/home/user/work", false, "/home/user", "/home/user")).toBe("~/work/project");
    expect(displayAgentHistoryPath("/home/user/other", "/home/user/work", true, "/home/user", "/home/user")).toBe("~/other");
  });

  it("defaults to relative paths and persists explicit choices", () => {
    expect(readAgentHistoryRelativePaths({ getItem: () => null })).toBe(true);
    expect(readAgentHistoryRelativePaths({ getItem: () => "0" })).toBe(false);

    const setItem = vi.fn();
    writeAgentHistoryRelativePaths(false, { setItem });
    writeAgentHistoryRelativePaths(true, { setItem });
    expect(setItem).toHaveBeenNthCalledWith(1, AGENT_HISTORY_RELATIVE_PATHS_KEY, "0");
    expect(setItem).toHaveBeenNthCalledWith(2, AGENT_HISTORY_RELATIVE_PATHS_KEY, "1");
  });

  it("survives unavailable storage", () => {
    expect(readAgentHistoryRelativePaths({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
    expect(() => writeAgentHistoryRelativePaths(false, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
