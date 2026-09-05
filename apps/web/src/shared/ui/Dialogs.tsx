import { X } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { ConfirmAction, DeleteTarget } from "../../types/app";

function useDialogFocus(busy: boolean, returnFocus?: HTMLElement | null, fallbackFocus?: HTMLElement | null) {
  const contentId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );

  useLayoutEffect(() => {
    if (busy) contentRef.current?.focus();
  }, [busy]);

  useLayoutEffect(() => {
    const previous = returnFocusRef.current;
    return () => {
      queueMicrotask(() => {
        if (document.getElementById(contentId)) return;
        if (previous?.isConnected && !previous.closest("[inert]")) {
          previous.focus();
          return;
        }
        if (fallbackFocus?.isConnected && !fallbackFocus.closest("[inert]")) {
          fallbackFocus.focus();
          return;
        }
        const mobileTrigger = document.querySelector<HTMLElement>(".canvas-mobile-trigger");
        if (mobileTrigger && getComputedStyle(mobileTrigger).display !== "none") {
          mobileTrigger.focus();
          return;
        }
        const edgeTrigger = document.querySelector<HTMLElement>(".canvas-edge-trigger");
        if (edgeTrigger && getComputedStyle(edgeTrigger).display !== "none") {
          edgeTrigger.focus();
          return;
        }
        (document.querySelector<HTMLElement>(".rail:not([inert])") ?? document.body).focus();
      });
    };
  }, [contentId, fallbackFocus]);

  return { cancelRef, contentId, contentRef };
}

export function DeleteSessionDialog({
  target,
  deleting,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { cancelRef, contentId, contentRef } = useDialogFocus(deleting, target.returnFocus, target.fallbackFocus);

  return (
    <AlertDialog
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        if (deleting) eventDetails.cancel();
        else onCancel();
      }}
    >
      <AlertDialogPortal>
        <AlertDialogOverlay />
        <AlertDialogContent
          ref={contentRef}
          id={contentId}
          initialFocus={cancelRef}
          finalFocus={false}
          aria-busy={deleting}
          className="tw:grid tw:grid-cols-[46px_minmax(0,1fr)] tw:gap-4 tw:p-[22px] tw:max-sm:grid-cols-[42px_minmax(0,1fr)] tw:max-sm:p-[18px]"
        >
          <div className="tw:grid tw:size-[46px] tw:place-items-center tw:rounded-[14px] tw:bg-[var(--color-danger-soft)] tw:text-destructive tw:max-sm:size-[42px] tw:[&_svg]:size-[21px]">
            <X />
          </div>
          <AlertDialogHeader className="tw:min-w-0 tw:gap-0.5 tw:pt-0.5">
            <AlertDialogTitle className="tw:text-[calc(18px*var(--app-font-scale))] tw:tracking-[-0.025em]">
              Close {target.kind}?
            </AlertDialogTitle>
            <AlertDialogDescription className="tw:mt-1.5 tw:text-xs tw:leading-[1.55]">
              This will stop the running process and close <strong className="tw:text-[var(--color-text-subtle)]">{target.name}</strong>. OpenCode history will be preserved.
            </AlertDialogDescription>
            <span className="tw:mt-[9px] tw:block tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:rounded-lg tw:bg-background tw:px-2.5 tw:py-2 tw:font-mono tw:text-[calc(10px*var(--app-font-scale))] tw:leading-[1.3] tw:text-muted-foreground">
              {target.cwd}
            </span>
          </AlertDialogHeader>
          <AlertDialogFooter className="tw:col-span-full tw:flex-row tw:justify-end tw:gap-2 tw:pt-[5px] tw:max-sm:grid tw:max-sm:grid-cols-2">
            <AlertDialogCancel
              ref={cancelRef}
              disabled={deleting}
              className="tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:[@media(pointer:coarse)]:h-11"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="tw:h-10 tw:rounded-full tw:bg-destructive tw:px-4 tw:text-xs tw:text-[var(--color-on-solid)] tw:shadow-[0_6px_16px_color-mix(in_srgb,var(--color-danger)_22%,transparent)] tw:hover:bg-[var(--color-danger-hover)] tw:hover:shadow-[0_8px_20px_color-mix(in_srgb,var(--color-danger)_28%,transparent)] tw:[@media(pointer:coarse)]:h-11"
              onClick={onConfirm}
            >
              {deleting ? "Closing…" : `Close ${target.kind}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialog>
  );
}

export function ActionDialog({ action, busy, onClose }: { action: ConfirmAction; busy: boolean; onClose: () => void }) {
  const { cancelRef, contentId, contentRef } = useDialogFocus(busy);

  return (
    <AlertDialog
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        if (busy) eventDetails.cancel();
        else onClose();
      }}
    >
      <AlertDialogPortal>
        <AlertDialogOverlay className="tw:z-[140]" />
        <AlertDialogContent
          ref={contentRef}
          id={contentId}
          initialFocus={cancelRef}
          finalFocus={false}
          aria-busy={busy}
          className="tw:z-[141] tw:max-w-[420px] tw:rounded-2xl tw:p-[22px]"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="tw:text-[calc(17px*var(--app-font-scale))]">{action.title}</AlertDialogTitle>
            <AlertDialogDescription className="tw:text-xs tw:leading-[1.5]">
              {action.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="tw:mt-3.5 tw:flex-row tw:justify-end tw:gap-2 tw:max-sm:grid tw:max-sm:grid-cols-2">
            <AlertDialogCancel ref={cancelRef} disabled={busy} className="tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:[@media(pointer:coarse)]:h-11">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className={action.danger
                ? "tw:h-10 tw:rounded-full tw:border-destructive tw:bg-destructive tw:px-4 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-[var(--color-danger-hover)] tw:[@media(pointer:coarse)]:h-11"
                : "tw:h-10 tw:rounded-full tw:border-foreground tw:bg-foreground tw:px-4 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-foreground/80 tw:[@media(pointer:coarse)]:h-11"}
              onClick={() => void action.action()}
            >
              {busy ? "Working…" : action.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialog>
  );
}
