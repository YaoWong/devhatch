import { describe, expect, it } from "vitest";
import { getOrCreateInFlightPromise, WorkspaceMutationQueue } from "./workspaceMutationQueue";

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

  it("constructs queued writes from the latest state", async () => {
    const queue = new WorkspaceMutationQueue();
    let workspace = { name: "old", activeSession: "a" };
    let release!: () => void;
    const rename = queue.run("workspace", async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      workspace = { ...workspace, name: "renamed" };
      return workspace;
    });
    const activate = queue.runLatest("workspace", () => workspace, async (latest) => {
      workspace = { ...latest, activeSession: "b" };
      return workspace;
    });
    await Promise.resolve();
    release();
    await Promise.all([rename.result, activate.result]);
    expect(workspace).toEqual({ name: "renamed", activeSession: "b" });
  });

  it("marks older responses stale without coupling keys", () => {
    const queue = new WorkspaceMutationQueue();
    const first = queue.run("a", async () => undefined);
    const other = queue.run("b", async () => undefined);
    const second = queue.run("a", async () => undefined);
    expect(queue.isLatest("a", first.generation)).toBe(false);
    expect(queue.isLatest("a", second.generation)).toBe(true);
    expect(queue.isLatest("b", other.generation)).toBe(true);
  });

  it("captures a queued read generation when the read starts", async () => {
    const queue = new WorkspaceMutationQueue();
    let releaseMutation!: () => void;
    let releaseRead!: () => void;
    const mutation = queue.run("workspace", () => new Promise<void>((resolve) => { releaseMutation = resolve; }));
    const read = queue.read("workspace", () => new Promise<string>((resolve) => { releaseRead = () => resolve("state"); }));
    await Promise.resolve();
    releaseMutation();
    await mutation.result;
    await Promise.resolve();
    const concurrent = queue.run("workspace", async () => undefined);
    releaseRead();
    const result = await read;
    expect(queue.isLatest("workspace", result.generation)).toBe(false);
    await concurrent.result;
  });

  it("applies the first read as the latest generation", async () => {
    const queue = new WorkspaceMutationQueue();
    let reads = 0;
    const value = await queue.readLatest("workspace", async () => {
      reads += 1;
      return "state";
    });
    expect(value).toBe("state");
    expect(queue.isLatest("workspace", 0)).toBe(true);
    expect(reads).toBe(1);
  });

  it("retries an overtaken read and returns only the latest value", async () => {
    const queue = new WorkspaceMutationQueue();
    let releaseRead!: () => void;
    let reads = 0;
    const latest = queue.readLatest("workspace", async () => {
      reads += 1;
      if (reads === 1) await new Promise<void>((resolve) => { releaseRead = resolve; });
      return reads;
    });
    await Promise.resolve();
    const mutation = queue.run("workspace", async () => undefined);
    releaseRead();
    await mutation.result;
    await expect(latest).resolves.toBe(2);
  });

  it("retries an overtaken read before applying it", async () => {
    const queue = new WorkspaceMutationQueue();
    const applied: number[] = [];
    let releaseRead!: () => void;
    let reads = 0;
    const refresh = queue.readAndApplyLatest("launch-paths", async () => {
      reads += 1;
      if (reads === 1) await new Promise<void>((resolve) => { releaseRead = resolve; });
      return reads;
    }, (value) => { applied.push(value); });
    await Promise.resolve();
    const mutation = queue.run("launch-paths", async () => undefined);
    releaseRead();
    await Promise.all([refresh, mutation.result]);
    expect(reads).toBe(2);
    expect(applied).toEqual([2]);
  });

  it("does not make a pending read block a later mutation", async () => {
    const queue = new WorkspaceMutationQueue();
    let releaseRead!: () => void;
    let reads = 0;
    const applied: number[] = [];
    const refresh = queue.readAndApplyLatest("launch-paths", async () => {
      reads += 1;
      if (reads === 1) await new Promise<void>((resolve) => { releaseRead = resolve; });
      return reads;
    }, (value) => { applied.push(value); });
    await Promise.resolve();
    const mutation = queue.run("launch-paths", async () => "written");
    await expect(mutation.result).resolves.toBe("written");
    expect(applied).toEqual([]);
    releaseRead();
    await refresh;
    expect(applied).toEqual([2]);
  });

  it("waits for an existing mutation before reading", async () => {
    const queue = new WorkspaceMutationQueue();
    let releaseMutation!: () => void;
    let readStarted = false;
    const mutation = queue.run("launch-paths", () => new Promise<void>((resolve) => { releaseMutation = resolve; }));
    const refresh = queue.readAndApplyLatest("launch-paths", async () => {
      readStarted = true;
      return "state";
    }, () => undefined);
    await Promise.resolve();
    expect(readStarted).toBe(false);
    releaseMutation();
    await Promise.all([mutation.result, refresh]);
    expect(readStarted).toBe(true);
  });

  it("returns a current version when no mutation overtakes a queued read", async () => {
    const queue = new WorkspaceMutationQueue();
    const mutation = queue.run("workspace", async () => undefined);
    const read = queue.read("workspace", async () => "state");
    await mutation.result;
    const result = await read;
    expect(result.value).toBe("state");
    expect(queue.isLatest("workspace", result.generation)).toBe(true);
  });
});
