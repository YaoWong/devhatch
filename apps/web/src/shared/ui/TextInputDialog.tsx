import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { focusTrapTarget } from "./focusTrap";

const inertElements = new WeakMap<HTMLElement, { count: number; initial: boolean }>();

function acquireInert(element: HTMLElement) {
  const state = inertElements.get(element);
  if (state) {
    state.count += 1;
  } else {
    inertElements.set(element, { count: 1, initial: element.inert });
    element.inert = true;
  }
}

function releaseInert(element: HTMLElement) {
  const state = inertElements.get(element);
  if (!state) return;
  state.count -= 1;
  if (state.count > 0) return;
  element.inert = state.initial;
  inertElements.delete(element);
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], area[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), iframe, object, embed, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => {
    for (let current: HTMLElement | null = element; current && container.contains(current); current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.inert || current.hidden || style.display === "none" || style.visibility === "hidden") return false;
      if (current === container) break;
    }
    return element.getClientRects().length > 0;
  });
}

export function TextInputDialog({
  title,
  description,
  label,
  initialValue,
  confirmLabel = "Save",
  maxLength = 120,
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  confirmLabel?: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const normalizedInitialValue = initialValue.trim();

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = dialogRef.current?.parentElement ?? null;
    const background = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop && !element.contains(backdrop),
    );
    background.forEach(acquireInert);
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (!busyRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", trapFocus, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", trapFocus, true);
      background.forEach(releaseInert);
      if (previousFocus?.isConnected && !previousFocus.inert) previousFocus.focus();
    };
  }, []);

  const trapFocus = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || !dialogRef.current) return;
    const elements = focusableElements(dialogRef.current);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = focusTrapTarget(elements, active, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const normalizedValue = value.trim();
    if (normalizedValue === normalizedInitialValue) {
      onClose();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (await onSubmit(normalizedValue)) onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busyRef.current && onClose()}>
      <form ref={dialogRef} className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => void submit(event)}>
        <h2 id={titleId}>{title}</h2>
        {description && <p>{description}</p>}
        <label>{label}<input ref={inputRef} value={value} maxLength={maxLength} disabled={busy} onChange={(event) => setValue(event.target.value)} /></label>
        <div className="dialog-buttons">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : confirmLabel}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
