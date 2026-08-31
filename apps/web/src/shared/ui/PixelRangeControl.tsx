import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";

export function PixelRangeControl({ label, value, min, max, step = 1, disabled = false, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      commit();
      event.currentTarget.blur();
    }
  };
  const adjust = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <span className="pixel-range-control">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <span className="pixel-value-control">
        <input
          className="pixel-value-input"
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          disabled={disabled}
          aria-label={`${label} in pixels`}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = event.target.valueAsNumber;
            if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
          }}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        <span className="pixel-step-buttons">
          <button type="button" disabled={disabled || value >= max} aria-label={`Increase ${label}`} onClick={() => adjust(1)}><ChevronUp /></button>
          <button type="button" disabled={disabled || value <= min} aria-label={`Decrease ${label}`} onClick={() => adjust(-1)}><ChevronDown /></button>
        </span>
      </span>
    </span>
  );
}
