import { describe, expect, it, vi } from "vitest";
import {
  LAUNCH_TARGET_ID_KEY,
  readLaunchConfigId,
  readLaunchTargetId,
  TERMINAL_LAUNCH_TARGET_ID,
  writeLaunchConfigId,
  writeLaunchTargetId,
} from "./launchSetupPreference";

describe("launch setup preferences", () => {
  it("defaults the launch target to Terminal", () => {
    expect(readLaunchTargetId({ getItem: () => null })).toBe(TERMINAL_LAUNCH_TARGET_ID);
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
