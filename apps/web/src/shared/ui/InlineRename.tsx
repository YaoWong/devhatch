import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inlineRenameSubmission } from "./inlineRenameState";

const inputClassName = "tw:h-5 tw:w-auto tw:min-w-0 tw:max-w-[36ch] tw:flex-[0_1_auto] tw:border-0 tw:bg-transparent tw:p-0 tw:text-foreground tw:outline-none tw:disabled:opacity-50 tw:aria-invalid:text-destructive tw:in-[.workspace-select]:text-[13px] tw:in-[.workspace-select]:leading-[normal] tw:in-[.workspace-select]:font-bold tw:in-[.path-main]:h-4 tw:in-[.path-main]:text-[10px] tw:in-[.path-main]:font-bold tw:in-[.path-main]:leading-none tw:in-[.repository-summary]:text-[11px] tw:in-[.repository-summary]:leading-[normal] tw:in-[.repository-summary]:font-bold tw:in-[.profile-title]:text-sm tw:in-[.profile-title]:leading-[normal] tw:in-[.profile-title]:font-bold tw:in-[.profile-title]:tracking-[-0.01em] tw:in-[.terminal-window-titlebar]:h-[18px] tw:in-[.terminal-window-titlebar]:cursor-text tw:in-[.terminal-window-titlebar]:font-['SF_Mono',monospace] tw:in-[.terminal-window-titlebar]:text-[11px] tw:in-[.terminal-window-titlebar]:font-semibold tw:in-[.terminal-window-titlebar]:leading-none tw:in-[.terminal-window-titlebar]:select-text";
const actionClassName = "tw:size-[17px] tw:min-h-0 tw:cursor-pointer tw:rounded tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:transition-none tw:hover:bg-[var(--color-surface-hover)] tw:hover:text-foreground tw:active:not-aria-[haspopup]:translate-y-0! tw:disabled:pointer-events-auto tw:disabled:cursor-default tw:disabled:opacity-55 tw:disabled:hover:bg-transparent tw:disabled:hover:text-[var(--color-text-faint)] tw:dark:hover:bg-[var(--color-surface-hover)] tw:dark:disabled:hover:bg-transparent tw:in-[.path-main]:size-3.5";
const iconClassName = "tw:size-[11px] tw:in-[.path-main]:size-[9px]";

export function InlineRename({
  initialValue,
  label,
  allowEmpty = false,
  maxLength = 120,
  onSubmit,
  onCancel,
}: {
  initialValue: string;
  label: string;
  allowEmpty?: boolean;
  maxLength?: number;
  onSubmit: (value: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inputWidth, setInputWidth] = useState(32);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const initialValueRef = useRef(initialValue);
  const returnFocusContainerRef = useRef<Element | null>(null);
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const errorId = useId();

  const focus = () => {
    requestAnimationFrame(() => {
      if (!mountedRef.current) return;
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  useEffect(() => {
    mountedRef.current = true;
    returnFocusContainerRef.current = formRef.current
      ?.closest(".workspace-item, .agent-path-row, .repository-card-header, .terminal-window-titlebar, .profile-title") ?? null;
    focus();
    return () => {
      mountedRef.current = false;
      const container = returnFocusContainerRef.current;
      requestAnimationFrame(() => container?.querySelector<HTMLElement>('button[aria-label^="Rename"]')?.focus());
    };
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const style = getComputedStyle(input);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = style.font;
    setInputWidth(Math.ceil(context.measureText(value || " ").width) + 2);
  }, [value]);

  const save = async () => {
    if (busyRef.current || cancelledRef.current) return;
    const submission = inlineRenameSubmission(value, initialValueRef.current, allowEmpty);
    if (submission.kind === "unchanged") {
      onCancel();
      return;
    }
    if (submission.kind === "invalid") {
      setError(submission.error);
      focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await onSubmit(submission.value);
      if (!mountedRef.current || cancelledRef.current) return;
      if (saved) {
        onCancel();
      } else {
        setError("Could not save the name.");
        focus();
      }
    } catch (reason) {
      if (!mountedRef.current || cancelledRef.current) return;
      setError(reason instanceof Error && reason.message ? reason.message : "Could not save the name.");
      focus();
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    onCancel();
  };

  const stopClick = (event: MouseEvent) => event.stopPropagation();
  const keepFocus = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  return (
    <form
      ref={formRef}
      className="inline-rename tw:relative tw:block tw:w-fit tw:min-w-0 tw:max-w-full tw:in-[.terminal-window-titlebar]:flex-[0_1_auto]"
      aria-busy={busy}
      onClick={stopClick}
      onSubmit={submit}
    >
      <label className="sr-only" htmlFor={errorId}>Rename {label}</label>
      <span className="inline-rename-field tw:flex tw:h-6 tw:w-fit tw:min-w-0 tw:max-w-full tw:items-center tw:overflow-hidden tw:rounded-[6px] tw:border tw:border-input tw:bg-card tw:py-px tw:pr-0.5 tw:pl-1.5 tw:shadow-[0_1px_2px_rgb(var(--shadow-color)/6%)] tw:transition-[border-color,box-shadow] tw:duration-[140ms] tw:ease-[ease] tw:focus-within:border-[color-mix(in_srgb,var(--color-accent)_72%,var(--color-border-strong))] tw:focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_10%,transparent)] tw:in-[.path-main]:h-5 tw:in-[.path-main]:pl-[5px]">
        <Input
          ref={inputRef}
          variant="bare"
          id={errorId}
          value={value}
          className={inputClassName}
          style={{ width: `${inputWidth}px` }}
          maxLength={maxLength}
          disabled={busy}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${errorId}-error` : undefined}
          onChange={(event) => { setValue(event.target.value); setError(""); }}
          onBlur={(event) => {
            if (event.currentTarget.form?.contains(event.relatedTarget)) return;
            void save();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (!busyRef.current) cancel();
          }}
        />
        <span className="inline-rename-actions tw:ml-[3px] tw:flex tw:items-center tw:border-l tw:border-border tw:pl-0.5">
          <Button
            type="submit"
            variant="ghost"
            size="icon-xs"
            className={`${actionClassName} tw:text-primary tw:disabled:hover:text-primary`}
            aria-label={`Save ${label}`}
            disabled={busy}
            onMouseDown={keepFocus}
          >
            {busy ? <LoaderCircle className={`${iconClassName} inline-rename-spinner tw:animate-[spin_700ms_linear_infinite] tw:motion-reduce:animate-none!`} /> : <Check className={iconClassName} />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={actionClassName}
            aria-label={`Cancel renaming ${label}`}
            disabled={busy}
            onMouseDown={keepFocus}
            onClick={cancel}
          >
            <X className={iconClassName} />
          </Button>
        </span>
      </span>
      {error && (
        <span
          id={`${errorId}-error`}
          className="inline-rename-error tw:absolute tw:top-[calc(100%+5px)] tw:left-1 tw:z-80 tw:max-w-[min(280px,calc(100vw-32px))] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:rounded-[7px] tw:border tw:border-[color-mix(in_srgb,var(--color-danger)_25%,transparent)] tw:bg-card tw:px-2 tw:py-[5px] tw:text-[9px] tw:text-destructive tw:shadow-[0_8px_20px_rgb(var(--shadow-color)/12%)]"
          role="alert"
        >
          {error}
        </span>
      )}
    </form>
  );
}
