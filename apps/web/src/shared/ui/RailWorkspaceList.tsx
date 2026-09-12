import { useId, useLayoutEffect, useRef } from "react";
import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RailCreateButton } from "./RailCreateButton";
import type { ConfirmAction } from "../../types/app";
import { dispatchCustomSelectOpenChange } from "./customSelectPortal";
import { RenameDialog } from "./RenameDialog";
import { RailQuietMessage, railMenuLabelClass, railMenuSectionClass } from "./railStyles";

const workspaceMainClass = "tw:flex tw:h-auto tw:min-h-10 tw:min-w-0 tw:flex-1 tw:shrink tw:items-center tw:justify-start tw:rounded-md tw:border-0 tw:bg-transparent tw:p-1 tw:text-left tw:font-normal tw:whitespace-normal tw:text-foreground tw:transition-none tw:hover:bg-transparent! tw:hover:text-foreground! tw:active:not-aria-[haspopup]:translate-y-0! tw:[@media(pointer:coarse)]:min-h-11 tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mt-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[calc(10px*var(--app-font-scale))] tw:[&_small]:leading-tight tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:leading-tight tw:[&_strong]:font-semibold tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";
const workspaceActionClass = "tw:pointer-events-none tw:size-10 tw:min-h-[40px] tw:min-w-[40px] tw:flex-none tw:touch-manipulation tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:opacity-0 tw:transition-[background,color,opacity] tw:hover:bg-muted! tw:hover:text-foreground! tw:group-hover/workspace:pointer-events-auto tw:group-hover/workspace:opacity-100 tw:group-focus-within/workspace:pointer-events-auto tw:group-focus-within/workspace:opacity-100 tw:data-popup-open:pointer-events-auto tw:data-popup-open:bg-muted tw:data-popup-open:text-foreground tw:data-popup-open:opacity-100 tw:[@media(pointer:coarse)]:pointer-events-auto tw:[@media(pointer:coarse)]:size-11 tw:[@media(pointer:coarse)]:min-h-[44px] tw:[@media(pointer:coarse)]:min-w-[44px] tw:[@media(pointer:coarse)]:opacity-100 tw:[&_svg]:size-3.5";
const workspaceActionsClass = "workspace-actions tw:flex tw:w-[max(40px,calc(40px*var(--app-ui-scale)))] tw:flex-none tw:overflow-hidden tw:[@media(pointer:coarse)]:w-[max(44px,calc(44px*var(--app-ui-scale)))]";

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
  memberSummary,
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
  memberSummary?: (workspace: T) => string;
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
  const portalOwnerId = useId();
  const portalOwnerRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const actionMenuOpenRef = useRef(false);
  const workspaceCopy = (workspace: T) => {
    const index = workspaces.indexOf(workspace);
    const memberCount = workspace.members.length;
    return (
      <span>
        <strong>{workspace.name || `Workspace ${index + 1}`}</strong>
        <small>{memberSummary ? memberSummary(workspace) : `${memberCount} ${memberNoun}${memberCount === 1 ? "" : "s"}`}</small>
      </span>
    );
  };
  const deleteWorkspace = (workspace: T) => onConfirm({
    title: "Delete workspace?",
    description: deleteDescription,
    confirmLabel: "Delete",
    danger: true,
    action: () => onDelete(workspace),
  });
  const workspaceActions = (workspace: T) => (
    <span className={`${workspaceActionsClass} ${renamingId === workspace.id ? "tw:hidden" : ""}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`workspace-wide-action ${workspaceActionClass}`}
        aria-label="Rename workspace"
        onClick={() => onRename(workspace)}
      >
        <Pencil />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`workspace-wide-action ${workspaceActionClass} tw:hover:text-destructive!`}
        aria-label="Delete workspace"
        onClick={() => deleteWorkspace(workspace)}
      >
        <Trash2 />
      </Button>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          actionMenuOpenRef.current = open;
          dispatchCustomSelectOpenChange(portalOwnerRef.current, open);
        }}
      >
        <DropdownMenuTrigger
          onFocus={(event) => { menuTriggerRef.current = event.currentTarget; }}
          onClick={(event) => { menuTriggerRef.current = event.currentTarget; }}
          aria-label={`Workspace actions for ${workspace.name || `Workspace ${workspaces.indexOf(workspace) + 1}`}`}
          render={<Button type="button" variant="ghost" size="icon" className={`workspace-overflow-action ${workspaceActionClass}`} />}
        >
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent portalOwner={portalOwnerId} align="end" side="bottom" sideOffset={6} className="tw:w-44">
          <DropdownMenuItem onClick={() => {
            menuTriggerRef.current?.focus();
            queueMicrotask(() => onRename(workspace));
          }}>
            <Pencil />
            Rename workspace
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              menuTriggerRef.current?.focus();
              queueMicrotask(() => deleteWorkspace(workspace));
            }}
          >
            <Trash2 />
            Delete workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
  useLayoutEffect(() => {
    const owner = portalOwnerRef.current;
    return () => {
      if (actionMenuOpenRef.current) dispatchCustomSelectOpenChange(owner, false);
    };
  }, []);

  return (
    <div ref={portalOwnerRef} id={portalOwnerId} className={`${railMenuSectionClass} workspace-section`}>
      <div className="tw:mb-[7px] tw:flex tw:items-center tw:justify-between tw:gap-[5px]">
        <p className={`${railMenuLabelClass} tw:mb-0 tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap`}>Workspace</p>
        <RailCreateButton label="New" disabled={launching} onClick={onCreate} />
      </div>
      <div className="workspace-list tw:grid tw:min-h-0 tw:touch-pan-y tw:content-start tw:gap-1 tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain">
        {workspaces.length ? workspaces.map((workspace) => {
          const selected = workspace.id === selectedWorkspaceId;
          return (
            <div
              key={workspace.id}
              className={`workspace-row tw:group/workspace tw:flex tw:min-h-12 tw:w-full tw:min-w-0 tw:items-center tw:gap-1 tw:rounded-[10px] tw:border tw:px-1 tw:py-1 tw:transition-[background,border-color] ${selected ? "tw:border-input tw:bg-card" : "tw:border-transparent tw:bg-transparent tw:hover:border-border tw:hover:bg-background"}`}
            >
              <Button
                type="button"
                variant="ghost"
                className={workspaceMainClass}
                aria-pressed={selected}
                onClick={(event) => {
                  if (!selected) onSelect(workspace.id);
                  if (event.detail > 0) event.currentTarget.blur();
                }}
              >
                {workspaceCopy(workspace)}
              </Button>
              {workspaceActions(workspace)}
            </div>
          );
        }) : <RailQuietMessage>{emptyMessage}</RailQuietMessage>}
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
