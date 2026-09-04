import { useEffect, useState } from "react";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { TerminalLaunchPath, TerminalWorkspace } from "../../types/terminals";
import { RailWorkspaceList } from "../../shared/ui/RailWorkspaceList";
import { LaunchPaths } from "../agents/LaunchPaths";

type HomePaths = { home: string; resolvedHome: string } | null;

export function WorkspaceList({
  workspaces, launchPaths, selectedWorkspaceId, homePaths, launching, pathDisplay,
  onSelectWorkspace, onRenameWorkspace, onDeleteWorkspace, onNewWorkspace,
  onLaunch, onPinPath, onRenamePath, onDeletePath, onConfirm, onAddPath,
}: {
  workspaces: TerminalWorkspace[];
  launchPaths: TerminalLaunchPath[];
  selectedWorkspaceId: string | null;
  homePaths: HomePaths;
  launching: boolean;
  pathDisplay: LaunchPathDisplay;
  onSelectWorkspace: (id: string) => void;
  onRenameWorkspace: (workspace: TerminalWorkspace, name: string) => Promise<boolean>;
  onDeleteWorkspace: (workspace: TerminalWorkspace) => Promise<boolean>;
  onNewWorkspace: () => void;
  onLaunch: (path: string) => void;
  onPinPath: (path: TerminalLaunchPath) => void;
  onRenamePath: (path: TerminalLaunchPath, alias: string) => Promise<boolean>;
  onDeletePath: (path: TerminalLaunchPath) => Promise<boolean>;
  onConfirm: (action: ConfirmAction) => void;
  onAddPath: () => void;
}) {
  const [page, setPage] = useState(1);
  const [renamePath, setRenamePath] = useState<TerminalLaunchPath | null>(null);
  const [renameWorkspace, setRenameWorkspace] = useState<TerminalWorkspace | null>(null);
  const pageCount = Math.max(1, Math.ceil(launchPaths.length / 10));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return (
    <>
      <RailWorkspaceList
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        launching={launching}
        renamingId={renameWorkspace?.id ?? null}
        memberNoun="terminal"
        emptyMessage="Create a terminal workspace to get started."
        deleteDescription="The terminal sessions keep running, but this workspace arrangement is removed."
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
        selectedPathId={null}
        available
        canAdd
        launching={launching}
        homePaths={homePaths}
        pathDisplay={pathDisplay}
        page={page}
        renamingId={renamePath?.id ?? null}
        onPageChange={setPage}
        onChoose={onAddPath}
        onSelect={undefined}
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
        emptyMessage="Choose a directory to launch your first terminal."
        className="terminal-paths-section tw:max-h-[min(52vh,480px)]"
      />
    </>
  );
}
