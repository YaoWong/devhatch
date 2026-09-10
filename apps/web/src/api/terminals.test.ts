import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAuth } from "./client";
import { createTerminal } from "./terminals";

afterEach(() => {
  configureAuth(null);
  vi.unstubAllGlobals();
});

describe("terminal launch API", () => {
  it("sends the selected launch config with an explicit path", async () => {
    const response = {
      terminal: { id: "terminal-1", kind: "terminal" },
      workspace: { id: "workspace-1" },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createTerminal("/repo", "workspace-1", "terminal-config")).resolves.toEqual(response);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/terminals");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({
      cwd: "/repo",
      workspaceId: "workspace-1",
      launchConfigId: "terminal-config",
    });
  });
});
