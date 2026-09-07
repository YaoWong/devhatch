import { afterEach, describe, expect, it, vi } from "vitest";
import { appearanceDefaults, DebouncedNumberSetting, hasDisplaySettings, persistLatestValue } from "./settingsPersistence";

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

  it("drops a pending value when reset returns to the confirmed default", async () => {
    vi.useFakeTimers();
    const persist = vi.fn(async () => ({ navigationRailWidthPx: 288 }));
    const setting = new DebouncedNumberSetting({
      key: "navigationRailWidthPx",
      initialValue: 288,
      min: 240,
      max: 480,
      step: 8,
      persist,
      onValue: vi.fn(),
      onError: vi.fn(),
    });
    setting.activate();
    setting.setValue(320);
    setting.setValue(288);

    await vi.advanceTimersByTimeAsync(200);
    expect(persist).not.toHaveBeenCalled();
  });

  it("saves a reset after an older request succeeds", async () => {
    vi.useFakeTimers();
    const first = deferred<{ navigationRailWidthPx: number }>();
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ navigationRailWidthPx: 288 });
    const onValue = vi.fn();
    const setting = new DebouncedNumberSetting({
      key: "navigationRailWidthPx",
      initialValue: 288,
      min: 240,
      max: 480,
      step: 8,
      persist,
      onValue,
      onError: vi.fn(),
    });
    setting.activate();
    setting.setValue(320);
    await vi.advanceTimersByTimeAsync(200);
    setting.setValue(288);
    onValue.mockClear();

    first.resolve({ navigationRailWidthPx: 320 });
    await settle();
    expect(onValue).not.toHaveBeenCalledWith(320);
    await vi.advanceTimersByTimeAsync(200);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith({ navigationRailWidthPx: 288 });
    expect(onValue).toHaveBeenLastCalledWith(288);
  });

  it("ignores an older failed request and continues the reset", async () => {
    vi.useFakeTimers();
    const first = deferred<{ navigationRailWidthPx: number }>();
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ navigationRailWidthPx: 288 });
    const onError = vi.fn();
    const setting = new DebouncedNumberSetting({
      key: "navigationRailWidthPx",
      initialValue: 304,
      min: 240,
      max: 480,
      step: 8,
      persist,
      onValue: vi.fn(),
      onError,
    });
    setting.activate();
    setting.setValue(320);
    await vi.advanceTimersByTimeAsync(200);
    setting.setValue(288);

    first.reject(new Error("stale failure"));
    await settle();
    await vi.advanceTimersByTimeAsync(200);

    expect(onError).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith({ navigationRailWidthPx: 288 });
  });

  it("rolls back a failed reset to the last confirmed value", async () => {
    vi.useFakeTimers();
    const first = deferred<{ navigationRailWidthPx: number }>();
    const failure = new Error("reset failed");
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(failure);
    const onValue = vi.fn();
    const onError = vi.fn();
    const setting = new DebouncedNumberSetting({
      key: "navigationRailWidthPx",
      initialValue: 304,
      min: 240,
      max: 480,
      step: 8,
      persist,
      onValue,
      onError,
    });
    setting.activate();
    setting.setValue(320);
    await vi.advanceTimersByTimeAsync(200);
    setting.setValue(288);
    first.resolve({ navigationRailWidthPx: 320 });
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onValue).toHaveBeenLastCalledWith(320);
  });

  it("lets a post-reset value supersede the reset", async () => {
    vi.useFakeTimers();
    const first = deferred<{ navigationRailWidthPx: number }>();
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ navigationRailWidthPx: 336 });
    const setting = new DebouncedNumberSetting({
      key: "navigationRailWidthPx",
      initialValue: 288,
      min: 240,
      max: 480,
      step: 8,
      persist,
      onValue: vi.fn(),
      onError: vi.fn(),
    });
    setting.activate();
    setting.setValue(320);
    await vi.advanceTimersByTimeAsync(200);
    setting.setValue(288);
    setting.setValue(336);

    first.resolve({ navigationRailWidthPx: 320 });
    await settle();
    await vi.advanceTimersByTimeAsync(200);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith({ navigationRailWidthPx: 336 });
  });
});

describe("persistLatestValue", () => {
  it("persists a reset after an older theme request succeeds", async () => {
    const first = deferred<string>();
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce("default");
    let confirmed = "latte";
    let desired = "mocha";
    const onValue = vi.fn();
    const flush = persistLatestValue({
      getConfirmed: () => confirmed,
      getDesired: () => desired,
      persist,
      setConfirmed: (value) => { confirmed = value; },
      setDesired: (value) => { desired = value; },
      onValue,
      onError: vi.fn(),
    });
    desired = "default";
    first.resolve("mocha");
    await flush;

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenNthCalledWith(1, "mocha");
    expect(persist).toHaveBeenNthCalledWith(2, "default");
    expect(onValue).not.toHaveBeenCalledWith("mocha");
    expect(onValue).toHaveBeenLastCalledWith("default");
  });

  it("ignores an older theme failure and persists the reset", async () => {
    const first = deferred<string>();
    const persist = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce("default");
    let confirmed = "latte";
    let desired = "mocha";
    const onError = vi.fn();
    const flush = persistLatestValue({
      getConfirmed: () => confirmed,
      getDesired: () => desired,
      persist,
      setConfirmed: (value) => { confirmed = value; },
      setDesired: (value) => { desired = value; },
      onValue: vi.fn(),
      onError,
    });
    desired = "default";
    first.reject(new Error("stale failure"));
    await flush;

    expect(onError).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith("default");
  });

  it("rolls back the latest failed theme reset", async () => {
    const failure = new Error("reset failed");
    let confirmed = "mocha";
    let desired = "default";
    const onValue = vi.fn();
    const onError = vi.fn();

    await persistLatestValue({
      getConfirmed: () => confirmed,
      getDesired: () => desired,
      persist: vi.fn().mockRejectedValue(failure),
      setConfirmed: (value) => { confirmed = value; },
      setDesired: (value) => { desired = value; },
      onValue,
      onError,
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(desired).toBe("mocha");
    expect(onValue).toHaveBeenLastCalledWith("mocha");
  });
});

describe("appearanceDefaults", () => {
  it("builds one complete reset patch for current servers", () => {
    expect(appearanceDefaults(true)).toEqual({
      theme: "default",
      agentLaunchPathsMaxHeightPx: 286,
      navigationRailWidthPx: 288,
      fontSizePx: 13,
      uiScalePercent: 100,
    });
  });

  it("omits unsupported display fields for legacy servers", () => {
    expect(appearanceDefaults(false)).toEqual({
      theme: "default",
      agentLaunchPathsMaxHeightPx: 286,
      navigationRailWidthPx: 288,
    });
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
