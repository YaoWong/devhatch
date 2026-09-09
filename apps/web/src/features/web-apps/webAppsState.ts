import type { WebApp } from "../../types/web-apps";

export function preserveWebAppsReference(current: WebApp[], next: WebApp[]) {
  if (current.length !== next.length) return next;
  for (let index = 0; index < current.length; index += 1) {
    const app = current[index];
    const candidate = next[index];
    if (!app || !candidate || !sameWebApp(app, candidate)) return next;
  }
  return current;
}

function sameWebApp(current: WebApp, next: WebApp) {
  return current.id === next.id
    && current.name === next.name
    && current.description === next.description
    && current.installed === next.installed
    && current.installing === next.installing
    && current.updating === next.updating
    && current.checkingForUpdate === next.checkingForUpdate
    && current.operation === next.operation
    && current.updateAvailable === next.updateAvailable
    && current.progress === next.progress
    && current.downloadedBytes === next.downloadedBytes
    && current.totalBytes === next.totalBytes
    && current.running === next.running
    && current.phase === next.phase
    && current.version === next.version
    && current.currentRevision === next.currentRevision
    && current.remoteRevision === next.remoteRevision
    && current.latestVersion === next.latestVersion
    && current.url === next.url
    && current.installPath === next.installPath
    && current.error === next.error
    && current.prerequisites.git === next.prerequisites.git
    && current.prerequisites.node24 === next.prerequisites.node24
    && current.prerequisites.corepack === next.prerequisites.corepack;
}
