import { describe, expect, it } from "vitest";
import { renameSubmission } from "./renameState";

describe("rename submission", () => {
  it("normalizes changed values", () => {
    expect(renameSubmission("  next name  ", "old name", false)).toEqual({ kind: "submit", value: "next name" });
  });

  it("exits without a request when normalized values are unchanged", () => {
    expect(renameSubmission(" name ", "name", false)).toEqual({ kind: "unchanged" });
  });

  it("allows an empty value when configured", () => {
    expect(renameSubmission("   ", "name", true)).toEqual({ kind: "submit", value: "" });
  });

  it("rejects an empty required value", () => {
    expect(renameSubmission("   ", "name", false)).toEqual({ kind: "invalid", error: "Name cannot be empty." });
  });

  it("rejects names above the configured limit", () => {
    expect(renameSubmission("abcd", "old", false, 3)).toEqual({ kind: "invalid", error: "Name must not exceed 3 characters." });
  });
});
