import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FloatingAlert } from "./FloatingAlert";

function dismiss() {}

describe("FloatingAlert", () => {
  it("renders an alert and optional dismiss action", () => {
    const markup = renderToStaticMarkup(<FloatingAlert className="tw:fixed" dismissLabel="Dismiss error" onDismiss={dismiss}>Failure</FloatingAlert>);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Failure");
    expect(markup).toContain("tw:fixed");
    expect(markup).toContain('aria-label="Dismiss error"');
  });

  it("omits the dismiss action when none is supplied", () => {
    expect(renderToStaticMarkup(<FloatingAlert>Failure</FloatingAlert>)).not.toContain("<button");
  });
});
