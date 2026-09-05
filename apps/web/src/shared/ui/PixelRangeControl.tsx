import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

export function PixelRangeControl({ label, value, min, max, step = 1, unit = "pixels", disabled = false, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: "pixels" | "percent";
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const labelId = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const snap = (nextValue: number) => Math.min(max, Math.max(min, min + Math.round((nextValue - min) / step) * step));
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : Number.NaN;
    const next = Number.isFinite(parsed) ? snap(parsed) : value;
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };
  return (
    <div className="tw:grid tw:w-full tw:min-w-0 tw:grid-cols-[minmax(40px,1fr)_56px] tw:items-center tw:gap-2 tw:[@media(pointer:coarse)]:grid-cols-[minmax(44px,1fr)_60px]" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="tw:sr-only">{label}</span>
      <Slider
        className="tw:h-10 tw:min-w-0 tw:cursor-pointer tw:px-1.5 tw:data-disabled:cursor-not-allowed tw:[&_[data-slot=slider-control]]:h-full tw:[@media(pointer:coarse)]:h-11"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        thumbLabel={label}
        getAriaValueText={(_formattedValue, currentValue) => `${currentValue} ${unit}`}
        aria-labelledby={labelId}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "number") onChange(nextValue);
        }}
      />
      <Input
        variant="bare"
        className="tw:h-10 tw:w-14 tw:min-w-0 tw:rounded-lg tw:border tw:border-input tw:bg-transparent tw:px-1 tw:text-center tw:font-mono tw:text-xs tw:outline-none tw:[appearance:textfield] tw:hover:bg-muted/60 tw:focus-visible:border-ring tw:focus-visible:bg-background tw:focus-visible:ring-3 tw:focus-visible:ring-ring/50 tw:disabled:cursor-not-allowed tw:[&::-webkit-inner-spin-button]:appearance-none tw:[&::-webkit-outer-spin-button]:appearance-none tw:[@media(pointer:coarse)]:h-11 tw:[@media(pointer:coarse)]:w-[60px]"
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={`${label} in ${unit}`}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
