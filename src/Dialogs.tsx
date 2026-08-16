import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { ConfirmAction, DeleteTarget } from "./types";

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
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, onCancel]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onCancel();
      }}
    >
      <div className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title">
        <div className="delete-dialog-icon">
          <X />
        </div>
        <div className="delete-dialog-copy">
          <h2 id="delete-dialog-title">Close {target.kind}?</h2>
          <p>
            This will stop the running process and close <strong>{target.name}</strong>. OpenCode history will be
            preserved.
          </p>
          <span>{target.cwd}</span>
        </div>
        <div className="delete-dialog-actions">
          <button ref={cancelRef} className="dialog-cancel" disabled={deleting} onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-delete" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Closing…" : `Close ${target.kind}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActionDialog({ action, busy, onClose }: { action: ConfirmAction; busy: boolean; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div className="action-dialog" role="alertdialog" aria-modal="true" aria-labelledby="action-title">
        <h2 id="action-title">{action.title}</h2>
        <p>{action.description}</p>
        <div className="dialog-buttons">
          <button ref={cancelRef} disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className={action.danger ? "danger" : "primary"} disabled={busy} onClick={() => void action.action()}>
            {busy ? "Working…" : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
