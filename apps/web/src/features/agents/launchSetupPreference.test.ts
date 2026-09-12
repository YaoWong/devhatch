import { describe, expect, it, vi } from "vitest";
import type { Agent } from "../../types/agents";
import {
  LAUNCH_TARGET_ID_KEY,
  readLaunchConfigId,
  readLaunchTargetId,
  readStoredLaunchTargetId,
  resolveInitialLaunchTargetId,
  TERMINAL_LAUNCH_TARGET_ID,
  writeLaunchConfigId,
  writeLaunchTargetId,
} from "./launchSetupPreference";

const agent = (id: string, available = true, enabled = true, availability: Agent["availability"] = available ? "available" : "unavailable"): Agent => ({
  id,
  name: id,
  kind: "cli",
  available,
  enabled,
  availability,
  installable: !available,
  launchConfigCount: 1,
  defaultLaunchConfigId: `${id}-default`,
  supportsHistory: true,
  supportsResume: true,
  supportsSkills: true,
  supportsImagePaste: true,
});

describe("launch setup preferences", () => {
  it("defaults the launch target to Terminal", () => {
    expect(readStoredLaunchTargetId({ getItem: () => null })).toBeNull();
    expect(readLaunchTargetId({ getItem: () => null })).toBe(TERMINAL_LAUNCH_TARGET_ID);
  });

  it("uses the default agent only when there is no valid explicit target", () => {
    const agents = [agent("opencode"), agent("pi"), agent("soon", false, true, "coming-soon")];
    expect(resolveInitialLaunchTargetId(agents, null, "opencode")).toBe("opencode");
    expect(resolveInitialLaunchTargetId(agents, TERMINAL_LAUNCH_TARGET_ID, "opencode")).toBe(TERMINAL_LAUNCH_TARGET_ID);
    expect(resolveInitialLaunchTargetId(agents, "pi", "opencode")).toBe("pi");
    expect(resolveInitialLaunchTargetId(agents, "soon", "opencode")).toBe("opencode");
    expect(resolveInitialLaunchTargetId(agents, "missing", "missing")).toBe(TERMINAL_LAUNCH_TARGET_ID);
  });

  it("keeps an explicitly selected installable agent", () => {
    expect(resolveInitialLaunchTargetId([agent("codex", false)], "codex", null)).toBe("codex");
  });

  it("persists the launch target and each target config independently", () => {
    const setItem = vi.fn();
    writeLaunchTargetId("opencode", { setItem });
    writeLaunchConfigId("terminal", "terminal-default", { setItem });
    writeLaunchConfigId("opencode", "opencode-fast", { setItem });

    expect(setItem).toHaveBeenNthCalledWith(1, LAUNCH_TARGET_ID_KEY, "opencode");
    expect(setItem).toHaveBeenNthCalledWith(2, "devhatch-launch-config-id:terminal", "terminal-default");
    expect(setItem).toHaveBeenNthCalledWith(3, "devhatch-launch-config-id:opencode", "opencode-fast");
    expect(readLaunchConfigId("terminal", { getItem: (key) => key.endsWith(":terminal") ? "terminal-default" : null })).toBe("terminal-default");
  });

  it("survives unavailable storage", () => {
    const blockedRead = { getItem: () => { throw new Error("blocked"); } };
    const blockedWrite = { setItem: () => { throw new Error("blocked"); } };
    expect(readLaunchTargetId(blockedRead)).toBe(TERMINAL_LAUNCH_TARGET_ID);
    expect(readLaunchConfigId("terminal", blockedRead)).toBeNull();
    expect(() => writeLaunchTargetId("terminal", blockedWrite)).not.toThrow();
    expect(() => writeLaunchConfigId("terminal", "default", blockedWrite)).not.toThrow();
  });
});
