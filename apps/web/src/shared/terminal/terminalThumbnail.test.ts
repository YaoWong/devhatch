import { describe, expect, it } from "vitest";
import { TerminalThumbnailCaptureState, terminalThumbnailBounds, terminalThumbnailSize } from "./terminalThumbnail";

describe("terminal thumbnail", () => {
  it("uses a bounded output size", () => {
    expect(terminalThumbnailSize).toEqual({ width: 320, height: 200 });
  });

  it("coalesces capture requests while encoding is in flight", () => {
    const capture = new TerminalThumbnailCaptureState();
    expect(capture.start()).toBe(true);
    expect(capture.start()).toBe(false);
    expect(capture.start()).toBe(false);
    expect(capture.finish()).toBe(true);
    expect(capture.start()).toBe(true);
    expect(capture.finish()).toBe(false);
  });

  it("resets pending capture work", () => {
    const capture = new TerminalThumbnailCaptureState();
    capture.start();
    capture.start();
    capture.reset();
    expect(capture.start()).toBe(true);
    expect(capture.finish()).toBe(false);
  });

  it("maps canvas layers relative to the screen", () => {
    expect(terminalThumbnailBounds(
      { left: 10, top: 20, width: 480, height: 300 },
      { left: 130, top: 80, width: 240, height: 150 },
    )).toEqual({ x: 80, y: 40, width: 160, height: 100 });
  });

  it("fills the thumbnail when screen geometry is unavailable", () => {
    expect(terminalThumbnailBounds(
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 10, height: 10 },
    )).toEqual({ x: 0, y: 0, width: 320, height: 200 });
  });
});
