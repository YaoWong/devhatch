import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConfirmAction } from "../../types/app";
import { RenameDialog } from "./RenameDialog";

const workspaceCreateClass = "tw:h-10 tw:touch-manipulation tw:rounded-lg tw:border-input tw:bg-card tw:px-3 tw:text-xs tw:text-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:h-11 tw:[&_svg]:size-3.5";
const workspaceSelectClass = "workspace-select tw:flex tw:min-h-10 tw:min-w-0 tw:flex-1 tw:touch-manipulation tw:items-center tw:justify-start tw:rounded-lg tw:px-2 tw:py-1 tw:text-left tw:font-normal tw:whitespace-normal tw:text-foreground tw:[@media(pointer:coarse)]:min-h-11 tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mt-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[calc(10px*var(--app-font-scale))] tw:[&_small]:leading-tight tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-xs tw:[&_strong]:font-semibold tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";
const workspaceSelectButtonClass = `${workspaceSelectClass} tw:h-auto tw:shrink tw:border-0 tw:bg-transparent tw:transition-none tw:hover:bg-transparent! tw:hover:text-foreground! tw:active:not-aria-[haspopup]:translate-y-0!`;
const workspaceActionClass = "tw:size-10 tw:min-h-0 tw:flex-none tw:touch-manipulation tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:opacity-0 tw:transition-[background,color,opacity] tw:group-hover/workspace:opacity-100 tw:group-focus-within/workspace:opacity-100 tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(hover:none)]:opacity-100 tw:[@media(pointer:coarse)]:size-11 tw:[&_svg]:size-3.5";

type RailWorkspace = {
  id: string;
  name: string | null;
  members: readonly unknown[];
};

export function RailWorkspaceList<T extends RailWorkspace>({
  workspaces,
  selectedWorkspaceId,
  launching,
  renamingId,
  memberNoun,
  emptyMessage,
  deleteDescription,
  onSelect,
  onRename,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
  onCreate,
  onConfirm,
}: {
  workspaces: T[];
  selectedWorkspaceId: string | null;
  launching: boolean;
  renamingId: string | null;
  memberNoun: string;
  emptyMessage: string;
  deleteDescription: string;
  onSelect: (id: string) => void;
  onRename: (workspace: T) => void;
  onRenameSubmit: (workspace: T, name: string) => Promise<boolean>;
  onRenameCancel: () => void;
  onDelete: (workspace: T) => Promise<boolean>;
  onCreate: () => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  return (
    <div className="menu-section">
      <div className="path-section-head">
        <p className="menu-label">Workspaces</p>
        <Button type="button" variant="outline" className={workspaceCreateClass} disabled={launching} onClick={onCreate}>
          <Plus />
          New
        </Button>
      </div>
      <div className="tw:grid tw:gap-2">
        {workspaces.length ? workspaces.map((workspace, index) => {
          const selected = workspace.id === selectedWorkspaceId;
          const renaming = renamingId === workspace.id;
          const memberCount = workspace.members.length;
          return (
            <div
              key={workspace.id}
              className={`workspace-item tw:group/workspace tw:flex tw:min-h-[52px] tw:w-full tw:items-center tw:gap-1 tw:rounded-xl tw:border tw:p-1 tw:transition-[background,border-color,scale] tw:active:scale-[0.985] ${selected ? "active tw:border-input tw:bg-background" : "tw:border-transparent tw:bg-transparent tw:hover:border-border tw:hover:bg-background"}`}
            >
               <Button
                 type="button"
                 variant="ghost"
                 className={workspaceSelectButtonClass}
                 aria-pressed={selected}
                 onClick={() => onSelect(workspace.id)}
               >
                 <span>
                   <strong>{workspace.name || `Workspace ${index + 1}`}</strong>
                   <small>{memberCount} {memberNoun}{memberCount === 1 ? "" : "s"}</small>
                 </span>
               </Button>
              <span className={`tw:flex ${renaming ? "tw:hidden" : ""}`}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={workspaceActionClass}
                  aria-label="Rename workspace"
                  onClick={() => onRename(workspace)}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={`${workspaceActionClass} tw:hover:text-destructive!`}
                  aria-label="Disband workspace"
                  onClick={() => onConfirm({
                    title: "Disband workspace?",
                    description: deleteDescription,
                    confirmLabel: "Disband",
                    danger: true,
                    action: () => onDelete(workspace),
                  })}
                >
                  <Trash2 />
                </Button>
              </span>
            </div>
          );
         }) : <div className="quiet-message">{emptyMessage}</div>}
       </div>
       {renamingId && (() => {
         const workspace = workspaces.find((item) => item.id === renamingId);
         if (!workspace) return null;
         const index = workspaces.indexOf(workspace);
         return <RenameDialog initialValue={workspace.name || `Workspace ${index + 1}`} label="workspace" allowEmpty onSubmit={(name) => onRenameSubmit(workspace, name)} onClose={onRenameCancel} />;
       })()}
     </div>
  );
}
