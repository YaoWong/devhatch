import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dispatchCustomSelectOpenChange } from "./customSelectPortal";

export function CustomSelect<Id extends string, T extends { readonly id: Id }>({
  label,
  value,
  options,
  disabled,
  compact,
  popupSize = "default",
  renderTrigger,
  renderOption,
  getOptionLabel,
  isOptionDisabled,
  onChange,
}: {
  label: string;
  value: Id | null;
  options: readonly T[];
  disabled?: boolean;
  compact?: boolean;
  popupSize?: "default" | "theme" | "terminal";
  renderTrigger: (option: T | undefined) => ReactNode;
  renderOption: (option: T) => ReactNode;
  getOptionLabel?: (option: T) => string;
  isOptionDisabled?: (option: T) => boolean;
  onChange: (id: Id) => void;
}) {
  const triggerId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const openRef = useRef(false);
  const selected = options.find((option) => option.id === value);
  const optionLabel = (option: T) => getOptionLabel?.(option) ?? option.id;

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    return () => {
      if (openRef.current) dispatchCustomSelectOpenChange(trigger, false);
    };
  }, []);

  return (
    <div className={cn("custom-select tw:relative tw:w-full tw:min-w-0 tw:max-w-full", compact && "compact")}>
      <Select<Id>
        value={value}
        disabled={disabled}
        modal={false}
        onOpenChange={(open) => {
          openRef.current = open;
          dispatchCustomSelectOpenChange(triggerRef.current, open);
        }}
        onValueChange={(nextValue) => {
          if (nextValue !== null) onChange(nextValue);
        }}
      >
        <SelectTrigger
          ref={triggerRef}
          id={triggerId}
          className="custom-select-trigger tw:min-h-[58px] tw:w-full tw:min-w-0 tw:max-w-full tw:gap-2.5 tw:rounded-[10px] tw:border-border tw:bg-card tw:px-2.5 tw:py-2 tw:text-foreground tw:hover:border-input tw:hover:bg-popover tw:in-[.launch-setup]:min-h-[46px] tw:in-[.launch-setup]:px-[9px] tw:in-[.launch-setup]:py-[7px] tw:in-[.terminal-default-agent-row]:min-h-8 tw:in-[.terminal-default-agent-row]:rounded-lg tw:in-[.terminal-default-agent-row]:px-2 tw:in-[.terminal-default-agent-row]:py-[5px] tw:in-[.settings-theme-row]:min-h-12"
          aria-label={label}
        >
          <SelectValue className="custom-select-trigger-content tw:w-0 tw:max-w-full tw:flex-1 tw:gap-[inherit] tw:overflow-hidden tw:[&>*]:min-w-0 tw:[&>*]:max-w-full">
            {renderTrigger(selected)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          portalOwner={triggerId}
          align="start"
          alignItemWithTrigger={false}
          sideOffset={5}
          className={cn(
            "custom-select-menu tw:grid tw:rounded-[10px] tw:p-1 tw:shadow-[0_14px_36px_rgb(0_0_0/14%)] tw:[&_[data-slot=select-list]]:grid tw:[&_[data-slot=select-list]]:gap-0.5",
            compact && "compact",
            `custom-select-menu-${popupSize}`,
          )}
          listProps={{ "aria-label": label }}
        >
          {options.map((option) => (
            <SelectItem
              key={option.id}
              value={option.id}
              label={optionLabel(option)}
              disabled={isOptionDisabled?.(option)}
              className={cn(
                "custom-select-option tw:min-h-[50px] tw:gap-[9px] tw:rounded-[7px] tw:px-[9px] tw:py-[7px] tw:data-highlighted:bg-background tw:data-highlighted:text-foreground",
                popupSize === "theme" && "tw:min-h-[46px]",
                popupSize === "terminal" && "tw:min-h-[34px] tw:px-[7px] tw:py-[5px] tw:[&_strong]:min-w-0 tw:[&_strong]:overflow-hidden tw:[&_strong]:text-[10px] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap",
              )}
            >
              <span className="custom-select-option-content tw:flex tw:w-0 tw:min-w-0 tw:max-w-full tw:flex-1 tw:items-center tw:gap-[inherit] tw:overflow-hidden tw:[&>*]:min-w-0 tw:[&>*]:max-w-full">{renderOption(option)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
