import { Minus, Plus } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
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
  const labelId = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : Number.NaN;
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };
  const adjust = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const buttonClassName = "tw:size-10 tw:rounded-none tw:border-0 tw:p-0 tw:transition-colors tw:active:not-aria-[haspopup]:translate-y-0! tw:[@media(pointer:coarse)]:size-11";
  return (
    <div className={cn("tw:grid tw:min-w-0 tw:items-center tw:gap-2", compact ? "tw:w-full tw:grid-cols-1 tw:justify-items-end" : "tw:grid-cols-[minmax(96px,1fr)_auto]")} role="group" aria-labelledby={labelId}>
      <span id={labelId} className="tw:sr-only">{label}</span>
      <Slider
        className="tw:h-10 tw:min-w-0 tw:cursor-pointer tw:px-1.5 tw:data-disabled:cursor-not-allowed tw:[&_[data-slot=slider-control]]:h-full tw:[@media(pointer:coarse)]:h-11"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        thumbLabel={label}
        aria-labelledby={labelId}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "number") onChange(nextValue);
        }}
      />
      <div className="tw:grid tw:h-10 tw:grid-cols-[40px_56px_40px] tw:overflow-hidden tw:rounded-lg tw:border tw:border-input tw:bg-background tw:transition-[color,box-shadow] tw:focus-within:border-ring tw:focus-within:ring-3 tw:focus-within:ring-ring/50 tw:has-[input:disabled]:opacity-50 tw:[@media(pointer:coarse)]:h-11 tw:[@media(pointer:coarse)]:grid-cols-[44px_56px_44px]">
        <Button variant="ghost" size="icon" className={cn(buttonClassName, "tw:border-r tw:border-r-border")} type="button" disabled={disabled || value <= min} aria-label={`Decrease ${label}`} onClick={() => adjust(-1)}>
          <Minus className="tw:size-3.5" />
        </Button>
        <Input
          variant="bare"
          className="tw:h-full tw:w-14 tw:min-w-0 tw:border-0 tw:bg-transparent tw:px-1 tw:text-center tw:font-mono tw:text-xs tw:outline-none tw:[appearance:textfield] tw:disabled:cursor-not-allowed tw:[&::-webkit-inner-spin-button]:appearance-none tw:[&::-webkit-outer-spin-button]:appearance-none"
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
        <Button variant="ghost" size="icon" className={cn(buttonClassName, "tw:border-l tw:border-l-border")} type="button" disabled={disabled || value >= max} aria-label={`Increase ${label}`} onClick={() => adjust(1)}>
          <Plus className="tw:size-3.5" />
        </Button>
      </div>
    </div>
  );
}
