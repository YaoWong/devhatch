import { ChevronLeft, ChevronRight, Folder, Pencil, Pin, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { TerminalLaunchPath, TerminalWorkspace } from "../../types/terminals";
import { displayPath, workspaceName } from "../../shared/lib/utils";
import { InlineRename } from "../../shared/ui/InlineRename";

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
  const visiblePaths = launchPaths.length > 24 ? launchPaths.slice((page - 1) * 10, page * 10) : launchPaths;
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return (
    <>
      <div className="menu-section">
        <div className="path-section-head"><p className="menu-label">Workspaces</p><button className="mini-action" disabled={launching} onClick={onNewWorkspace}><Plus />New</button></div>
        <div className="workspace-list">
          {workspaces.length ? workspaces.map((workspace, index) => {
            const selected = workspace.id === selectedWorkspaceId;
            return (
              <div key={workspace.id} className={`workspace-item ${selected ? "active" : ""}`}>
                {renameWorkspace?.id === workspace.id ? <div className="workspace-select"><span><InlineRename initialValue={workspace.name || `Workspace ${index + 1}`} label="workspace" allowEmpty onSubmit={(name) => onRenameWorkspace(workspace, name)} onCancel={() => setRenameWorkspace(null)} /><small>{workspace.members.length} terminal{workspace.members.length === 1 ? "" : "s"}</small></span></div> : <button className="workspace-select" aria-pressed={selected} onClick={() => onSelectWorkspace(workspace.id)}><span><strong>{workspace.name || `Workspace ${index + 1}`}</strong><small>{workspace.members.length} terminal{workspace.members.length === 1 ? "" : "s"}</small></span></button>}
                <span className="workspace-actions"><button aria-label="Rename workspace" disabled={renameWorkspace?.id === workspace.id} onClick={() => setRenameWorkspace(workspace)}><Pencil /></button><button aria-label="Disband workspace" disabled={renameWorkspace?.id === workspace.id} onClick={() => onConfirm({ title: "Disband workspace?", description: "The terminal sessions keep running, but this workspace arrangement is removed.", confirmLabel: "Disband", danger: true, action: () => onDeleteWorkspace(workspace) })}><Trash2 /></button></span>
              </div>
            );
          }) : <div className="quiet-message">Create a terminal workspace to get started.</div>}
        </div>
      </div>
      <div className="menu-section paths-section terminal-paths-section">
        <div className="path-section-head"><p className="menu-label">Launch Paths</p><button className="mini-action" onClick={onAddPath}><Plus />Add</button></div>
        <div className="agent-path-list">
          {visiblePaths.length ? visiblePaths.map((path) => (
            <div key={path.id} className="agent-path-row"><Folder />{renamePath?.id === path.id ? <div className="path-main"><span><InlineRename initialValue={path.alias || workspaceName(path.path)} label="launch path alias" allowEmpty onSubmit={(alias) => onRenamePath(path, alias)} onCancel={() => setRenamePath(null)} />{pathDisplay === "folder" && <small>{displayPath(path.path, homePaths?.home, homePaths?.resolvedHome)}</small>}</span></div> : <div className="path-main" title={path.path}><span><strong>{pathDisplay === "folder" ? path.alias || workspaceName(path.path) : path.path}</strong>{pathDisplay === "folder" && <small>{displayPath(path.path, homePaths?.home, homePaths?.resolvedHome)}</small>}</span></div>}<span className="path-actions"><button className={path.pinned ? "pinned" : ""} aria-label={path.pinned ? "Unpin path" : "Pin path"} disabled={renamePath?.id === path.id} onClick={() => onPinPath(path)}><Pin /></button><button aria-label="Launch path" disabled={launching || renamePath?.id === path.id} onClick={() => onLaunch(path.path)}><Play /></button><button aria-label="Rename alias" disabled={renamePath?.id === path.id} onClick={() => setRenamePath(path)}><Pencil /></button><button aria-label="Delete path" disabled={renamePath?.id === path.id} onClick={() => onConfirm({ title: "Delete launch path?", description: "This only removes the saved launch path. Running terminals and files are unchanged.", confirmLabel: "Delete", danger: true, action: () => onDeletePath(path) })}><Trash2 /></button></span>
            </div>
          )) : <div className="quiet-message">Choose a directory to launch your first terminal.</div>}
        </div>
        {launchPaths.length > 24 && <div className="path-pagination"><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft /></button><span>{page} / {pageCount}</span><button aria-label="Next page" disabled={page === pageCount} onClick={() => setPage(page + 1)}><ChevronRight /></button></div>}
      </div>
    </>
  );
}
