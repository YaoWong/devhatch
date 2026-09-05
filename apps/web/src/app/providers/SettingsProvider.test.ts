import { afterEach, describe, expect, it, vi } from "vitest";
import { DebouncedNumberSetting, hasDisplaySettings } from "./settingsPersistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("DebouncedNumberSetting", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid changes into the latest request", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => ({ fontSizePx: 18 }));
    const setting = new DebouncedNumberSetting({
      key: "fontSizePx",
      initialValue: 13,
      min: 12,
      max: 20,
      persist,
      onValue: vi.fn(),
      onError: vi.fn(),
    });
    setting.activate();
    setting.setValue(14);
    setting.setValue(16);
    setting.setValue(18);

    await vi.advanceTimersByTimeAsync(199);
    expect(persist).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith({ fontSizePx: 18 });
  });

  it("sends only the latest change after an in-flight request", async () => {
    vi.useFakeTimers();
    const first = deferred<{ fontSizePx: number }>();
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ fontSizePx: 18 });
    const setting = new DebouncedNumberSetting({
      key: "fontSizePx",
      initialValue: 13,
      min: 12,
      max: 20,
      persist,
      onValue: vi.fn(),
      onError: vi.fn(),
    });
    setting.activate();
    setting.setValue(14);
    await vi.advanceTimersByTimeAsync(200);
    setting.setValue(16);
    setting.setValue(18);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persist).toHaveBeenCalledTimes(1);

    first.resolve({ fontSizePx: 14 });
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith({ fontSizePx: 18 });
  });

  it("ignores a stale rejection and saves the latest value", async () => {
    vi.useFakeTimers();
    const first = deferred<{ fontSizePx: number }>();
    const failure = new Error("stale rejection");
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ fontSizePx: 18 });
    const onError = vi.fn();
    const setting = new DebouncedNumberSetting({
      key: "fontSizePx",
      initialValue: 13,
      min: 12,
      max: 20,
      persist,
      onValue: vi.fn(),
      onError,
    });
    setting.activate();
    setting.setValue(14);
    await vi.advanceTimersByTimeAsync(200);
    setting.setValue(18);
    first.reject(failure);
    await settle();
    await vi.advanceTimersByTimeAsync(200);

    expect(onError).not.toHaveBeenCalled();
    expect(persist).toHaveBeenLastCalledWith({ fontSizePx: 18 });
  });

  it("rolls back a rejected latest request without retrying", async () => {
    vi.useFakeTimers();
    const failure = new Error("rejected");
    const persist = vi.fn().mockRejectedValue(failure);
    const onValue = vi.fn();
    const onError = vi.fn();
    const setting = new DebouncedNumberSetting({
      key: "fontSizePx",
      initialValue: 13,
      min: 12,
      max: 20,
      persist,
      onValue,
      onError,
    });
    setting.activate();
    setting.setValue(16);
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onValue).toHaveBeenLastCalledWith(13);
  });

  it("rejects a successful response missing the requested field without looping", async () => {
    vi.useFakeTimers();
    const persist = vi.fn().mockResolvedValue({});
    const onValue = vi.fn();
    const onError = vi.fn();
    const setting = new DebouncedNumberSetting({
      key: "fontSizePx",
      initialValue: 13,
      min: 12,
      max: 20,
      persist,
      onValue,
      onError,
    });
    setting.activate();
    setting.setValue(16);
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenLastCalledWith(13);
  });
});

describe("hasDisplaySettings", () => {
  it("detects current and legacy settings responses", () => {
    expect(hasDisplaySettings({ fontSizePx: 13, uiScalePercent: 100 })).toBe(true);
    expect(hasDisplaySettings({})).toBe(false);
    expect(hasDisplaySettings({ fontSizePx: 13 })).toBe(false);
    expect(hasDisplaySettings({ fontSizePx: 13, uiScalePercent: 101 })).toBe(false);
  });
});
