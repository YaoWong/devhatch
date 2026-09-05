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
  const buttonClassName = "tw:size-10 tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-muted-foreground tw:transition-colors tw:hover:bg-muted! tw:hover:text-foreground! tw:active:not-aria-[haspopup]:translate-y-0! tw:[@media(pointer:coarse)]:size-11";
  return (
    <div className={cn("tw:grid tw:min-w-0 tw:grid-cols-[minmax(40px,1fr)_auto] tw:items-center tw:gap-0.5 tw:[@media(pointer:coarse)]:grid-cols-[minmax(44px,1fr)_auto]", compact && "tw:w-full")} role="group" aria-labelledby={labelId}>
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
      <div className="tw:grid tw:h-10 tw:grid-cols-[40px_40px_40px] tw:has-[input:disabled]:opacity-50 tw:[@media(pointer:coarse)]:h-11 tw:[@media(pointer:coarse)]:grid-cols-[44px_44px_44px]">
        <Button variant="ghost" size="icon" className={buttonClassName} type="button" disabled={disabled || value <= min} aria-label={`Decrease ${label}`} onClick={() => adjust(-1)}>
          <Minus className="tw:size-3.5" />
        </Button>
        <Input
          variant="bare"
          className="tw:h-full tw:w-10 tw:min-w-0 tw:rounded-md tw:border tw:border-transparent tw:bg-transparent tw:px-0.5 tw:text-center tw:font-mono tw:text-xs tw:outline-none tw:[appearance:textfield] tw:hover:bg-muted/60 tw:focus-visible:border-ring tw:focus-visible:bg-background tw:focus-visible:ring-3 tw:focus-visible:ring-ring/50 tw:disabled:cursor-not-allowed tw:[&::-webkit-inner-spin-button]:appearance-none tw:[&::-webkit-outer-spin-button]:appearance-none tw:[@media(pointer:coarse)]:w-11"
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
        <Button variant="ghost" size="icon" className={buttonClassName} type="button" disabled={disabled || value >= max} aria-label={`Increase ${label}`} onClick={() => adjust(1)}>
          <Plus className="tw:size-3.5" />
        </Button>
      </div>
    </div>
  );
}
