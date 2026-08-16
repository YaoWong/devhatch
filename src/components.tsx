import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Pencil, X } from "lucide-react";
import type { ConnectionPhase, TerminalInfo } from "./types";
import { formatUptime } from "./utils";

export function SessionTabs<T extends TerminalInfo>({
  sessions,
  activeId,
  phases,
  label,
  onActivate,
  onRename,
  onClose,
}: {
  sessions: T[];
  activeId: string | null;
  phases: Record<string, ConnectionPhase>;
  label: string;
  onActivate: (id: string) => void;
  onRename: (session: T) => void;
  onClose: (session: T) => void;
}) {
  return (
    <div className="tabbar">
      <div className="tabs">
        {sessions.map((session, index) => (
          <button
            key={session.id}
            className={`tab ${session.id === activeId ? "active" : ""}`}
            onClick={() => onActivate(session.id)}
          >
            <span className={`tab-dot ${phases[session.id] ?? "connecting"}`} />
            <span className="tab-name">{session.name || `${label} ${index + 1}`}</span>
            <span className="tab-actions">
              <span
                className="tab-action"
                role="button"
                tabIndex={0}
                aria-label={`Rename ${session.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRename(session);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onRename(session);
                  }
                }}
              >
                <Pencil />
              </span>
              <span
                className="tab-action"
                role="button"
                tabIndex={0}
                aria-label={`Close ${session.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(session);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose(session);
                  }
                }}
              >
                <X />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Statusbar({ session, phase }: { session: TerminalInfo | null; phase?: ConnectionPhase }) {
  return (
    <footer className="statusbar">
      <span className={`status-light ${session ? (phase ?? "connecting") : "disconnected"}`} />
      <span>{session ? (phase ?? "connecting") : "No session"}</span>
      <span className="status-path">{session?.shell ?? ""}</span>
      {session && (
        <>
          <span>
            {session.cols} × {session.rows}
          </span>
          <span>uptime {formatUptime(session.createdAt)}</span>
        </>
      )}
    </footer>
  );
}

export function CustomSelect<T extends { id: string }>({
  label,
  value,
  options,
  disabled,
  compact,
  renderTrigger,
  renderOption,
  isOptionDisabled,
  onChange,
}: {
  label: string;
  value: string | null;
  options: T[];
  disabled?: boolean;
  compact?: boolean;
  renderTrigger: (option: T | undefined) => ReactNode;
  renderOption: (option: T) => ReactNode;
  isOptionDisabled?: (option: T) => boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = options.find((option) => option.id === value);
  const enabledIndexes = options
    .map((option, index) => (isOptionDisabled?.(option) ? -1 : index))
    .filter((index) => index >= 0);
  const openMenu = () => {
    if (!disabled) {
      const index = options.findIndex((option) => option.id === value && !isOptionDisabled?.(option));
      setHighlighted(index >= 0 ? index : (enabledIndexes[0] ?? 0));
      setOpen(true);
    }
  };
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const move = (direction: 1 | -1) => {
    if (!enabledIndexes.length) return;
    const current = enabledIndexes.indexOf(highlighted);
    setHighlighted(enabledIndexes[(current + direction + enabledIndexes.length) % enabledIndexes.length]);
  };
  const keyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
      else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openMenu();
      setHighlighted(event.key === "Home" ? (enabledIndexes[0] ?? 0) : (enabledIndexes.at(-1) ?? 0));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openMenu();
      else {
        const option = options[highlighted];
        if (option && !isOptionDisabled?.(option)) {
          onChange(option.id);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }
  };
  return (
    <div
      ref={hostRef}
      className={`custom-select ${compact ? "compact" : ""} ${open ? "open" : ""}`}
      onKeyDown={keyDown}
    >
      <button
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${label.replace(/\s/g, "-")}-listbox`}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        {renderTrigger(selected)}
        <ChevronDown />
      </button>
      {open && (
        <div
          id={`${label.replace(/\s/g, "-")}-listbox`}
          className="custom-select-menu"
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.id}
              role="option"
              aria-selected={option.id === value}
              aria-disabled={isOptionDisabled?.(option) || undefined}
              disabled={isOptionDisabled?.(option)}
              className={`custom-select-option ${index === highlighted ? "highlighted" : ""} ${option.id === value ? "selected" : ""}`}
              onMouseEnter={() => !isOptionDisabled?.(option) && setHighlighted(index)}
              onClick={() => {
                onChange(option.id);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              {renderOption(option)}
              <Check className="option-check" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
