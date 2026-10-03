import { describe, expect, it } from "vitest";
import { formatAgentVersion } from "./versionDisplay";

describe("formatAgentVersion", () => {
  it.each([
    ["2.0.20", "v2.0.20"],
    ["v2.0.20", "v2.0.20"],
    ["V2.0.20", "v2.0.20"],
    ["vv2.0.20", "v2.0.20"],
  ])("normalizes %s to %s", (version, expected) => {
    expect(formatAgentVersion(version)).toBe(expected);
  });
});
