import { describe, expect, it } from "vitest";
import { terminalThumbnailBounds, terminalThumbnailSize } from "./terminalThumbnail";

describe("terminal thumbnail", () => {
  it("uses a bounded output size", () => {
    expect(terminalThumbnailSize).toEqual({ width: 240, height: 150 });
  });

  it("maps canvas layers relative to the screen", () => {
    expect(terminalThumbnailBounds(
      { left: 10, top: 20, width: 480, height: 300 },
      { left: 130, top: 80, width: 240, height: 150 },
    )).toEqual({ x: 60, y: 30, width: 120, height: 75 });
  });

  it("fills the thumbnail when screen geometry is unavailable", () => {
    expect(terminalThumbnailBounds(
      { left: 0, top: 0, width: 0, height: 0 },
      { left: 0, top: 0, width: 10, height: 10 },
    )).toEqual({ x: 0, y: 0, width: 240, height: 150 });
  });
});
