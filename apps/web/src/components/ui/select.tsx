import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("tw:scroll-my-1 tw:p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "tw:group/select tw:flex tw:h-8 tw:w-fit tw:items-center tw:justify-between tw:gap-1.5 tw:rounded-lg tw:border tw:border-input tw:bg-transparent tw:px-2.5 tw:py-2 tw:text-sm tw:whitespace-nowrap tw:transition-colors tw:outline-none tw:select-none tw:focus-visible:border-ring tw:focus-visible:ring-3 tw:focus-visible:ring-ring/50 tw:disabled:cursor-not-allowed tw:disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        className={({ open }) => cn(
          "tw:pointer-events-none tw:grid tw:size-4 tw:shrink-0 tw:place-items-center tw:text-muted-foreground tw:transition-transform",
          open && "tw:rotate-180"
        )}
      >
        <ChevronDownIcon className="tw:size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

type SelectContentProps = SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  > & {
    listProps?: SelectPrimitive.List.Props
    portalOwner?: string
    positionerClassName?: string
  }

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  listProps,
  portalOwner,
  positionerClassName,
  ...props
}: SelectContentProps) {
  return (
    <SelectPrimitive.Portal
      data-custom-select-portal=""
      data-custom-select-trigger={portalOwner}
    >
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className={cn("tw:isolate tw:z-[70] tw:data-[anchor-hidden]:hidden", positionerClassName)}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "tw:relative tw:isolate tw:max-h-[var(--available-height)] tw:w-[var(--anchor-width)] tw:origin-[var(--transform-origin)] tw:overflow-x-hidden tw:overflow-y-auto tw:rounded-lg tw:border tw:border-border tw:bg-card tw:text-popover-foreground tw:shadow-md tw:duration-100 tw:outline-none tw:data-open:animate-in tw:data-open:fade-in-0 tw:data-open:zoom-in-95 tw:data-closed:animate-out tw:data-closed:fade-out-0 tw:data-closed:zoom-out-95 tw:data-[side=bottom]:slide-in-from-top-2 tw:data-[side=top]:slide-in-from-bottom-2 tw:motion-reduce:animate-none!",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List data-slot="select-list" {...listProps}>
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("tw:px-1.5 tw:py-1 tw:text-xs tw:text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "tw:flex tw:w-full tw:min-w-0 tw:cursor-default tw:items-center tw:gap-1.5 tw:rounded-md tw:px-1.5 tw:py-1 tw:text-sm tw:outline-none tw:select-none tw:data-highlighted:bg-accent tw:data-highlighted:text-accent-foreground tw:data-disabled:pointer-events-none tw:data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:overflow-hidden">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        keepMounted
        className={({ selected }) => cn(
          "tw:pointer-events-none tw:grid tw:size-3.5 tw:shrink-0 tw:place-items-center tw:transition-opacity",
          selected ? "tw:opacity-100" : "tw:opacity-0"
        )}
      >
        <CheckIcon className="tw:size-3.5" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("tw:pointer-events-none tw:-mx-1 tw:my-1 tw:h-px tw:bg-border", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
