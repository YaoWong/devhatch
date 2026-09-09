import { describe, expect, it, vi } from "vitest";
import { registerTerminalSnapshotReplayHandlers, TerminalSnapshotReplayGuard, TerminalWriteQueue } from "./terminalWriteQueue";

type WriteCall = { data: string; complete: () => void };
type Params = (number | number[])[];
type CsiHandler = { id: { prefix?: string; intermediates?: string; final: string }; callback: (params: Params) => boolean | Promise<boolean> };
type DcsHandler = { id: { prefix?: string; intermediates?: string; final: string }; callback: (data: string, params: Params) => boolean | Promise<boolean> };
type OscHandler = { ident: number; callback: (data: string) => boolean | Promise<boolean> };

function parserHarness() {
  const csi: CsiHandler[] = [];
  const dcs: DcsHandler[] = [];
  const osc: OscHandler[] = [];
  const disposable = () => ({ dispose: vi.fn() });
  const parser = {
    registerCsiHandler: vi.fn((id: CsiHandler["id"], callback: CsiHandler["callback"]) => {
      csi.push({ id, callback });
      return disposable();
    }),
    registerDcsHandler: vi.fn((id: DcsHandler["id"], callback: DcsHandler["callback"]) => {
      dcs.push({ id, callback });
      return disposable();
    }),
    registerOscHandler: vi.fn((ident: number, callback: OscHandler["callback"]) => {
      osc.push({ ident, callback });
      return disposable();
    }),
  };
  const runCsi = (id: CsiHandler["id"], params: Params) => csi.find((handler) => JSON.stringify(handler.id) === JSON.stringify(id))?.callback(params);
  const runDcs = (id: DcsHandler["id"], data: string, params: Params) => dcs.find((handler) => JSON.stringify(handler.id) === JSON.stringify(id))?.callback(data, params);
  const runOsc = (ident: number, data: string) => osc.find((handler) => handler.ident === ident)?.callback(data);
  return { parser, runCsi, runDcs, runOsc };
}

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

  it("ends snapshot lifecycle before queued live output", () => {
    const { queue, writes } = harness();
    const events: string[] = [];

    queue.begin(1);
    queue.snapshot(1, "snapshot", () => events.push("complete"), {
      onStart: () => events.push("start"),
      onSettled: () => events.push("settled"),
    });
    queue.write(1, "live", () => events.push("live"));

    expect(events).toEqual(["start"]);
    writes[0].complete();
    expect(events).toEqual(["start", "settled", "complete"]);
    expect(writes[1].data).toBe("live");
    writes[1].complete();
    expect(events).toEqual(["start", "settled", "complete", "live"]);
  });

  it("keeps active snapshot lifecycle until a replaced generation physically settles", () => {
    const { queue, writes } = harness();
    const settled = vi.fn();
    const complete = vi.fn();

    queue.begin(1);
    queue.snapshot(1, "snapshot", complete, { onSettled: settled });
    queue.begin(2);
    expect(settled).not.toHaveBeenCalled();
    writes[0].complete();

    expect(settled).toHaveBeenCalledOnce();
    expect(complete).not.toHaveBeenCalled();
  });

  it("suppresses replay queries and generated color replies without dropping ordinary input", () => {
    const { parser, runCsi, runDcs, runOsc } = parserHarness();
    const guard = new TerminalSnapshotReplayGuard();
    registerTerminalSnapshotReplayHandlers(parser, guard);

    expect(runCsi({ final: "c" }, [0])).toBe(false);
    guard.begin(3);
    expect(runCsi({ final: "c" }, [0])).toBe(true);
    expect(runCsi({ final: "n" }, [6])).toBe(true);
    expect(runCsi({ final: "t" }, [18])).toBe(true);
    expect(runDcs({ intermediates: "$", final: "q" }, "m", [0])).toBe(true);

    expect(runOsc(10, "?")).toBe(false);
    expect(runOsc(11, "?")).toBe(false);
    expect(guard.suppress("typed")).toBe(false);
    expect(guard.suppress("\x1b]10;rgb:1d1d/1d1d/1f1f\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b]11;rgb:ffff/ffff/ffff\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b]11;rgb:ffff/ffff/ffff\x1b\\")).toBe(false);

    guard.end(3);
    expect(runCsi({ final: "c" }, [0])).toBe(false);
    expect(guard.suppress("\x1b]10;rgb:1d1d/1d1d/1f1f\x1b\\")).toBe(false);
  });

  it("tracks indexed, stacked special-color, and focus replies only during replay", () => {
    const { parser, runCsi, runOsc } = parserHarness();
    const guard = new TerminalSnapshotReplayGuard();
    registerTerminalSnapshotReplayHandlers(parser, guard);
    guard.begin(7);

    expect(runOsc(4, "1;?;2;#ffffff;255;?")).toBe(false);
    expect(runOsc(10, "?;?;?")).toBe(false);
    expect(runCsi({ prefix: "?", final: "h" }, [1004])).toBe(false);
    expect(guard.suppress("\x1b]4;1;rgb:1111/1111/1111\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b]4;255;rgb:ffff/ffff/ffff\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b]10;rgb:1111/1111/1111\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b]11;rgb:2222/2222/2222\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b]12;rgb:3333/3333/3333\x1b\\")).toBe(true);
    expect(guard.suppress("\x1b[I")).toBe(true);
    expect(guard.suppress("user paste")).toBe(false);
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
