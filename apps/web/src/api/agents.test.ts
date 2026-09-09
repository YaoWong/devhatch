import { afterEach, describe, expect, it, vi } from "vitest";
import { installAgent } from "./agents";
import { configureAuth } from "./client";

afterEach(() => {
  configureAuth(null);
  vi.unstubAllGlobals();
});

describe("agent install API", () => {
  it("posts the encoded agent ID with CSRF and no client-selected package", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ agentInstall: { agentId: "opencode", version: "1.18.30" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    configureAuth("csrf-token");

    await expect(installAgent("opencode/test")).resolves.toEqual({
      agentInstall: { agentId: "opencode", version: "1.18.30" },
    });

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agents/opencode%2Ftest/install");
    expect(options.method).toBe("POST");
    expect(new Headers(options.headers).get("x-csrf-token")).toBe("csrf-token");
    expect(options.body).toBeUndefined();
  });
});
