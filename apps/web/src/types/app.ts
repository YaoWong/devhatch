export type ConfirmAction = {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onClose?: () => void;
  action: () => boolean | void | Promise<boolean | void>;
};
export type DetailMode = "terminal" | "agent" | "skills" | "webapp" | "settings";
export type RailPage = "modes" | DetailMode;
export type WorkspaceMode = DetailMode;
export type RailMotion = "forward" | "return" | null;
export type LaunchPathDisplay = "folder" | "full";
export type DeleteTarget = { id: string; name: string; cwd: string; kind: "terminal" | "agent session"; returnFocus?: HTMLElement | null; fallbackFocus?: HTMLElement | null };
