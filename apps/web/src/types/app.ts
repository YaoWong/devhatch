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

export function subscribeMobileNavigationLifecycle(
  query: EventTarget & { readonly matches: boolean },
  lifecycle: EventTarget,
  onChange: (mobile: boolean) => void,
) {
  const update = () => onChange(query.matches);
  update();
  query.addEventListener("change", update);
  lifecycle.addEventListener("pageshow", update);
  lifecycle.addEventListener("orientationchange", update);
  return () => {
    query.removeEventListener("change", update);
    lifecycle.removeEventListener("pageshow", update);
    lifecycle.removeEventListener("orientationchange", update);
  };
}

export type DetailMode = "terminal" | "skills" | "webapp" | "settings";
export type RailPage = "modes" | DetailMode;
export type WorkspaceMode = DetailMode;
export type RailMotion = "forward" | "return" | null;
export type LaunchPathDisplay = "folder" | "full";
export type DeleteTarget = { id: string; name: string; cwd: string; kind: "terminal" | "agent"; returnFocus?: HTMLElement | null; fallbackFocus?: HTMLElement | null };
