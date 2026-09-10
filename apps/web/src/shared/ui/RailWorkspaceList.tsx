import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RailCreateButton } from "./RailCreateButton";
import type { ConfirmAction } from "../../types/app";
import { RenameDialog } from "./RenameDialog";
import { RailQuietMessage, railMenuLabelClass, railMenuSectionClass } from "./railStyles";

const workspaceSelectClass = "tw:flex tw:min-h-10 tw:min-w-0 tw:flex-1 tw:touch-manipulation tw:items-center tw:justify-start tw:rounded-lg tw:px-2 tw:py-1 tw:text-left tw:font-normal tw:whitespace-normal tw:text-foreground tw:[@media(pointer:coarse)]:min-h-11 tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mt-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[calc(10px*var(--app-font-scale))] tw:[&_small]:leading-tight tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:font-semibold tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";
const workspaceSelectButtonClass = `${workspaceSelectClass} tw:h-auto tw:shrink tw:border-0 tw:bg-transparent tw:transition-none tw:hover:bg-transparent! tw:hover:text-foreground! tw:active:not-aria-[haspopup]:translate-y-0!`;
const workspaceActionClass = "tw:size-10 tw:min-h-0 tw:flex-none tw:touch-manipulation tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:opacity-0 tw:transition-[background,color,opacity] tw:group-hover/workspace:opacity-100 tw:group-focus-within/workspace:opacity-100 tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(hover:none)]:opacity-100 tw:[@media(pointer:coarse)]:size-11 tw:[&_svg]:size-3.5";
const workspaceDisclosureClass = "tw:size-10 tw:min-h-0 tw:flex-none tw:touch-manipulation tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11 tw:[&_svg]:size-4 tw:[&_svg]:transition-transform tw:[&_svg]:duration-150 tw:aria-expanded:[&_svg]:rotate-180";

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
  const [expanded, setExpanded] = useState(false);
  const otherWorkspacesId = useId();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = workspaces.findIndex((workspace) => workspace.id === selectedWorkspaceId);
  const currentIndex = selectedIndex < 0 ? 0 : selectedIndex;
  const currentWorkspace = workspaces[currentIndex];
  const otherWorkspaces = currentWorkspace ? workspaces.filter((workspace) => workspace.id !== currentWorkspace.id) : [];
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
  const handleDisclosureKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !expanded) return;
    event.preventDefault();
    event.stopPropagation();
    setExpanded(false);
    disclosureRef.current?.focus();
  };

  return (
    <div className={`${railMenuSectionClass} workspace-section`}>
      <div className="tw:mb-[7px] tw:flex tw:items-center tw:justify-between tw:gap-[5px]">
        <p className={`${railMenuLabelClass} tw:mb-0 tw:min-w-0 tw:flex-1 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap`}>Workspace</p>
        <RailCreateButton label="New" disabled={launching} onClick={onCreate} />
      </div>
      {currentWorkspace ? (
        <div className="tw:grid tw:min-h-0 tw:gap-2" onKeyDown={handleDisclosureKeyDown}>
          <div className="tw:group/workspace tw:flex tw:min-h-[52px] tw:w-full tw:flex-none tw:items-center tw:gap-1 tw:rounded-xl tw:border tw:border-input tw:bg-background tw:p-1 tw:transition-[background,border-color,scale] tw:active:scale-[0.985]">
            <div className={workspaceSelectClass} aria-current="true">
              {workspaceCopy(currentWorkspace)}
            </div>
            {otherWorkspaces.length ? (
              <Button
                ref={disclosureRef}
                type="button"
                variant="ghost"
                size="icon"
                className={workspaceDisclosureClass}
                aria-label={expanded ? "Hide other workspaces" : "Show other workspaces"}
                aria-expanded={expanded}
                aria-controls={otherWorkspacesId}
                onClick={() => setExpanded((value) => !value)}
              >
                <ChevronDown />
              </Button>
            ) : null}
            <span className={`tw:flex ${renamingId === currentWorkspace.id ? "tw:hidden" : ""}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={workspaceActionClass}
                aria-label="Rename workspace"
                onClick={() => onRename(currentWorkspace)}
              >
                <Pencil />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`${workspaceActionClass} tw:hover:text-destructive!`}
                aria-label="Delete workspace"
                onClick={() => onConfirm({
                  title: "Delete workspace?",
                  description: deleteDescription,
                  confirmLabel: "Delete",
                  danger: true,
                  action: () => onDelete(currentWorkspace),
                })}
              >
                <Trash2 />
              </Button>
            </span>
          </div>
          {otherWorkspaces.length ? (
            <div
              id={otherWorkspacesId}
              className="workspace-list tw:grid tw:max-h-[min(168px,24vh)] tw:min-h-0 tw:gap-2 tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain"
              hidden={!expanded}
            >
              {otherWorkspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  className="tw:group/workspace tw:flex tw:min-h-[52px] tw:w-full tw:items-center tw:gap-1 tw:rounded-xl tw:border tw:border-transparent tw:bg-transparent tw:p-1 tw:transition-[background,border-color,scale] tw:hover:border-border tw:hover:bg-background tw:active:scale-[0.985]"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className={workspaceSelectButtonClass}
                    aria-pressed={false}
                    onClick={() => {
                      setExpanded(false);
                      onSelect(workspace.id);
                    }}
                  >
                    {workspaceCopy(workspace)}
                  </Button>
                  <span className={`tw:flex ${renamingId === workspace.id ? "tw:hidden" : ""}`}>
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
                      aria-label="Delete workspace"
                      onClick={() => onConfirm({
                        title: "Delete workspace?",
                        description: deleteDescription,
                        confirmLabel: "Delete",
                        danger: true,
                        action: () => onDelete(workspace),
                      })}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : <RailQuietMessage>{emptyMessage}</RailQuietMessage>}
      {renamingId && (() => {
        const workspace = workspaces.find((item) => item.id === renamingId);
        if (!workspace) return null;
        const index = workspaces.indexOf(workspace);
        return <RenameDialog initialValue={workspace.name || `Workspace ${index + 1}`} label="workspace" allowEmpty onSubmit={(name) => onRenameSubmit(workspace, name)} onClose={onRenameCancel} />;
      })()}
    </div>
  );
}
