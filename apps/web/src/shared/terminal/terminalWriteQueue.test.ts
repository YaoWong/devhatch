import { describe, expect, it, vi } from "vitest";
import { TerminalWriteQueue } from "./terminalWriteQueue";

type WriteCall = { data: string; complete: () => void };

function harness(maxPendingCharacters?: number) {
  const writes: WriteCall[] = [];
  const failure = vi.fn();
  const queue = new TerminalWriteQueue((data, complete) => writes.push({ data, complete }), failure, maxPendingCharacters);
  return { queue, writes, failure };
}

describe("terminal write queue", () => {
  it("serializes writes and replaces pending old output with an authoritative snapshot", () => {
    const { queue, writes, failure } = harness();
    const oldComplete = vi.fn();
    const snapshotComplete = vi.fn();
    const liveComplete = vi.fn();

    queue.begin(1);
    queue.write(1, "old-active", oldComplete);
    queue.write(1, "old-pending");
    queue.begin(2);
    queue.snapshot(2, "snapshot", snapshotComplete);
    queue.write(2, "live", liveComplete);

    expect(writes.map(({ data }) => data)).toEqual(["old-active"]);
    writes[0].complete();
    expect(oldComplete).not.toHaveBeenCalled();
    expect(writes.map(({ data }) => data)).toEqual(["old-active", "\x1bcsnapshot"]);

    writes[1].complete();
    expect(snapshotComplete).toHaveBeenCalledOnce();
    expect(writes.map(({ data }) => data)).toEqual(["old-active", "\x1bcsnapshot", "live"]);

    writes[2].complete();
    expect(liveComplete).toHaveBeenCalledOnce();
    expect(failure).not.toHaveBeenCalled();
  });

  it("always applies an empty snapshot through an in-band reset", () => {
    const { queue, writes } = harness();
    const complete = vi.fn();

    queue.begin(1);
    queue.snapshot(1, "", complete);

    expect(writes[0].data).toBe("\x1bc");
    expect(complete).not.toHaveBeenCalled();
    writes[0].complete();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("bounds pending output and remains failed until a new generation", () => {
    const { queue, writes, failure } = harness(5);

    queue.begin(1);
    queue.write(1, "active");
    expect(queue.write(1, "12345")).toBe(true);
    expect(queue.write(1, "x")).toBe(false);
    expect(failure).toHaveBeenCalledWith(1);

    writes[0].complete();
    expect(writes).toHaveLength(1);
    expect(queue.write(1, "ignored")).toBe(false);

    queue.begin(2);
    expect(queue.snapshot(2, "next", vi.fn())).toBe(true);
    expect(writes[1].data).toBe("\x1bcnext");
  });

  it("reports synchronous terminal write failures once", () => {
    const failure = vi.fn();
    const queue = new TerminalWriteQueue(() => { throw new Error("full"); }, failure);

    queue.begin(4);
    expect(queue.snapshot(4, "snapshot", vi.fn())).toBe(false);
    expect(queue.write(4, "output")).toBe(false);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith(4);
  });

  it("ignores stale generations and callbacks after disposal", () => {
    const { queue, writes, failure } = harness();
    const complete = vi.fn();

    queue.begin(2);
    expect(queue.write(1, "stale", complete)).toBe(false);
    queue.write(2, "current", complete);
    queue.dispose();
    writes[0].complete();

    expect(complete).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });
});
