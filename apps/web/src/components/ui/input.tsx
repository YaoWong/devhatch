import { Input as InputPrimitive } from "@base-ui/react/input"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Input({
  className,
  type,
  variant = "default",
  ...props
}: ComponentProps<"input"> & { variant?: "default" | "bare" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "tw:m-0 tw:block tw:box-border tw:min-w-0 tw:appearance-none tw:rounded-none tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:shadow-none tw:outline-none",
        variant === "default" && "tw:h-8 tw:w-full tw:rounded-lg tw:border tw:border-input tw:px-2.5 tw:py-1 tw:text-base tw:transition-colors tw:file:inline-flex tw:file:h-6 tw:file:border-0 tw:file:bg-transparent tw:file:text-sm tw:file:font-medium tw:file:text-foreground tw:placeholder:text-muted-foreground tw:focus-visible:border-ring tw:focus-visible:ring-3 tw:focus-visible:ring-ring/50 tw:disabled:pointer-events-none tw:disabled:cursor-not-allowed tw:disabled:bg-input/50 tw:disabled:opacity-50 tw:aria-invalid:border-destructive tw:aria-invalid:ring-3 tw:aria-invalid:ring-destructive/20 tw:md:text-sm tw:dark:bg-input/30 tw:dark:disabled:bg-input/80 tw:dark:aria-invalid:border-destructive/50 tw:dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
