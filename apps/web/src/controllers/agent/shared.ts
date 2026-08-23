export type HomePaths = { home: string; resolvedHome: string } | null;

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
