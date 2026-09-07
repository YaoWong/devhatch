import type { ReactNode } from "react";

export function LiveRegion({ children }: { children?: ReactNode }) {
  return <span className="tw:sr-only" role="status" aria-live="polite" aria-atomic="true">{children}</span>;
}
