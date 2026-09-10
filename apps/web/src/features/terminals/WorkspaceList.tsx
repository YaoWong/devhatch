import { useEffect, useState } from "react";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { LaunchPath, Workspace } from "../../types/workspaces";
import { RailWorkspaceList } from "../../shared/ui/RailWorkspaceList";
import { LaunchPaths } from "./LaunchPaths";

type HomePaths = { home: string; resolvedHome: string } | null;

export function WorkspaceList({
  workspaces, launchPaths, selectedWorkspaceId, selectedPathId, homePaths, launching, pathDisplay,
  onSelectWorkspace, onRenameWorkspace, onDeleteWorkspace, onNewWorkspace,
  onSelectPath, onLaunch, onPinPath, onRenamePath, onDeletePath, onConfirm, onAddPath,
}: {
  workspaces: Workspace[];
  launchPaths: LaunchPath[];
  selectedWorkspaceId: string | null;
  selectedPathId: string | null;
  homePaths: HomePaths;
  launching: boolean;
  pathDisplay: LaunchPathDisplay;
  onSelectWorkspace: (id: string) => void;
  onRenameWorkspace: (workspace: Workspace, name: string) => Promise<boolean>;
  onDeleteWorkspace: (workspace: Workspace) => Promise<boolean>;
  onNewWorkspace: () => void;
  onSelectPath: (id: string) => void;
  onLaunch: (path: string) => void;
  onPinPath: (path: LaunchPath) => void;
  onRenamePath: (path: LaunchPath, alias: string) => Promise<boolean>;
  onDeletePath: (path: LaunchPath) => Promise<boolean>;
  onConfirm: (action: ConfirmAction) => void;
  onAddPath: () => void;
}) {
  const [page, setPage] = useState(1);
  const [renamePath, setRenamePath] = useState<LaunchPath | null>(null);
  const [renameWorkspace, setRenameWorkspace] = useState<Workspace | null>(null);
  const pageCount = Math.max(1, Math.ceil(launchPaths.length / 10));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return (
    <>
      <RailWorkspaceList
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        launching={launching}
        renamingId={renameWorkspace?.id ?? null}
        memberNoun="session"
        memberSummary={(workspace) => {
          const terminals = workspace.members.filter((member) => member.kind === "terminal").length;
          const agents = workspace.members.length - terminals;
          return `${terminals} terminal${terminals === 1 ? "" : "s"} · ${agents} agent${agents === 1 ? "" : "s"}`;
        }}
        emptyMessage="Create a workspace to get started."
        deleteDescription="All Terminal and Agent panes in this workspace will be stopped. Agent CLI history is preserved."
        onSelect={onSelectWorkspace}
        onRename={setRenameWorkspace}
        onRenameSubmit={onRenameWorkspace}
        onRenameCancel={() => setRenameWorkspace(null)}
        onDelete={onDeleteWorkspace}
        onCreate={onNewWorkspace}
        onConfirm={onConfirm}
      />
      <LaunchPaths
        paths={launchPaths}
        selectedPathId={selectedPathId}
        available
        canAdd
        launching={launching}
        homePaths={homePaths}
        pathDisplay={pathDisplay}
        page={page}
        renamingId={renamePath?.id ?? null}
        onPageChange={setPage}
        onChoose={onAddPath}
        onSelect={(path) => onSelectPath(path.id)}
        onLaunch={(path) => onLaunch(path.path)}
        onPin={(path) => onPinPath(path)}
        onRename={(path) => setRenamePath(path)}
        onRenameSubmit={(path, alias) => onRenamePath(path, alias)}
        onRenameCancel={() => setRenamePath(null)}
        onDelete={(path) => onConfirm({
          title: "Delete launch path?",
          description: "This only removes the saved launch path. Running terminals and files are unchanged.",
          confirmLabel: "Delete",
          danger: true,
          action: () => onDeletePath(path),
        })}
        emptyMessage="Choose a directory to add your first shared Launch Path."
      />
    </>
  );
}
