import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./**/*.{ts,tsx}", { eager: true, import: "default", query: "?raw" }) as Record<string, string>;
const nativeDialogNames = ["prompt", "confirm", "alert"].join("|");
const forbiddenPatterns = [
  new RegExp(`\\b(?:window|globalThis)\\s*\\.\\s*(?:${nativeDialogNames})\\s*\\(`),
  new RegExp(`(?:^|[^.\\w])(?:${nativeDialogNames})\\s*\\(`),
  new RegExp(["before", "unload"].join(""), "i"),
];

describe("browser-native dialogs", () => {
  it("are not used by authored frontend source", () => {
    const violations = Object.entries(sources)
      .filter(([path]) => !path.endsWith("browserNativeDialogs.test.ts"))
      .filter(([, source]) => forbiddenPatterns.some((pattern) => pattern.test(source)))
      .map(([path]) => path);
    expect(violations).toEqual([]);
  });
});
