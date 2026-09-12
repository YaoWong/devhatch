import { useEffect, useState } from "react";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { LaunchPath, Workspace } from "../../types/workspaces";
import { RailWorkspaceList } from "../../shared/ui/RailWorkspaceList";
import { LaunchPaths } from "./LaunchPaths";

type HomePaths = { home: string; resolvedHome: string } | null;

type WorkspaceListProps = {
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  launching: boolean;
  onSelectWorkspace: (id: string) => void;
  onRenameWorkspace: (workspace: Workspace, name: string) => Promise<boolean>;
  onDeleteWorkspace: (workspace: Workspace) => Promise<boolean>;
  onNewWorkspace: () => void;
  onConfirm: (action: ConfirmAction) => void;
};

export function WorkspaceList({
  workspaces,
  selectedWorkspaceId,
  launching,
  onSelectWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onNewWorkspace,
  onConfirm,
}: WorkspaceListProps) {
  const [renameWorkspace, setRenameWorkspace] = useState<Workspace | null>(null);
  return (
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
  );
}

export function WorkspaceLaunchPaths({
  launchPaths,
  selectedPathId,
  homePaths,
  launching,
  launchTargetName,
  launchAvailable,
  pathDisplay,
  onSelectPath,
  onLaunch,
  onPinPath,
  onRenamePath,
  onDeletePath,
  onConfirm,
  onAddPath,
}: {
  launchPaths: LaunchPath[];
  selectedPathId: string | null;
  homePaths: HomePaths;
  launching: boolean;
  launchTargetName: string;
  launchAvailable: boolean;
  pathDisplay: LaunchPathDisplay;
  onSelectPath: (id: string) => void;
  onLaunch: (path: LaunchPath) => void;
  onPinPath: (path: LaunchPath) => void;
  onRenamePath: (path: LaunchPath, alias: string) => Promise<boolean>;
  onDeletePath: (path: LaunchPath) => Promise<boolean>;
  onConfirm: (action: ConfirmAction) => void;
  onAddPath: () => void;
}) {
  const [page, setPage] = useState(1);
  const [renamePath, setRenamePath] = useState<LaunchPath | null>(null);
  const pageCount = Math.max(1, Math.ceil(launchPaths.length / 10));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return (
    <LaunchPaths
      paths={launchPaths}
      selectedPathId={selectedPathId}
      available={launchAvailable}
      canAdd
      launching={launching}
      launchTargetName={launchTargetName}
      homePaths={homePaths}
      pathDisplay={pathDisplay}
      page={page}
      renamingId={renamePath?.id ?? null}
      onPageChange={setPage}
      onChoose={onAddPath}
      onSelect={(path) => onSelectPath(path.id)}
      onLaunch={onLaunch}
      onPin={onPinPath}
      onRename={setRenamePath}
      onRenameSubmit={onRenamePath}
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
  );
}
