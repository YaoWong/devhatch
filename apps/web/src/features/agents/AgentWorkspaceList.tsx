import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConfirmAction } from "../../types/app";
import type { AgentWorkspace } from "../../types/agents";
import { InlineRename } from "../../shared/ui/InlineRename";

const legacyButtonFocus = "tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2";
const newButtonClass = `${legacyButtonFocus} tw:h-7 tw:gap-[5px] tw:rounded-[8px] tw:border-input tw:bg-card tw:px-2 tw:py-0 tw:text-[9px] tw:leading-[normal] tw:font-semibold tw:text-inherit tw:transition-none tw:hover:bg-card! tw:hover:text-inherit! tw:focus-visible:border-input! tw:disabled:pointer-events-auto tw:disabled:cursor-default tw:disabled:opacity-[0.42] tw:dark:bg-card! tw:dark:hover:bg-card! tw:[&_svg]:size-3`;
const workspaceSelectClass = "workspace-select tw:flex tw:min-h-[42px] tw:min-w-0 tw:flex-1 tw:cursor-pointer tw:items-center tw:justify-start tw:gap-3 tw:rounded-[8px] tw:border-0 tw:bg-transparent tw:px-[7px] tw:py-1 tw:text-base tw:leading-[normal] tw:font-normal tw:whitespace-normal tw:text-inherit tw:text-left tw:touch-manipulation tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mt-[3px] tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[9px] tw:[&_small]:leading-[1.3] tw:[&_small]:font-normal tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-[13px] tw:[&_strong]:font-bold tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";
const workspaceSelectButtonClass = `${legacyButtonFocus} ${workspaceSelectClass} tw:h-auto tw:shrink tw:transition-none tw:hover:bg-transparent! tw:hover:text-inherit! tw:focus-visible:border-transparent! tw:dark:hover:bg-transparent!`;
const workspaceActionClass = `${legacyButtonFocus} tw:grid tw:size-[22px] tw:min-h-0 tw:place-items-center tw:rounded-[6px] tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:opacity-0 tw:transition-none tw:touch-manipulation tw:group-hover/workspace:opacity-100 tw:group-focus-within/workspace:opacity-100 tw:[@media(hover:none)]:opacity-100 tw:hover:bg-card! tw:hover:text-foreground! tw:focus-visible:border-transparent! tw:disabled:pointer-events-auto tw:disabled:cursor-default tw:disabled:opacity-25 tw:disabled:hover:bg-transparent! tw:disabled:hover:text-[var(--color-text-faint)]! tw:dark:hover:bg-card! tw:dark:disabled:hover:bg-transparent! tw:[&_svg]:size-3`;

export function AgentWorkspaceList({
  workspaces,
  selectedWorkspaceId,
  launching,
  renamingId,
  onSelect,
  onRename,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
  onCreate,
  onConfirm,
}: {
  workspaces: AgentWorkspace[];
  selectedWorkspaceId: string | null;
  launching: boolean;
  renamingId: string | null;
  onSelect: (id: string) => void;
  onRename: (workspace: AgentWorkspace) => void;
  onRenameSubmit: (workspace: AgentWorkspace, name: string) => Promise<boolean>;
  onRenameCancel: () => void;
  onDelete: (workspace: AgentWorkspace) => Promise<boolean>;
  onCreate: () => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  return (
    <div className="menu-section">
      <div className="path-section-head">
        <p className="menu-label">Workspaces</p>
        <Button type="button" variant="outline" size="sm" className={newButtonClass} disabled={launching} onClick={onCreate}>
          <Plus className="tw:size-3" />
          New
        </Button>
      </div>
      <div className="workspace-list tw:grid tw:gap-2">
        {workspaces.length ? workspaces.map((workspace, index) => {
          const selected = workspace.id === selectedWorkspaceId;
          const renaming = renamingId === workspace.id;
          return (
            <div
              key={workspace.id}
              className={`workspace-item tw:group/workspace tw:flex tw:min-h-[52px] tw:w-full tw:items-center tw:gap-1 tw:rounded-[12px] tw:border tw:p-1 tw:[transition:background_180ms_ease,border-color_180ms_ease,scale_180ms_ease] tw:[&:hover]:bg-background tw:active:scale-[0.985] ${selected ? "active tw:border-input tw:bg-background tw:[&:hover]:border-input" : "tw:border-transparent tw:bg-transparent tw:[&:hover]:border-border"}`}
            >
              {renaming ? (
                <div className={workspaceSelectClass}>
                  <span>
                    <InlineRename
                      initialValue={workspace.name || `Workspace ${index + 1}`}
                      label="workspace"
                      allowEmpty
                      onSubmit={(name) => onRenameSubmit(workspace, name)}
                      onCancel={onRenameCancel}
                    />
                    <small>{workspace.members.length} agent session{workspace.members.length === 1 ? "" : "s"}</small>
                  </span>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className={workspaceSelectButtonClass}
                  aria-pressed={selected}
                  onClick={() => onSelect(workspace.id)}
                >
                  <span>
                    <strong>{workspace.name || `Workspace ${index + 1}`}</strong>
                    <small>{workspace.members.length} agent session{workspace.members.length === 1 ? "" : "s"}</small>
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
                  onClick={() => onRename(workspace)}
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
                    description: "The agent sessions keep running, but this workspace arrangement is removed.",
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
        }) : <div className="quiet-message">Create an agent workspace to get started.</div>}
      </div>
    </div>
  );
}
