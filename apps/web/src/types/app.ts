export type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  preserveMobileNavigation?: boolean;
  onClose?: () => void;
  action: () => boolean | void | Promise<boolean | void>;
};

export function resolveDialogNavigationState({
  pickerOpen,
  confirmAction,
  sessionDeleteOpen,
}: {
  pickerOpen: boolean;
  confirmAction: Pick<ConfirmAction, "preserveMobileNavigation"> | null;
  sessionDeleteOpen: boolean;
}) {
  return {
    anyDialogOpen: pickerOpen || confirmAction !== null || sessionDeleteOpen,
    requiresMobileNavigationClose:
      pickerOpen || sessionDeleteOpen || (confirmAction !== null && !confirmAction.preserveMobileNavigation),
  };
}
export type DetailMode = "terminal" | "agent" | "skills" | "webapp" | "settings";
export type RailPage = "modes" | DetailMode;
export type WorkspaceMode = DetailMode;
export type RailMotion = "forward" | "return" | null;
export type LaunchPathDisplay = "folder" | "full";
export type DeleteTarget = { id: string; name: string; cwd: string; kind: "terminal" | "agent session"; returnFocus?: HTMLElement | null; fallbackFocus?: HTMLElement | null };
