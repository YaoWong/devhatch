import { Minus, Plus } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PixelRangeControl({ label, value, min, max, step = 1, disabled = false, compact = false, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  compact?: boolean;
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
  const buttonClassName = "tw:size-10 tw:flex-none tw:rounded-lg tw:[@media(pointer:coarse)]:size-11";
  return (
    <div className={cn("pixel-range-control tw:min-w-0 tw:items-center", compact ? "tw:grid tw:w-full tw:grid-cols-[40px_48px_40px] tw:justify-end tw:gap-1 tw:[@media(pointer:coarse)]:grid-cols-[44px_48px_44px]" : "tw:flex tw:gap-2")} role="group" aria-label={label}>
      <input
        className={cn(
          "tw:min-w-12 tw:cursor-pointer tw:accent-[var(--color-accent)] tw:focus-visible:rounded-full tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-ring tw:disabled:pointer-events-none tw:disabled:cursor-not-allowed tw:disabled:opacity-50 tw:[@media(pointer:coarse)]:h-11",
          compact ? "tw:col-span-3 tw:h-10 tw:w-full" : "tw:h-10 tw:flex-1",
        )}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <Button variant="outline" size="icon" className={buttonClassName} type="button" disabled={disabled || value <= min} aria-label={`Decrease ${label}`} onClick={() => adjust(-1)}>
        <Minus className="tw:size-3.5" />
      </Button>
      <Input
        className={cn(
          "tw:flex-none tw:px-1 tw:text-center tw:font-mono tw:text-xs tw:[appearance:textfield] tw:[&::-webkit-inner-spin-button]:appearance-none tw:[&::-webkit-outer-spin-button]:appearance-none",
          compact ? "tw:h-10 tw:w-12 tw:[@media(pointer:coarse)]:h-11" : "tw:h-10 tw:w-16 tw:[@media(pointer:coarse)]:h-11",
        )}
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
      <Button variant="outline" size="icon" className={buttonClassName} type="button" disabled={disabled || value >= max} aria-label={`Increase ${label}`} onClick={() => adjust(1)}>
        <Plus className="tw:size-3.5" />
      </Button>
    </div>
  );
}
