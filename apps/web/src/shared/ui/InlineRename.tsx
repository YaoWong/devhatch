import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { inlineRenameSubmission } from "./inlineRenameState";

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
    <form ref={formRef} className="inline-rename" aria-busy={busy} onClick={stopClick} onSubmit={submit}>
      <label className="sr-only" htmlFor={errorId}>Rename {label}</label>
      <span className="inline-rename-field">
        <input
          ref={inputRef}
          id={errorId}
          value={value}
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
        <span className="inline-rename-actions">
          <button type="submit" aria-label={`Save ${label}`} disabled={busy} onMouseDown={keepFocus}>
            {busy ? <LoaderCircle className="inline-rename-spinner" /> : <Check />}
          </button>
          <button type="button" aria-label={`Cancel renaming ${label}`} disabled={busy} onMouseDown={keepFocus} onClick={cancel}>
            <X />
          </button>
        </span>
      </span>
      {error && <span id={`${errorId}-error`} className="inline-rename-error" role="alert">{error}</span>}
    </form>
  );
}
