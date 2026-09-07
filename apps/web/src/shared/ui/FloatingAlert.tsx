import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FloatingAlert({ children, className, dismissLabel = "Dismiss", onDismiss }: {
  children: ReactNode;
  className?: string;
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  return (
    <div className={cn("tw:z-10 tw:flex tw:w-max tw:max-w-[min(560px,calc(100%-32px))] tw:items-center tw:gap-[10px] tw:rounded-[12px] tw:bg-[var(--color-text)] tw:px-[14px] tw:py-[10px] tw:text-[calc(13px*var(--app-font-scale))] tw:text-[var(--color-on-solid)] tw:shadow-[0_12px_32px_rgb(0_0_0/18%)]", className)} role="alert">
      <span className="tw:min-w-0 tw:[overflow-wrap:anywhere]">{children}</span>
      {onDismiss && (
        <Button variant="ghost" size="icon" className="tw:size-10 tw:flex-none tw:rounded-full tw:text-[var(--color-on-solid)] tw:hover:bg-[color-mix(in_srgb,var(--color-on-solid)_12%,transparent)]! tw:hover:text-[var(--color-on-solid)]! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label={dismissLabel} onClick={onDismiss}>
          <X className="tw:size-3.5" />
        </Button>
      )}
    </div>
  );
}
