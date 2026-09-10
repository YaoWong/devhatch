import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAuth } from "./client";
import { createLaunchPath, deleteLaunchPath, launchPaths, updateLaunchPath } from "./workspaces";

const path = {
  id: "path/id",
  path: "/repo",
  alias: null,
  pinned: false,
  lastUsedAt: 1,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  configureAuth(null);
  vi.unstubAllGlobals();
});

describe("launch paths API", () => {
  it("uses only the unified launch path routes and response shape", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ launchPaths: [path] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ launchPath: path }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ launchPath: { ...path, pinned: true } })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    configureAuth("csrf-token");

    await expect(launchPaths()).resolves.toEqual({ launchPaths: [path] });
    await expect(createLaunchPath("/repo")).resolves.toEqual({ launchPath: path });
    await expect(updateLaunchPath("path/id", { pinned: true })).resolves.toEqual({
      launchPath: { ...path, pinned: true },
    });
    await expect(deleteLaunchPath("path/id")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/launch-paths",
      "/api/launch-paths",
      "/api/launch-paths/path%2Fid",
      "/api/launch-paths/path%2Fid",
    ]);
    expect(fetchMock.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });
});
