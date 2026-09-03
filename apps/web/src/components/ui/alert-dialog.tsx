import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import type { ComponentProps } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "tw:fixed tw:inset-0 tw:z-[130] tw:bg-[rgb(var(--overlay-color)/36%)] tw:backdrop-blur-[12px] tw:backdrop-saturate-[120%] tw:duration-200 tw:data-open:animate-in tw:data-open:fade-in-0 tw:data-closed:animate-out tw:data-closed:fade-out-0 tw:motion-reduce:animate-none!",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogContent({
  className,
  ...props
}: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Popup
      data-slot="alert-dialog-content"
      aria-modal="true"
      className={cn(
        "tw:fixed tw:top-1/2 tw:left-1/2 tw:z-[131] tw:max-h-[calc(100dvh_-_48px)] tw:w-[calc(100%_-_48px)] tw:max-w-[430px] tw:-translate-x-1/2 tw:-translate-y-1/2 tw:overflow-y-auto tw:rounded-[20px] tw:border tw:border-border tw:bg-popover tw:text-popover-foreground tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:duration-200 tw:outline-none tw:data-open:animate-in tw:data-open:fade-in-0 tw:data-open:zoom-in-95 tw:data-closed:animate-out tw:data-closed:fade-out-0 tw:data-closed:zoom-out-95 tw:motion-reduce:animate-none! tw:max-sm:top-auto tw:max-sm:bottom-3.5 tw:max-sm:w-[calc(100%_-_28px)] tw:max-sm:translate-y-0",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("tw:grid tw:gap-2", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "tw:flex tw:flex-col-reverse tw:gap-2 tw:sm:flex-row tw:sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("tw:m-0 tw:text-lg tw:font-medium", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("tw:m-0 tw:text-sm tw:leading-relaxed tw:text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogAction({ className, ...props }: ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" className={cn(className)} {...props} />
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: Omit<AlertDialogPrimitive.Close.Props, "className" | "render"> &
  Pick<ComponentProps<typeof Button>, "variant" | "size"> & {
    className?: string
  }) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
}
