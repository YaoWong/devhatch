export function formatAgentVersion(version: string) {
  return `v${version.replace(/^v+/i, "")}`;
}
