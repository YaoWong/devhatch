import { ChevronLeft, ChevronRight, Folder, Pencil, Pin, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { TerminalLaunchPath, TerminalWorkspace } from "../../types/terminals";
import { displayPath, workspaceName } from "../../shared/lib/utils";
import { InlineRename } from "../../shared/ui/InlineRename";

type HomePaths = { home: string; resolvedHome: string } | null;

const legacyButtonFocus = "tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2";
const newButtonClass = `${legacyButtonFocus} tw:h-7 tw:gap-[5px] tw:rounded-[8px] tw:border-input tw:bg-card tw:px-2 tw:py-0 tw:text-[10px] tw:leading-[1.2] tw:font-semibold tw:text-inherit tw:transition-none tw:hover:bg-card! tw:hover:text-inherit! tw:focus-visible:border-input! tw:disabled:pointer-events-auto tw:disabled:cursor-default tw:disabled:opacity-[0.42] tw:dark:bg-card! tw:dark:hover:bg-card! tw:[&_svg]:size-3`;
const workspaceSelectClass = "workspace-select tw:flex tw:min-h-[42px] tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:justify-start tw:gap-3 tw:rounded-[8px] tw:border-0 tw:bg-transparent tw:px-[7px] tw:py-1 tw:text-base tw:leading-[normal] tw:font-normal tw:whitespace-normal tw:text-inherit tw:text-left tw:touch-manipulation tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mt-[3px] tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[10px] tw:[&_small]:leading-[1.25] tw:[&_small]:font-normal tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-[13px] tw:[&_strong]:font-bold tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";
const workspaceSelectButtonClass = `${legacyButtonFocus} ${workspaceSelectClass} tw:h-auto tw:shrink tw:transition-none tw:hover:bg-transparent! tw:hover:text-inherit! tw:focus-visible:border-transparent! tw:dark:hover:bg-transparent!`;
const workspaceActionClass = `${legacyButtonFocus} tw:grid tw:size-[22px] tw:min-h-0 tw:place-items-center tw:rounded-[6px] tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:opacity-0 tw:transition-none tw:touch-manipulation tw:group-hover/workspace:opacity-100 tw:group-focus-within/workspace:opacity-100 tw:[@media(hover:none)]:size-9 tw:[@media(hover:none)]:opacity-100 tw:hover:bg-card! tw:hover:text-foreground! tw:focus-visible:border-transparent! tw:disabled:pointer-events-auto tw:disabled:cursor-default tw:disabled:opacity-25 tw:disabled:hover:bg-transparent! tw:disabled:hover:text-[var(--color-text-faint)]! tw:dark:hover:bg-card! tw:dark:disabled:hover:bg-transparent! tw:[&_svg]:size-3`;

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
        <div className="path-section-head">
          <p className="menu-label">Workspaces</p>
          <Button type="button" variant="outline" size="sm" className={newButtonClass} disabled={launching} onClick={onNewWorkspace}>
            <Plus className="tw:size-3" />
            New
          </Button>
        </div>
        <div className="workspace-list tw:grid tw:gap-2">
          {workspaces.length ? workspaces.map((workspace, index) => {
            const selected = workspace.id === selectedWorkspaceId;
            const renaming = renameWorkspace?.id === workspace.id;
            return (
              <div
                key={workspace.id}
                className={`workspace-item tw:group/workspace tw:flex tw:min-h-[52px] tw:w-full tw:items-center tw:gap-1 tw:rounded-[12px] tw:border tw:p-1 tw:[transition:background_180ms_ease,border-color_180ms_ease,scale_180ms_ease] tw:[&:hover]:bg-background tw:active:scale-[0.985] ${selected ? "active tw:border-input tw:bg-background tw:[&:hover]:border-input" : "tw:border-transparent tw:bg-transparent tw:[&:hover]:border-border"}`}
              >
                {renaming ? (
                  <div className={`${workspaceSelectClass} tw:py-0!`}>
                    <span>
                      <InlineRename
                        initialValue={workspace.name || `Workspace ${index + 1}`}
                        label="workspace"
                        allowEmpty
                        onSubmit={(name) => onRenameWorkspace(workspace, name)}
                        onCancel={() => setRenameWorkspace(null)}
                      />
                      <small>{workspace.members.length} terminal{workspace.members.length === 1 ? "" : "s"}</small>
                    </span>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    className={workspaceSelectButtonClass}
                    aria-pressed={selected}
                    onClick={() => onSelectWorkspace(workspace.id)}
                  >
                    <span>
                      <strong>{workspace.name || `Workspace ${index + 1}`}</strong>
                      <small>{workspace.members.length} terminal{workspace.members.length === 1 ? "" : "s"}</small>
                    </span>
                  </Button>
                )}
                <span className={`workspace-actions tw:flex ${renaming ? "tw:hidden" : ""}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={workspaceActionClass}
                    aria-label="Rename workspace"
                    disabled={renaming}
                    onClick={() => setRenameWorkspace(workspace)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={`${workspaceActionClass} tw:hover:text-destructive!`}
                    aria-label="Disband workspace"
                    disabled={renaming}
                    onClick={() => onConfirm({
                      title: "Disband workspace?",
                      description: "The terminal sessions keep running, but this workspace arrangement is removed.",
                      confirmLabel: "Disband",
                      danger: true,
                      action: () => onDeleteWorkspace(workspace),
                    })}
                  >
                    <Trash2 />
                  </Button>
                </span>
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
