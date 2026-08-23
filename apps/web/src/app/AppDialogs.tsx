import { ActionDialog, DeleteSessionDialog } from "../Dialogs";
import { WorkspacePicker } from "../WorkspacePicker";
import type { ConfirmAction, DeleteTarget } from "../types";

export function AppDialogs({
  pickerPurpose,
  pickerInitialPath,
  onClosePicker,
  onSelectPath,
  confirmAction,
  actionBusy,
  onRunConfirmAction,
  onCloseConfirmAction,
  deleteCandidate,
  deleting,
  onCancelDelete,
  onConfirmDelete,
}: {
  pickerPurpose: "workspace" | "agent" | null;
  pickerInitialPath?: string;
  onClosePicker: () => void;
  onSelectPath: (path: string) => void;
  confirmAction: ConfirmAction | null;
  actionBusy: boolean;
  onRunConfirmAction: () => Promise<void>;
  onCloseConfirmAction: () => void;
  deleteCandidate: DeleteTarget | null;
  deleting: boolean;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      {pickerPurpose && (
        <WorkspacePicker
          purpose={pickerPurpose}
          initialPath={pickerInitialPath}
          onClose={onClosePicker}
          onSelect={onSelectPath}
        />
      )}
      {confirmAction && (
        <ActionDialog
          action={{ ...confirmAction, action: onRunConfirmAction }}
          busy={actionBusy}
          onClose={onCloseConfirmAction}
        />
      )}
      {deleteCandidate && (
        <DeleteSessionDialog
          target={deleteCandidate}
          deleting={deleting}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}
    </>
  );
}
