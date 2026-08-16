import { Grid2X2, Plus } from "lucide-react";
import { displayPath, workspaceName } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function WorkspaceList({
  workspaces,
  selectedWorkspace,
  homePaths,
  onSelect,
  onAdd,
}: {
  workspaces: string[];
  selectedWorkspace: string | null;
  homePaths: HomePaths;
  onSelect: (workspace: string) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <div className="menu-section">
        <p className="menu-label">Workspace</p>
        <div className="workspace-list">
          {workspaces.map((workspace) => (
            <button
              key={workspace}
              className={`workspace-item ${workspace === selectedWorkspace ? "active" : ""}`}
              onClick={() => onSelect(workspace)}
            >
              <Grid2X2 />
              <span>
                <strong>{workspaceName(workspace)}</strong>
                <small>{displayPath(workspace, homePaths?.home, homePaths?.resolvedHome)}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
      <button className="path-add" onClick={onAdd}>
        <Plus />
        Add Workspace
      </button>
    </>
  );
}
