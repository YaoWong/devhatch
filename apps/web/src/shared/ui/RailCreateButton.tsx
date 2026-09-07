import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RailCreateButton({ label, disabled = false, onClick }: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="tw:h-10 tw:touch-manipulation tw:rounded-lg tw:border-input tw:bg-card tw:px-3 tw:text-xs tw:text-foreground tw:transition-[background-color,border-color,color,box-shadow,transform] tw:duration-150 tw:hover:border-ring/50 tw:hover:bg-muted! tw:hover:text-foreground! tw:hover:shadow-sm tw:[@media(pointer:coarse)]:h-11"
      disabled={disabled}
      onClick={onClick}
    >
      <Plus className="tw:size-3.5" />
      {label}
    </Button>
  );
}
