import type { ReactNode } from "react";

export const railMenuSectionClass = "tw:min-w-0";
export const railMenuLabelClass = "tw:mt-0 tw:mr-0 tw:mb-[8px] tw:ml-0 tw:px-[12px] tw:text-[calc(12px*var(--app-font-scale))] tw:leading-[1.2] tw:font-bold tw:tracking-[0.06em] tw:text-[var(--color-text-faint)] tw:uppercase";
export const railQuietMessageClass = "tw:rounded-[10px] tw:border tw:border-border tw:px-[12px] tw:py-[10px] tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.45] tw:text-[var(--color-text-faint)]";
export const historyStatusClass = "tw:min-w-0 tw:grid tw:gap-[6px] tw:[overflow-wrap:anywhere] tw:[&_strong]:text-[var(--color-text-muted)]";
export const selectCopyClass = "tw:min-w-0 tw:flex-1 tw:[&_small]:mt-[3px] tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:text-[calc(10px*var(--app-font-scale))] tw:[&_small]:leading-[1.2] tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:leading-[1.25] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";

export function RailQuietMessage({ children, className = "", role }: { children: ReactNode; className?: string; role?: "alert" | "status" }) {
  return <div className={`${railQuietMessageClass} ${className}`} role={role}>{children}</div>;
}
