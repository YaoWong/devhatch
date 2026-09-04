import { useId, useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Ellipsis, Folder, Pencil, Pin, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgentLaunchPath } from "../../types/agents";
import type { LaunchPathDisplay } from "../../types/app";
import { displayPath, workspaceName } from "../../shared/lib/utils";
import { dispatchCustomSelectOpenChange } from "../../shared/ui/customSelectPortal";
import { InlineRename } from "../../shared/ui/InlineRename";

type HomePaths = { home: string; resolvedHome: string } | null;

const pathMainClass = "path-main tw:h-auto tw:min-h-10 tw:min-w-0 tw:flex-1 tw:shrink tw:justify-start tw:gap-0 tw:rounded-md tw:border-0 tw:bg-transparent tw:p-1 tw:text-left tw:font-normal tw:whitespace-normal tw:text-foreground tw:transition-none tw:hover:bg-transparent! tw:hover:text-foreground! tw:active:not-aria-[haspopup]:translate-y-0! tw:[@media(pointer:coarse)]:min-h-11 tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mt-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:font-mono tw:[&_small]:text-[10px] tw:[&_small]:leading-tight tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-xs tw:[&_strong]:leading-tight tw:[&_strong]:font-semibold tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap";
const pathActionClass = "tw:pointer-events-none tw:size-10 tw:min-h-0 tw:flex-none tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-[var(--color-text-faint)] tw:opacity-0 tw:transition-[background,color,opacity] tw:hover:bg-muted! tw:hover:text-foreground! tw:group-hover/path:pointer-events-auto tw:group-hover/path:opacity-100 tw:group-focus-within/path:pointer-events-auto tw:group-focus-within/path:opacity-100 tw:data-popup-open:pointer-events-auto tw:data-popup-open:bg-muted tw:data-popup-open:text-foreground tw:data-popup-open:opacity-100 tw:[@media(pointer:coarse)]:pointer-events-auto tw:[@media(pointer:coarse)]:size-11 tw:[@media(pointer:coarse)]:opacity-100 tw:[&_svg]:size-3.5";
const paginationButtonClass = "tw:size-10 tw:rounded-lg tw:border-input tw:bg-card tw:p-0 tw:text-muted-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11 tw:[&_svg]:size-3.5";

export function LaunchPaths({
  paths,
  selectedPathId,
  available,
  canAdd,
  launching,
  homePaths,
  pathDisplay,
  page,
  renamingId,
  onPageChange,
  onChoose,
  onSelect,
  onLaunch,
  onPin,
  onRename,
  onRenameSubmit,
  onRenameCancel,
  onDelete,
  emptyMessage = "Choose a directory to launch your first session.",
  className = "",
}: {
  paths: AgentLaunchPath[];
  selectedPathId?: string | null;
  available: boolean;
  canAdd: boolean;
  launching: boolean;
  homePaths: HomePaths;
  pathDisplay: LaunchPathDisplay;
  page: number;
  renamingId: string | null;
  onPageChange: (page: number) => void;
  onChoose: () => void;
  onSelect?: (path: AgentLaunchPath) => void;
  onLaunch: (path: AgentLaunchPath) => void;
  onPin: (path: AgentLaunchPath) => void;
  onRename: (path: AgentLaunchPath) => void;
  onRenameSubmit: (path: AgentLaunchPath, alias: string) => Promise<boolean>;
  onRenameCancel: () => void;
  onDelete: (path: AgentLaunchPath) => void;
  emptyMessage?: string;
  className?: string;
}) {
  const portalOwnerId = useId();
  const portalOwnerRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openMenuRef = useRef(false);
  const pageCount = Math.max(1, Math.ceil(paths.length / 10));
  const visiblePaths = paths.length > 24 ? paths.slice((page - 1) * 10, page * 10) : paths;
  useLayoutEffect(() => {
    const owner = portalOwnerRef.current;
    return () => {
      if (openMenuRef.current) dispatchCustomSelectOpenChange(owner, false);
    };
  }, []);
  return (
    <div ref={portalOwnerRef} id={portalOwnerId} className={`menu-section paths-section ${className}`}>
      <div className="path-section-head">
        <p className="menu-label">Launch Paths</p>
        <Button
          type="button"
          variant="outline"
          className="tw:h-10 tw:rounded-lg tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11"
          disabled={!canAdd}
          onClick={onChoose}
        >
          <Plus className="tw:size-3.5" />
          Add
        </Button>
      </div>
      <div className="agent-path-list tw:grid tw:min-h-0 tw:flex-1 tw:content-start tw:gap-1 tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain">
        {visiblePaths.length ? (
          visiblePaths.map((item) => {
            const renaming = renamingId === item.id;
            return (
              <div
                key={item.id}
                className={`agent-path-row tw:group/path tw:relative tw:flex tw:min-h-12 tw:w-full tw:min-w-0 tw:items-center tw:gap-1 tw:rounded-[10px] tw:border tw:px-1 tw:py-1 tw:transition-[background,border-color] ${selectedPathId === item.id ? "active tw:border-input tw:bg-card" : "tw:border-transparent tw:bg-transparent tw:hover:border-border tw:hover:bg-background"}`}
              >
                <Folder className="tw:size-3.5 tw:flex-none tw:text-[var(--color-warning-fg)]" />
                {renaming ? (
                  <div className={pathMainClass}>
                    <span>
                      <InlineRename
                        initialValue={item.alias || workspaceName(item.path)}
                        label="launch path alias"
                        allowEmpty
                        onSubmit={(alias) => onRenameSubmit(item, alias)}
                        onCancel={onRenameCancel}
                      />
                      {pathDisplay === "folder" && <small>{displayPath(item.path, homePaths?.home, homePaths?.resolvedHome)}</small>}
                    </span>
                  </div>
                ) : onSelect ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className={pathMainClass}
                    title={item.path}
                    aria-pressed={selectedPathId === item.id}
                    onClick={(event) => {
                      onSelect(item);
                      if (event.detail > 0) event.currentTarget.blur();
                    }}
                  >
                    <span>
                      <strong>{pathDisplay === "folder" ? item.alias || workspaceName(item.path) : item.path}</strong>
                      {pathDisplay === "folder" && (
                        <small>{displayPath(item.path, homePaths?.home, homePaths?.resolvedHome)}</small>
                      )}
                    </span>
                  </Button>
                ) : (
                  <div className={pathMainClass} title={item.path}>
                    <span>
                      <strong>{pathDisplay === "folder" ? item.alias || workspaceName(item.path) : item.path}</strong>
                      {pathDisplay === "folder" && (
                        <small>{displayPath(item.path, homePaths?.home, homePaths?.resolvedHome)}</small>
                      )}
                    </span>
                  </div>
                )}
                <span className={`path-actions tw:flex tw:w-10 tw:flex-none tw:overflow-hidden tw:transition-[width] tw:group-hover/path:w-[120px] tw:group-focus-within/path:w-[120px] tw:has-[[data-popup-open]]:w-[120px] tw:[@media(pointer:coarse)]:w-[132px] ${renaming ? "tw:hidden" : ""}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={`${pathActionClass} ${item.pinned ? "pinned tw:pointer-events-auto tw:bg-[var(--color-accent-soft)] tw:text-[var(--color-warning-fg)] tw:opacity-100 tw:shadow-[inset_0_0_0_1px_var(--color-border-strong)] tw:hover:text-[var(--color-warning-fg)]! tw:[&_svg]:-rotate-12 tw:[&_svg]:fill-current tw:[&_svg]:fill-opacity-20" : ""}`}
                    aria-label={item.pinned ? "Unpin path" : "Pin path"}
                    aria-pressed={item.pinned}
                    title={item.pinned ? "Pinned" : "Pin path"}
                    onClick={(event) => {
                      onPin(item);
                      if (event.detail > 0) event.currentTarget.blur();
                    }}
                  >
                    <Pin />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={pathActionClass}
                    aria-label="Launch path"
                    disabled={!available || launching}
                    onClick={(event) => {
                      onLaunch(item);
                      if (event.detail > 0) event.currentTarget.blur();
                    }}
                  >
                    <Play />
                  </Button>
                  <DropdownMenu
                    modal={false}
                    onOpenChange={(open) => {
                      openMenuRef.current = open;
                      dispatchCustomSelectOpenChange(portalOwnerRef.current, open);
                    }}
                  >
                    <DropdownMenuTrigger
                      onFocus={(event) => { menuTriggerRef.current = event.currentTarget; }}
                      onClick={(event) => { menuTriggerRef.current = event.currentTarget; }}
                      aria-label={`Path actions for ${item.alias || workspaceName(item.path)}`}
                      render={<Button type="button" variant="ghost" size="icon" className={pathActionClass} />}
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent portalOwner={portalOwnerId} align="end" side="bottom" sideOffset={6} className="tw:w-44">
                      <DropdownMenuItem onClick={() => onRename(item)}>
                        <Pencil />
                        Rename alias
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => {
                          menuTriggerRef.current?.focus();
                          queueMicrotask(() => onDelete(item));
                        }}
                      >
                        <Trash2 />
                        Delete path
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
            );
          })
        ) : (
          <div className="quiet-message">{emptyMessage}</div>
        )}
      </div>
      {paths.length > 24 && (
        <div className="path-pagination tw:mt-1.5 tw:flex tw:items-center tw:justify-between tw:font-mono tw:text-[10px] tw:text-muted-foreground">
          <Button type="button" variant="outline" size="icon" className={paginationButtonClass} aria-label="Previous page" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft />
          </Button>
          <span>
            {page} / {pageCount}
          </span>
          <Button type="button" variant="outline" size="icon" className={paginationButtonClass} aria-label="Next page" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
