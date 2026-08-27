import { Grid2X2, Pin, Plus, Trash2 } from "lucide-react";
import type { ConfirmAction } from "../../types/app";
import type { TerminalInfo, TerminalWorkspace } from "../../types/terminals";
import { displayPath, workspaceName } from "../../shared/lib/utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function WorkspaceList({
  workspaces,
  sessions,
  selectedWorkspace,
  homePaths,
  onSelect,
  onPin,
  onDelete,
  onConfirm,
  onAdd,
}: {
  workspaces: TerminalWorkspace[];
  sessions: TerminalInfo[];
  selectedWorkspace: string | null;
  homePaths: HomePaths;
  onSelect: (workspace: string) => void;
  onPin: (workspace: TerminalWorkspace) => void;
  onDelete: (workspace: TerminalWorkspace) => Promise<boolean>;
  onConfirm: (action: ConfirmAction) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <div className="menu-section">
        <p className="menu-label">Workspace</p>
        <div className="workspace-list">
          {workspaces.map((workspace) => {
            const hasTerminals = sessions.some((session) => session.cwd === workspace.path);
            const selected = workspace.path === selectedWorkspace;
            return (
              <div key={workspace.id} className={`workspace-item ${selected ? "active" : ""}`}>
                <button
                  className="workspace-select"
                  aria-pressed={selected}
                  onClick={() => onSelect(workspace.path)}
                >
                  <Grid2X2 />
                  <span>
                    <strong>
                      {workspaceName(workspace.path)}
                      {hasTerminals && (
                        <span
                          className="workspace-in-use"
                          aria-describedby={`workspace-in-use-${workspace.id}`}
                        >
                          In use
                        </span>
                      )}
                    </strong>
                    <small>{displayPath(workspace.path, homePaths?.home, homePaths?.resolvedHome)}</small>
                    {hasTerminals && (
                      <span id={`workspace-in-use-${workspace.id}`} className="sr-only">
                        Close terminals before deleting this workspace.
                      </span>
                    )}
                  </span>
                </button>
                <span className="workspace-actions">
                  <button
                    className={workspace.pinned ? "pinned" : ""}
                    aria-label={workspace.pinned ? "Unpin workspace" : "Pin workspace"}
                    aria-pressed={workspace.pinned}
                    title={workspace.pinned ? "Unpin workspace" : "Pin workspace"}
                    onClick={() => onPin(workspace)}
                  >
                    <Pin />
                  </button>
                  <button
                    aria-label={hasTerminals ? "Close terminals before deleting workspace" : "Remove workspace"}
                    aria-describedby={hasTerminals ? `workspace-in-use-${workspace.id}` : undefined}
                    disabled={hasTerminals}
                    title={hasTerminals ? "Close all terminals in this workspace before removing it" : "Remove workspace"}
                    onClick={() =>
                      onConfirm({
                        title: "Remove workspace?",
                        description: "This only removes the workspace from the list. It does not delete any files.",
                        confirmLabel: "Remove",
                        danger: true,
                        action: () => onDelete(workspace),
                      })
                    }
                  >
                    <Trash2 />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <button className="path-add" onClick={onAdd}>
        <Plus />
        Add Workspace
      </button>
    </>
  );
}
