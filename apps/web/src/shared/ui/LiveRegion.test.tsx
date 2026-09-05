import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LiveRegion } from "./LiveRegion";

describe("LiveRegion", () => {
  it("renders a polite atomic status region", () => {
    const markup = renderToStaticMarkup(<LiveRegion>Loading…</LiveRegion>);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain("Loading…");
  });

  it("remains mounted without a message", () => {
    expect(renderToStaticMarkup(<LiveRegion />)).toContain("<span");
  });
});
