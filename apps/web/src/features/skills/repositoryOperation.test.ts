import { describe, expect, it } from "vitest";
import {
  formatRepositoryOperationBytes,
  repositoryOperationLabel,
  repositoryOperationPercentage,
  shouldRefreshForRepositoryOperation,
} from "./repositoryOperation";
import type { SkillRepositoryOperationStatus } from "../../types/skills";

const operation = {
  id: "operation-1",
  kind: "sync" as const,
  repositoryId: "repository-1",
  stage: "updating-files" as const,
  progress: 49.6,
  downloadedBytes: 1536,
  totalBytes: 4096,
};

describe("repository operation display", () => {
  it("formats the stage and percentage", () => {
    expect(repositoryOperationLabel(operation)).toBe("Updating files");
    expect(repositoryOperationPercentage(operation.progress)).toBe(50);
    expect(repositoryOperationPercentage(120)).toBe(100);
  });

  it("formats optional transfer bytes", () => {
    expect(formatRepositoryOperationBytes(operation.downloadedBytes, operation.totalBytes)).toBe("1.5 KiB / 4.0 KiB");
    expect(formatRepositoryOperationBytes(512, null)).toBe("512 B");
    expect(formatRepositoryOperationBytes(null, 4096)).toBeNull();
  });
});

describe("repository operation refresh decision", () => {
  const status = (revision: number, current: SkillRepositoryOperationStatus["operation"] = operation): SkillRepositoryOperationStatus => ({
    revision,
    operation: current,
  });

  it("refreshes on completion and operation replacement", () => {
    expect(shouldRefreshForRepositoryOperation(status(2), status(3, null))).toBe(true);
    expect(shouldRefreshForRepositoryOperation(status(2), status(3, { ...operation, id: "operation-2" }))).toBe(true);
  });

  it("refreshes when a short operation was missed between idle polls", () => {
    expect(shouldRefreshForRepositoryOperation(status(2, null), status(4, null))).toBe(true);
  });

  it("refreshes once for an initially observed idle nonzero revision", () => {
    expect(shouldRefreshForRepositoryOperation(null, status(3, null))).toBe(true);
    expect(shouldRefreshForRepositoryOperation(status(3, null), status(3, null))).toBe(false);
  });

  it("does not refresh for the initial zero revision", () => {
    expect(shouldRefreshForRepositoryOperation(null, status(0, null))).toBe(false);
  });

  it("does not refresh initially during an operation, on unchanged state, progress, or operation start", () => {
    expect(shouldRefreshForRepositoryOperation(null, status(1))).toBe(false);
    expect(shouldRefreshForRepositoryOperation(status(1, null), status(1, null))).toBe(false);
    expect(shouldRefreshForRepositoryOperation(status(2), status(3, { ...operation, progress: 75 }))).toBe(false);
    expect(shouldRefreshForRepositoryOperation(status(1, null), status(2))).toBe(false);
  });
});
