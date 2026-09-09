import { describe, expect, it, vi } from "vitest";
import { loadTerminalFonts } from "./terminalFonts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

describe("terminal font loading", () => {
  it("shares one load promise and requests each weight once", async () => {
    const pending = deferred();
    const fonts = { load: vi.fn<(font: string) => Promise<void>>(() => pending.promise) };

    const first = loadTerminalFonts(fonts);
    const second = loadTerminalFonts(fonts);

    expect(second).toBe(first);
    expect(fonts.load.mock.calls.map(([font]) => font)).toEqual([
      '400 16px "JetBrainsMono Nerd Font Web"',
      '700 16px "JetBrainsMono Nerd Font Web"',
    ]);

    pending.resolve();
    await expect(first).resolves.toBeUndefined();
    expect(loadTerminalFonts(fonts)).toBe(first);
    expect(fonts.load).toHaveBeenCalledTimes(2);
  });

  it("isolates caches for different font sets", () => {
    const first = { load: vi.fn(() => Promise.resolve()) };
    const second = { load: vi.fn(() => Promise.resolve()) };

    loadTerminalFonts(first);
    loadTerminalFonts(second);

    expect(first.load).toHaveBeenCalledTimes(2);
    expect(second.load).toHaveBeenCalledTimes(2);
  });

  it("resolves when the font loading API is unavailable", async () => {
    await expect(loadTerminalFonts(undefined)).resolves.toBeUndefined();
  });

  it("retries after a loader failure", async () => {
    const fonts = { load: vi.fn(() => { throw new Error("unsupported"); }) };

    const first = loadTerminalFonts(fonts);

    await expect(first).rejects.toThrow("unsupported");
    const retry = loadTerminalFonts(fonts);
    expect(retry).not.toBe(first);
    await expect(retry).rejects.toThrow("unsupported");
    expect(fonts.load).toHaveBeenCalledTimes(4);
  });
});
