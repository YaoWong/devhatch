import { describe, expect, it, vi } from "vitest";
import { clipboardImage, imagePasteTimeoutError, runImagePaste } from "./runtimeImagePaste";

function event(items: DataTransferItem[]) {
  return { clipboardData: { items } } as unknown as ClipboardEvent;
}

function item(kind: string, type: string, file: File | null) {
  return { kind, type, getAsFile: vi.fn(() => file) } as unknown as DataTransferItem;
}

describe("runtime image paste", () => {
  it("selects the first image from clipboard items", () => {
    const image = new Blob(["png"], { type: "image/png" }) as File;
    expect(clipboardImage(event([
      item("string", "text/plain", null),
      item("file", "image/png", image),
    ]))).toBe(image);
  });

  it("leaves text-only paste to xterm", () => {
    expect(clipboardImage(event([item("string", "text/plain", null)]))).toBeNull();
  });

  it("aborts image paste after its deadline and clears progress", async () => {
    vi.useFakeTimers();
    try {
      const phases: Array<string | null> = [];
      const controller = new AbortController();
      const operation = runImagePaste(
        new Blob(["png"], { type: "image/png" }),
        () => new Promise<void>(() => {}),
        (phase) => phases.push(phase),
        controller,
        100,
      );
      const assertion = expect(operation).rejects.toEqual(imagePasteTimeoutError());
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
      expect(controller.signal.aborted).toBe(true);
      expect(phases).toEqual(["preparing", "pasting", null]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes the abort signal and reports preparation then transfer", async () => {
    const phases: Array<string | null> = [];
    const controller = new AbortController();
    const paste = vi.fn(async (_image: Blob, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
    });
    await runImagePaste(
      new Blob(["png"], { type: "image/png" }),
      paste,
      (phase) => phases.push(phase),
      controller,
    );
    expect(paste).toHaveBeenCalledOnce();
    expect(phases).toEqual(["preparing", "pasting", null]);
  });
});
