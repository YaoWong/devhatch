import { describe, expect, it, vi } from "vitest";
import { clipboardImage, supportsRuntimeImagePaste } from "./runtimeImagePaste";

function event(items: DataTransferItem[]) {
  return { clipboardData: { items } } as unknown as ClipboardEvent;
}

function item(kind: string, type: string, file: File | null) {
  return { kind, type, getAsFile: vi.fn(() => file) } as unknown as DataTransferItem;
}

describe("runtime image paste", () => {
  it("only enables agents with a native runtime adapter", () => {
    expect(supportsRuntimeImagePaste("opencode")).toBe(true);
    expect(supportsRuntimeImagePaste("codex")).toBe(false);
    expect(supportsRuntimeImagePaste("traecli")).toBe(false);
    expect(supportsRuntimeImagePaste("pi")).toBe(false);
  });

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
});
