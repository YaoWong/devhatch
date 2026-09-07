import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAuth } from "./client";
import { getSupervisorStatus, installSupervisor } from "./supervisor";
import type { SupervisorStatus } from "../types/supervisor";

const supervisor: SupervisorStatus = {
  supported: true,
  available: true,
  installed: false,
  managed: false,
  enabled: false,
  active: false,
  currentProcessManaged: false,
  handoffPending: false,
  restartPending: false,
  overwriteRequired: false,
  state: "notInstalled",
  unitName: "devhatch.service",
  unitPath: "/home/dev/.config/systemd/user/devhatch.service",
  installRoot: "/home/dev/.local/lib/devhatch",
  byteApiKeyFile: null,
  lingerEnabled: true,
};

afterEach(() => {
  configureAuth(null);
  vi.unstubAllGlobals();
});

describe("supervisor API", () => {
  it("loads the supervisor response with an abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ supervisor }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(getSupervisorStatus(controller.signal)).resolves.toEqual(supervisor);
    expect(fetchMock).toHaveBeenCalledWith("/api/supervisor", { signal: controller.signal });
  });

  it("posts only the key file path and overwrite choice with CSRF", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ supervisor }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    configureAuth("csrf-token");

    const controller = new AbortController();
    await installSupervisor({ byteApiKeyFile: "/home/dev/.keys/byte-api", overwrite: true }, controller.signal);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/supervisor/install");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("content-type")).toBe("application/json");
    expect(new Headers(options.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(options.signal).toBe(controller.signal);
    expect(options.body).toBe(JSON.stringify({ byteApiKeyFile: "/home/dev/.keys/byte-api", overwrite: true }));
  });
});
