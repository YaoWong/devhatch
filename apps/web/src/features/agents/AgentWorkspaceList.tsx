import { Pencil, Plus, Trash2 } from "lucide-react";
import type { ConfirmAction } from "../../types/app";
import type { AgentWorkspace } from "../../types/agents";
import { InlineRename } from "../../shared/ui/InlineRename";

export function AgentWorkspaceList({ workspaces, selectedWorkspaceId, launching, renamingId, onSelect, onRename, onRenameSubmit, onRenameCancel, onDelete, onCreate, onConfirm }: {
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
  return <div className="menu-section">
    <div className="path-section-head"><p className="menu-label">Workspaces</p><button className="mini-action" disabled={launching} onClick={onCreate}><Plus />New</button></div>
    <div className="workspace-list">
      {workspaces.length ? workspaces.map((workspace, index) => {
        const selected = workspace.id === selectedWorkspaceId;
        return <div key={workspace.id} className={`workspace-item ${selected ? "active" : ""}`}>
          {renamingId === workspace.id ? <div className="workspace-select"><span><InlineRename initialValue={workspace.name || `Workspace ${index + 1}`} label="workspace" allowEmpty onSubmit={(name) => onRenameSubmit(workspace, name)} onCancel={onRenameCancel} /><small>{workspace.members.length} agent session{workspace.members.length === 1 ? "" : "s"}</small></span></div> : <button className="workspace-select" aria-pressed={selected} onClick={() => onSelect(workspace.id)}><span><strong>{workspace.name || `Workspace ${index + 1}`}</strong><small>{workspace.members.length} agent session{workspace.members.length === 1 ? "" : "s"}</small></span></button>}
          <span className="workspace-actions"><button aria-label="Rename workspace" disabled={renamingId === workspace.id} onClick={() => onRename(workspace)}><Pencil /></button><button aria-label="Disband workspace" disabled={renamingId === workspace.id} onClick={() => onConfirm({ title: "Disband workspace?", description: "The agent sessions keep running, but this workspace arrangement is removed.", confirmLabel: "Disband", danger: true, action: () => onDelete(workspace) })}><Trash2 /></button></span>
        </div>;
      }) : <div className="quiet-message">Create an agent workspace to get started.</div>}
    </div>
  </div>;
}
