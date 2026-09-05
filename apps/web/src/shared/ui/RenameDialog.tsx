import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { renameSubmission } from "./renameState";

export function RenameDialog({
  initialValue,
  label,
  allowEmpty = false,
  maxLength = 120,
  onSubmit,
  onClose,
}: {
  initialValue: string;
  label: string;
  allowEmpty?: boolean;
  maxLength?: number;
  onSubmit: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const canvasRailOwned = Boolean(returnFocusRef.current?.closest(".rail"));
  const errorId = useId();
  const descriptionId = useId();
  const counterId = useId();
  useEffect(() => setValue(initialValue), [initialValue]);
  const close = () => {
    onClose();
    if (canvasRailOwned) {
      window.setTimeout(() => window.dispatchEvent(new Event("devhatch-canvas-rail-dialog-closed")));
    }
  };
  const resolveFinalFocus = () => {
    const previous = returnFocusRef.current;
    const previousInOpenSheet = previous?.closest('[data-slot="sheet-content"][data-open]');
    if (
      previous?.isConnected && (previousInOpenSheet || !previous.closest("[inert], .canvas-rail-auto:not(.canvas-rail-open)")) &&
      getComputedStyle(previous).display !== "none" && getComputedStyle(previous).visibility !== "hidden"
    ) return previous;
    const mobileTrigger = document.querySelector<HTMLElement>(".canvas-mobile-trigger");
    if (mobileTrigger && getComputedStyle(mobileTrigger).display !== "none") return mobileTrigger;
    const edgeTrigger = document.querySelector<HTMLElement>(".canvas-edge-trigger");
    if (edgeTrigger && getComputedStyle(edgeTrigger).display !== "none") return edgeTrigger;
    return document.querySelector<HTMLElement>(".rail:not([inert])") ?? document.body;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const submission = renameSubmission(value, initialValue, allowEmpty, maxLength);
    if (submission.kind === "unchanged") {
      close();
      return;
    }
    if (submission.kind === "invalid") {
      setError(submission.error);
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (await onSubmit(submission.value)) close();
      else setError("Could not save the name.");
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : "Could not save the name.");
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };
  return (
    <Dialog
      open
      disablePointerDismissal={busy}
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        if (busy) eventDetails.cancel();
        else close();
      }}
    >
      <DialogPortal>
        <DialogOverlay forceRender data-canvas-rail-dialog={canvasRailOwned ? "" : undefined} />
        <DialogContent
          data-canvas-rail-dialog={canvasRailOwned ? "" : undefined}
          className="tw:grid tw:max-h-[calc(100dvh-48px)] tw:w-[min(430px,calc(100%-48px))] tw:gap-5 tw:overflow-y-auto tw:rounded-[20px] tw:border tw:border-border tw:bg-popover tw:p-[22px] tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:max-sm:top-auto tw:max-sm:bottom-3.5 tw:max-sm:w-[calc(100%-28px)] tw:max-sm:translate-y-0"
          initialFocus={inputRef}
          finalFocus={resolveFinalFocus}
          aria-busy={busy}
        >
          <DialogHeader>
            <DialogTitle>Rename {label}</DialogTitle>
            <DialogDescription id={descriptionId}>
              {allowEmpty ? `Leave the name empty to use the default, or enter up to ${maxLength} characters.` : `Enter a name up to ${maxLength} characters.`}
            </DialogDescription>
          </DialogHeader>
          <form className="tw:grid tw:gap-4" noValidate onSubmit={(event) => void save(event)}>
            <label className="tw:grid tw:gap-2 tw:text-xs tw:font-semibold tw:text-[var(--color-text-subtle)]">
              Name
              <Input
                ref={inputRef}
                className="tw:h-10 tw:bg-[var(--color-surface-raised)] tw:text-sm tw:font-normal tw:text-foreground tw:dark:bg-[var(--color-surface-raised)] tw:[@media(pointer:coarse)]:h-11"
                required={!allowEmpty}
                maxLength={maxLength}
                value={value}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={`${descriptionId} ${counterId}${error ? ` ${errorId}` : ""}`}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
              />
            </label>
            <div className="tw:flex tw:min-h-5 tw:items-start tw:justify-between tw:gap-3 tw:text-xs">
              <span id={errorId} className="tw:text-destructive" role={error ? "alert" : undefined}>{error}</span>
              <span id={counterId} className="tw:ml-auto tw:flex-none tw:font-mono tw:text-muted-foreground">{value.length}/{maxLength}</span>
            </div>
            <DialogFooter className="tw:flex-row tw:justify-end">
              <DialogClose disabled={busy} render={<Button variant="outline" className="tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:[@media(pointer:coarse)]:h-11" />}>
                Cancel
              </DialogClose>
              <Button className="tw:h-10 tw:rounded-full tw:bg-foreground tw:px-4 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-foreground/80! tw:[@media(pointer:coarse)]:h-11" type="submit" disabled={busy}>
                {busy && <LoaderCircle className="spin" />}
                {busy ? "Renaming…" : "Rename"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
