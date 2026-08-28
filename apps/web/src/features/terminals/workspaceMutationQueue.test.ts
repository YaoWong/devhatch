import { describe, expect, it } from "vitest";
import type { TerminalWorkspace } from "../../types/terminals";
import { getOrCreateInFlightPromise, mergeDeletedTerminal, mergeTerminalSession, mergeWorkspaceMembers, WorkspaceMutationQueue } from "./workspaceMutationQueue";

describe("getOrCreateInFlightPromise", () => {
  it("returns one promise for duplicate work and clears it after success", async () => {
    const inFlight = new Map<string, Promise<boolean>>();
    let release!: () => void;
    const task = () => new Promise<boolean>((resolve) => { release = () => resolve(true); });
    const first = getOrCreateInFlightPromise(inFlight, "session", task);
    const second = getOrCreateInFlightPromise(inFlight, "session", task);
    expect(second).toBe(first);
    expect(inFlight.get("session")).toBe(first);
    release();
    await expect(first).resolves.toBe(true);
    expect(inFlight.has("session")).toBe(false);
  });

  it("shares failures and clears only the current promise", async () => {
    const inFlight = new Map<string, Promise<boolean>>();
    let reject!: (reason: Error) => void;
    const failure = new Error("failed");
    const first = getOrCreateInFlightPromise(inFlight, "session", () => new Promise<boolean>((_, rejectPromise) => { reject = rejectPromise; }));
    const second = getOrCreateInFlightPromise(inFlight, "session", async () => true);
    const replacement = Promise.resolve(true);
    inFlight.set("session", replacement);
    reject(failure);
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(inFlight.get("session")).toBe(replacement);
  });
});

describe("WorkspaceMutationQueue", () => {
  it("retains a terminal returned by a stale successful create", () => {
    const existing = { id: "existing" };
    const returned = { id: "returned" };
    expect(mergeTerminalSession([existing, returned], returned)).toEqual([existing, returned]);
  });

  it("serializes mutations for one workspace", async () => {
    const queue = new WorkspaceMutationQueue();
    const order: string[] = [];
    let release!: () => void;
    const first = queue.run("workspace", async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("first:end");
    });
    const second = queue.run("workspace", async () => { order.push("second"); });
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    release();
    await Promise.all([first.result, second.result]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("constructs queued writes from the latest authoritative workspace", async () => {
    const queue = new WorkspaceMutationQueue();
    let workspace = { name: "old", activeTerminalId: "a" };
    let release!: () => void;
    const rename = queue.run("workspace", async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      workspace = { ...workspace, name: "renamed" };
      return workspace;
    });
    const activate = queue.runLatest("workspace", () => workspace, async (latest) => {
      workspace = { ...latest, activeTerminalId: "b" };
      return workspace;
    });
    await Promise.resolve();
    release();
    await Promise.all([rename.result, activate.result]);
    expect(workspace).toEqual({ name: "renamed", activeTerminalId: "b" });
  });

  it("marks older responses stale without coupling workspaces", () => {
    const queue = new WorkspaceMutationQueue();
    const first = queue.run("a", async () => undefined);
    const other = queue.run("b", async () => undefined);
    const second = queue.run("a", async () => undefined);
    expect(queue.isLatest("a", first.generation)).toBe(false);
    expect(queue.isLatest("a", second.generation)).toBe(true);
    expect(queue.isLatest("b", other.generation)).toBe(true);
  });

  it("merges members from a stale create response without replacing newer workspace state", () => {
    const member = (terminalId: string) => ({ terminalId });
    const current = {
      id: "workspace",
      name: "renamed",
      activeTerminalId: "second",
      members: [member("first"), member("second")],
      createdAt: 1,
      updatedAt: 3,
    };
    const returned = {
      ...current,
      name: "old",
      activeTerminalId: "created",
      members: [member("first"), member("created")],
      updatedAt: 2,
    };
    expect(mergeWorkspaceMembers([current], returned)).toEqual([{
      ...current,
      members: [...current.members, member("created")],
    }]);
  });

  it("removes a deleted terminal after a queued activation makes its response stale", async () => {
    const member = (terminalId: string) => ({ terminalId });
    let current: TerminalWorkspace[] = [{
      id: "workspace",
      name: "renamed",
      activeTerminalId: "a",
      members: [member("a"), member("b")],
      createdAt: 1,
      updatedAt: 3,
    }];
    const staleResponse = {
      ...current[0],
      name: "old",
      activeTerminalId: "b",
      members: [member("b")],
      updatedAt: 2,
    };
    const queue = new WorkspaceMutationQueue();
    let releaseDelete!: () => void;
    let releaseActivation!: () => void;
    const deletion = queue.run("workspace", async () => {
      await new Promise<void>((resolve) => { releaseDelete = resolve; });
      return staleResponse;
    });
    current = [{ ...current[0], activeTerminalId: "b" }];
    const activation = queue.run("workspace", async () => {
      await new Promise<void>((resolve) => { releaseActivation = resolve; });
    });
    await Promise.resolve();
    releaseDelete();
    const response = await deletion.result;
    await Promise.resolve();
    expect(queue.isLatest("workspace", deletion.generation)).toBe(false);
    current = mergeDeletedTerminal(current, "a", "workspace", response);
    expect(current).toEqual([{
      ...current[0],
      members: [member("b")],
    }]);
    releaseActivation();
    await activation.result;
  });

  it("removes a workspace when its last terminal is deleted", () => {
    const workspace = {
      id: "workspace",
      name: null,
      activeTerminalId: "a",
      members: [{ terminalId: "a" }],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(mergeDeletedTerminal([workspace], "a", workspace.id, null)).toEqual([]);
  });
});
