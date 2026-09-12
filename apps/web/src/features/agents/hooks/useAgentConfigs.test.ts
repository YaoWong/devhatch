import { describe, expect, it } from "vitest";
import type { LaunchConfig } from "../../../types/agents";
import { launchConfigSelection } from "./useAgentConfigs";

const config = (id: string, isDefault = false): LaunchConfig => ({
  id,
  agentId: "terminal",
  name: id,
  isDefault,
  preLaunchScript: "",
  providerScript: "",
  tuiScript: "",
  createdAt: 1,
  updatedAt: 1,
});

describe("launch config selection", () => {
  it("uses a remembered config when it is still available", () => {
    expect(launchConfigSelection([config("default", true), config("remembered")], "remembered")).toBe("remembered");
  });

  it("falls back to the default, then the first config", () => {
    expect(launchConfigSelection([config("first"), config("default", true)], "missing")).toBe("default");
    expect(launchConfigSelection([config("first"), config("second")], null)).toBe("first");
    expect(launchConfigSelection([], null)).toBeNull();
  });
});
