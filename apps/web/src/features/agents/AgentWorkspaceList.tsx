import type { AgentWorkspace } from "../../types/agents";
import type { ConfirmAction } from "../../types/app";
import { RailWorkspaceList } from "../../shared/ui/RailWorkspaceList";

export function AgentWorkspaceList({
  workspaces,
  selectedWorkspaceId,
  launching,
  renamingId,
  onSelect,
  onRename,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
  onCreate,
  onConfirm,
}: {
  workspaces: AgentWorkspace[];
  selectedWorkspaceId: string | null;
  launching: boolean;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onRename: (workspace: AgentWorkspace) => void;
  onRenameSubmit: (workspace: AgentWorkspace, name: string) => Promise<boolean>;
  onRenameCancel: () => void;
  onDelete: (workspace: AgentWorkspace) => Promise<boolean>;
  onCreate: () => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  return (
    <RailWorkspaceList
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      launching={launching}
      renamingId={renamingId}
      memberNoun="agent session"
      emptyMessage="Create an agent workspace to get started."
      deleteDescription="The agent sessions keep running, but this workspace arrangement is removed."
      onSelect={onSelect}
      onRename={onRename}
      onRenameSubmit={onRenameSubmit}
      onRenameCancel={onRenameCancel}
      onDelete={onDelete}
      onCreate={onCreate}
      onConfirm={onConfirm}
    />
  );
}
