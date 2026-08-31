import { ChevronLeft, ChevronRight, Folder, Pencil, Pin, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { TerminalLaunchPath, TerminalWorkspace } from "../../types/terminals";
import { displayPath, workspaceName } from "../../shared/lib/utils";

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
  onRenameWorkspace: (workspace: TerminalWorkspace) => void;
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
  const [renameAlias, setRenameAlias] = useState("");
  const pageCount = Math.max(1, Math.ceil(launchPaths.length / 10));
  const visiblePaths = launchPaths.length > 24 ? launchPaths.slice((page - 1) * 10, page * 10) : launchPaths;
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);
  return (
    <>
      {renamePath && (
        <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRenamePath(null)}>
          <div className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-path-rename-title">
            <h2 id="terminal-path-rename-title">Rename launch path</h2>
            <p>{renamePath.path}</p>
            <label>Alias<input autoFocus value={renameAlias} maxLength={120} onChange={(event) => setRenameAlias(event.target.value)} /></label>
            <div className="dialog-buttons"><button onClick={() => setRenamePath(null)}>Cancel</button><button className="primary" onClick={() => void onRenamePath(renamePath, renameAlias).then((saved) => saved && setRenamePath(null))}>Save</button></div>
          </div>
        </div>
      )}
      <div className="menu-section">
        <div className="path-section-head"><p className="menu-label">Workspaces</p><button className="mini-action" disabled={launching} onClick={onNewWorkspace}><Plus />New</button></div>
        <div className="workspace-list">
          {workspaces.length ? workspaces.map((workspace, index) => {
            const selected = workspace.id === selectedWorkspaceId;
            return (
              <div key={workspace.id} className={`workspace-item ${selected ? "active" : ""}`}>
                <button className="workspace-select" aria-pressed={selected} onClick={() => onSelectWorkspace(workspace.id)}><span><strong>{workspace.name || `Workspace ${index + 1}`}</strong><small>{workspace.members.length} terminal{workspace.members.length === 1 ? "" : "s"}</small></span></button>
                <span className="workspace-actions"><button aria-label="Rename workspace" onClick={() => onRenameWorkspace(workspace)}><Pencil /></button><button aria-label="Disband workspace" onClick={() => onConfirm({ title: "Disband workspace?", description: "The terminal sessions keep running, but this workspace arrangement is removed.", confirmLabel: "Disband", danger: true, action: () => onDeleteWorkspace(workspace) })}><Trash2 /></button></span>
              </div>
            );
          }) : <div className="quiet-message">Create a terminal workspace to get started.</div>}
        </div>
      </div>
      <div className="menu-section paths-section terminal-paths-section">
        <div className="path-section-head"><p className="menu-label">Launch Paths</p><button className="mini-action" onClick={onAddPath}><Plus />Add</button></div>
        <div className="agent-path-list">
          {visiblePaths.length ? visiblePaths.map((path) => (
            <div key={path.id} className="agent-path-row"><Folder /><div className="path-main" title={path.path}><span><strong>{pathDisplay === "folder" ? path.alias || workspaceName(path.path) : path.path}</strong>{pathDisplay === "folder" && <small>{displayPath(path.path, homePaths?.home, homePaths?.resolvedHome)}</small>}</span></div><span className="path-actions"><button className={path.pinned ? "pinned" : ""} aria-label={path.pinned ? "Unpin path" : "Pin path"} onClick={() => onPinPath(path)}><Pin /></button><button aria-label="Launch path" disabled={launching} onClick={() => onLaunch(path.path)}><Play /></button><button aria-label="Rename alias" onClick={() => { setRenamePath(path); setRenameAlias(path.alias ?? ""); }}><Pencil /></button><button aria-label="Delete path" onClick={() => onConfirm({ title: "Delete launch path?", description: "This only removes the saved launch path. Running terminals and files are unchanged.", confirmLabel: "Delete", danger: true, action: () => onDeletePath(path) })}><Trash2 /></button></span>
            </div>
          )) : <div className="quiet-message">Choose a directory to launch your first terminal.</div>}
        </div>
        {launchPaths.length > 24 && <div className="path-pagination"><button aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft /></button><span>{page} / {pageCount}</span><button aria-label="Next page" disabled={page === pageCount} onClick={() => setPage(page + 1)}><ChevronRight /></button></div>}
      </div>
    </>
  );
}
