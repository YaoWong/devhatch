import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RailCreateButton } from "./RailCreateButton";

describe("RailCreateButton", () => {
  it("uses one consistent visual and interaction contract", () => {
    const html = renderToStaticMarkup(<RailCreateButton label="Add" onClick={vi.fn()} />);
    expect(html).toContain(">Add</button>");
    expect(html).toContain("tw:h-10");
    expect(html).toContain("tw:w-[68px]");
    expect(html).toContain("tw:flex-none");
    expect(html).toContain("tw:gap-1.5");
    expect(html).toContain("tw:bg-card");
    expect(html).toContain("tw:hover:bg-muted!");
    expect(html).toContain("tw:[@media(pointer:coarse)]:h-11");
    expect(html).toContain("tw:disabled:pointer-events-none");
  });
});
