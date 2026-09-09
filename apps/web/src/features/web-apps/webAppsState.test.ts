import { describe, expect, it } from "vitest";
import type { WebApp } from "../../types/web-apps";
import { preserveWebAppsReference } from "./webAppsState";

const webApp = (overrides: Partial<WebApp> = {}): WebApp => ({
  id: "open-design",
  name: "OpenDesign",
  description: "Design app",
  installed: true,
  installing: false,
  updating: false,
  checkingForUpdate: false,
  operation: null,
  updateAvailable: false,
  progress: 0,
  downloadedBytes: null,
  totalBytes: null,
  running: false,
  phase: "stopped",
  version: "1.0.0",
  currentRevision: "current",
  remoteRevision: "current",
  latestVersion: "1.0.0",
  url: null,
  installPath: "/tmp/open-design",
  error: null,
  prerequisites: { git: true, node24: true, corepack: true },
  ...overrides,
});

describe("web apps state", () => {
  it("preserves the array reference for an equivalent payload", () => {
    const current = [webApp()];
    const next = [webApp()];

    expect(preserveWebAppsReference(current, next)).toBe(current);
  });

  it("uses the new array when app state or order changes", () => {
    const current = [webApp(), webApp({ id: "other" })];
    const changed = [webApp({ running: true, phase: "running" }), webApp({ id: "other" })];
    const reordered = [...current].reverse();

    expect(preserveWebAppsReference(current, changed)).toBe(changed);
    expect(preserveWebAppsReference(current, reordered)).toBe(reordered);
  });

  it("detects nested prerequisite changes", () => {
    const current = [webApp()];
    const next = [webApp({ prerequisites: { git: false, node24: true, corepack: true } })];

    expect(preserveWebAppsReference(current, next)).toBe(next);
  });
});
