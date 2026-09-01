import type { SkillRepositoryOperation, SkillRepositoryOperationStage, SkillRepositoryOperationStatus } from "../../types/skills";

export function shouldRefreshForRepositoryOperation(
  previous: SkillRepositoryOperationStatus | null,
  current: SkillRepositoryOperationStatus,
) {
  if (!previous) return current.operation === null && current.revision !== 0;
  if (previous.revision === current.revision) return false;
  if (previous.operation === null && current.operation === null) return true;
  return previous.operation !== null
    && (current.operation === null || previous.operation.id !== current.operation.id);
}

const stageLabels: Record<SkillRepositoryOperationStage, string> = {
  queued: "Queued",
  cloning: "Cloning repository",
  counting: "Counting objects",
  compressing: "Compressing objects",
  receiving: "Receiving objects",
  resolving: "Resolving deltas",
  "updating-files": "Updating files",
  discovering: "Discovering skills",
  planning: "Planning changes",
  publishing: "Publishing changes",
  saving: "Saving repository",
};

export function repositoryOperationLabel(operation: SkillRepositoryOperation) {
  return stageLabels[operation.stage];
}

export function repositoryOperationPercentage(progress: number) {
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export function formatRepositoryOperationBytes(downloadedBytes: number | null, totalBytes: number | null) {
  if (downloadedBytes === null) return null;
  const downloaded = formatBytes(downloadedBytes);
  return totalBytes === null ? downloaded : `${downloaded} / ${formatBytes(totalBytes)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
