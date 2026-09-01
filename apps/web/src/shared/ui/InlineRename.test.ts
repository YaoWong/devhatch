import { describe, expect, it } from "vitest";
import { inlineRenameSubmission } from "./inlineRenameState";

describe("inline rename submission", () => {
  it("normalizes changed values", () => {
    expect(inlineRenameSubmission("  next name  ", "old name", false)).toEqual({ kind: "submit", value: "next name" });
  });

  it("exits without a request when normalized values are unchanged", () => {
    expect(inlineRenameSubmission(" name ", "name", false)).toEqual({ kind: "unchanged" });
  });

  it("allows an empty value when configured", () => {
    expect(inlineRenameSubmission("   ", "name", true)).toEqual({ kind: "submit", value: "" });
  });

  it("rejects an empty required value", () => {
    expect(inlineRenameSubmission("   ", "name", false)).toEqual({ kind: "invalid", error: "Name cannot be empty." });
  });
});
