import { describe, expect, it, vi } from "vitest";
import { SocketConnection } from "./socketConnection";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function harness(verify = vi.fn<() => Promise<void>>(() => Promise.resolve())) {
  const pending = new Map<number, { callback: () => void; delay: number }>();
  let next = 1;
  const cancel = vi.fn((handle: unknown) => pending.delete(handle as number));
  const unauthorized = vi.fn();
  const connection = new SocketConnection((callback, delay) => {
    const handle = next++;
    pending.set(handle, {
      callback: () => {
        pending.delete(handle);
        callback();
      },
      delay,
    });
    return handle;
  }, cancel, verify, unauthorized);
  return { connection, pending, cancel, verify, unauthorized };
}

function runRetry(pending: Map<number, { callback: () => void; delay: number }>) {
  pending.values().next().value!.callback();
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SocketConnection", () => {
  it("does not reconnect after a normal close", () => {
    const { connection, pending, verify } = harness();
    const reconnect = vi.fn();
    const current = connection.begin()!;
    expect(connection.close(current.generation, 1000, reconnect)).toBe("terminal");
    expect(pending.size).toBe(0);
    expect(verify).not.toHaveBeenCalled();
    expect(connection.begin()).toBeNull();
  });

  it("verifies authentication after consecutive pre-snapshot failures", async () => {
    const check = deferred();
    const verify = vi.fn(() => check.promise);
    const { connection, pending } = harness(verify);
    const reconnect = vi.fn();
    const first = connection.begin()!;
    connection.close(first.generation, 1006, reconnect);
    expect(verify).not.toHaveBeenCalled();
    expect([...pending.values()][0].delay).toBe(500);
    runRetry(pending);
    const second = connection.begin()!;
    connection.close(second.generation, 1006, reconnect);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
    check.resolve();
    await settle();
    expect([...pending.values()][0].delay).toBe(1000);
  });

  it("stops and notifies when authentication verification returns 401", async () => {
    const verify = vi.fn(() => Promise.reject({ status: 401 }));
    const { connection, pending, unauthorized } = harness(verify);
    const reconnect = vi.fn();
    const first = connection.begin()!;
    connection.close(first.generation, 1006, reconnect);
    runRetry(pending);
    const second = connection.begin()!;
    connection.close(second.generation, 1006, reconnect);
    await settle();
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
    expect(connection.begin()).toBeNull();
  });

  it("continues backing off when authentication verification has a network error", async () => {
    const verify = vi.fn(() => Promise.reject(new TypeError("network unavailable")));
    const { connection, pending, unauthorized } = harness(verify);
    const reconnect = vi.fn();
    const first = connection.begin()!;
    connection.close(first.generation, 1006, reconnect);
    runRetry(pending);
    const second = connection.begin()!;
    connection.close(second.generation, 1006, reconnect);
    await settle();
    expect(unauthorized).not.toHaveBeenCalled();
    expect([...pending.values()][0].delay).toBe(1000);
    runRetry(pending);
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it("keeps only one authentication verification in flight", () => {
    const check = deferred();
    const verify = vi.fn(() => check.promise);
    const { connection, pending } = harness(verify);
    const first = connection.begin()!;
    connection.close(first.generation, 1006, vi.fn());
    runRetry(pending);
    const second = connection.begin()!;
    connection.close(second.generation, 1006, vi.fn());
    expect(verify).toHaveBeenCalledTimes(1);
    expect(connection.close(second.generation, 1006, vi.fn())).toBe("ignored");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("resets backoff only after a valid snapshot", () => {
    const { connection, pending } = harness();
    const first = connection.begin()!;
    connection.close(first.generation, 1006, vi.fn());
    runRetry(pending);
    const second = connection.begin()!;
    expect(connection.snapshot(first.generation)).toBe(false);
    expect(connection.snapshot(second.generation)).toBe(true);
    connection.close(second.generation, 1006, vi.fn());
    expect([...pending.values()][0].delay).toBe(500);
  });

  it("stops after an explicit unauthorized close", () => {
    const { connection, pending, unauthorized } = harness();
    const current = connection.begin()!;
    expect(connection.close(current.generation, 1008, vi.fn())).toBe("unauthorized");
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(pending.size).toBe(0);
    expect(connection.begin()).toBeNull();
  });

  it("ignores stale events and pending verification after cleanup", async () => {
    const check = deferred();
    const verify = vi.fn(() => check.promise);
    const { connection, pending, cancel, unauthorized } = harness(verify);
    const reconnect = vi.fn();
    const first = connection.begin()!;
    connection.close(first.generation, 1006, reconnect);
    const retry = pending.values().next().value!;
    connection.stop();
    expect(cancel).toHaveBeenCalled();
    retry.callback();
    expect(reconnect).not.toHaveBeenCalled();
    expect(connection.close(first.generation, 1006, reconnect)).toBe("ignored");

    const secondHarness = harness(verify);
    const secondFirst = secondHarness.connection.begin()!;
    secondHarness.connection.close(secondFirst.generation, 1006, reconnect);
    runRetry(secondHarness.pending);
    const second = secondHarness.connection.begin()!;
    secondHarness.connection.close(second.generation, 1006, reconnect);
    secondHarness.connection.stop();
    check.reject({ status: 401 });
    await settle();
    expect(secondHarness.pending.size).toBe(0);
    expect(secondHarness.unauthorized).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
