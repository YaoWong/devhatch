import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, FolderOpen, HardDrive, Home, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { listDirectories } from "../../api/terminals";
import type { DirectoryListing } from "../../types/terminals";
import { displayPath } from "../../shared/lib/utils";
import { LiveRegion } from "../../shared/ui/LiveRegion";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

export function WorkspacePicker({
  initialPath,
  purpose,
  onClose,
  onSelect,
}: {
  initialPath?: string;
  purpose: "add-launch-path" | "agent";
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const showLoading = useDelayedLoading(loading);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const resolveFinalFocus = () => {
    const previous = returnFocusRef.current;
    const previousInOpenSheet = previous?.closest('[data-slot="sheet-content"][data-open]');
    if (
      previous?.isConnected && (previousInOpenSheet || !previous.closest("[inert], .canvas-rail-auto:not(.canvas-rail-open)")) &&
      getComputedStyle(previous).display !== "none" && getComputedStyle(previous).visibility !== "hidden"
    ) return previous;
    const mobileTrigger = document.querySelector<HTMLElement>(".canvas-mobile-trigger");
    if (mobileTrigger && getComputedStyle(mobileTrigger).display !== "none") return mobileTrigger;
    const edgeTrigger = document.querySelector<HTMLElement>(".canvas-edge-trigger");
    if (edgeTrigger && getComputedStyle(edgeTrigger).display !== "none") return edgeTrigger;
    return document.querySelector<HTMLElement>(".rail:not([inert])") ?? document.body;
  };
  const requestGeneration = useRef(0);
  const mounted = useRef(true);
  const openDirectory = useCallback(async (directory?: string) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setPickerError(null);
    try {
      const next = await listDirectories(directory);
      if (mounted.current && requestGeneration.current === generation) setListing(next);
    } catch (reason) {
      if (mounted.current && requestGeneration.current === generation) {
        setPickerError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (mounted.current && requestGeneration.current === generation) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    void openDirectory(initialPath);
  }, [initialPath, openDirectory]);
  const breadcrumbs = useMemo(() => {
    if (!listing) return [];
    const homeRoot = [listing.home, listing.resolvedHome].find(
      (root) => listing.path === root || listing.path.startsWith(`${root}/`),
    );
    if (homeRoot) {
      const parts = listing.path.slice(homeRoot.length).split("/").filter(Boolean);
      return [
        { name: "~", path: homeRoot },
        ...parts.map((name, index) => ({ name, path: `${homeRoot}/${parts.slice(0, index + 1).join("/")}` })),
      ];
    }
    const parts = listing.path.split("/").filter(Boolean);
    return [
      { name: "/", path: "/" },
      ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join("/")}` })),
    ];
  }, [listing]);
  const title = purpose === "agent" ? "Add Agent Launch Path" : "Add Launch Path";
  const confirmLabel = "Add Launch Path";
  const announcement = pickerError
    ? ""
    : showLoading
      ? "Loading folders…"
      : loading
        ? ""
        : listing
          ? `${displayPath(listing.path, listing.home, listing.resolvedHome)} loaded.`
          : "";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="tw:grid tw:h-[min(680px,calc(100dvh-48px))] tw:w-[min(760px,calc(100%-48px))] tw:grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] tw:overflow-hidden tw:rounded-[20px] tw:border tw:border-border tw:bg-card tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:[@media(max-width:640px)]:inset-0 tw:[@media(max-width:640px)]:size-full tw:[@media(max-width:640px)]:translate-none tw:[@media(max-width:640px)]:rounded-none tw:[@media(max-width:640px)]:border-0" finalFocus={resolveFinalFocus}>
          <LiveRegion>{announcement}</LiveRegion>
          <header className="tw:flex tw:items-center tw:gap-[14px] tw:px-[24px] tw:pt-[22px] tw:pb-[18px] tw:[@media(max-width:640px)]:px-[16px] tw:[@media(max-width:640px)]:pt-[18px] tw:[@media(max-width:640px)]:pb-[14px]">
            <div className="tw:grid tw:size-[42px] tw:flex-none tw:place-items-center tw:rounded-[12px] tw:bg-[var(--color-accent-soft)] tw:text-[var(--color-accent)]">
              <FolderOpen className="tw:size-[21px]" />
            </div>
            <div className="tw:min-w-0">
              <DialogTitle className="tw:m-0 tw:overflow-hidden tw:text-[calc(19px*var(--app-font-scale))] tw:tracking-[-0.02em] tw:text-foreground tw:text-ellipsis tw:whitespace-nowrap">{title}</DialogTitle>
              <DialogDescription className="tw:mt-[4px] tw:mr-0 tw:mb-0 tw:ml-0 tw:text-sm tw:leading-[1.45] tw:text-muted-foreground">Choose a folder on this machine</DialogDescription>
            </div>
            <DialogClose
              aria-label="Close"
              className="tw:ml-auto tw:size-10 tw:rounded-full tw:bg-background tw:text-muted-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11"
              render={<Button variant="ghost" size="icon" />}
            >
              <X className="tw:size-[15px]" />
            </DialogClose>
          </header>
          <div className="tw:flex tw:items-center tw:gap-[6px] tw:px-[24px] tw:pb-[14px] tw:[@media(max-width:640px)]:px-[16px] tw:[@media(max-width:640px)]:pb-[12px]">
            <Button
              variant="outline"
              className="tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11"
              disabled={!listing?.parent}
              onClick={() => void openDirectory(listing?.parent ?? undefined)}
            >
              <ArrowLeft className="tw:size-[15px]" />
              <span>Up</span>
            </Button>
            <Button variant="outline" className="tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11" onClick={() => void openDirectory(listing?.home)}>
              <Home className="tw:size-[15px]" />
              <span>Home</span>
            </Button>
            <Button variant="outline" className="tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11" onClick={() => void openDirectory("/")}>
              <HardDrive className="tw:size-[15px]" />
              <span>Root</span>
            </Button>
          </div>
          <nav className="picker-breadcrumbs tw:flex tw:min-h-[44px] tw:items-center tw:gap-[2px] tw:overflow-x-auto tw:border-y tw:border-border tw:bg-[var(--color-surface-raised)] tw:px-[24px] tw:[scrollbar-width:none] tw:[@media(max-width:640px)]:px-[16px]" aria-label="Current folder">
            {breadcrumbs.map((crumb, index) => (
              <span className="tw:inline-flex tw:flex-none tw:items-center" key={crumb.path}>
                <Button variant="ghost" className="tw:min-h-10 tw:max-w-[180px] tw:overflow-hidden tw:rounded-md tw:px-[7px] tw:font-mono tw:text-xs tw:font-normal tw:text-[var(--color-text-subtle)] tw:text-ellipsis tw:whitespace-nowrap tw:[@media(pointer:coarse)]:min-h-11" onClick={() => void openDirectory(crumb.path)}>{crumb.name}</Button>
                {index < breadcrumbs.length - 1 && <ChevronRight className="tw:size-[13px] tw:text-[var(--color-text-faint)]" />}
              </span>
            ))}
          </nav>
          <div className="tw:relative tw:min-h-0 tw:overflow-y-auto tw:px-[12px] tw:py-[10px] tw:[scrollbar-color:var(--color-border-strong)_transparent] tw:[scrollbar-width:thin]">
            {showLoading && (
              <div className="tw:absolute tw:top-[12px] tw:right-[12px] tw:z-[1] tw:flex tw:items-center tw:gap-[7px] tw:rounded-[99px] tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:px-[9px] tw:py-[7px] tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.2] tw:text-muted-foreground tw:shadow-[0_6px_18px_rgb(0_0_0/8%)] tw:backdrop-blur-[8px]">
                <span className="picker-spinner tw:size-[13px]" />
                Loading folders…
              </div>
            )}
            {!loading && pickerError && (
              <div className="tw:grid tw:h-full tw:min-h-[220px] tw:place-content-center tw:justify-items-center tw:gap-[10px] tw:p-[20px] tw:text-center tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground tw:[overflow-wrap:anywhere]" role="alert">
                <strong className="tw:max-w-[52ch] tw:text-[calc(16px*var(--app-font-scale))] tw:leading-[1.35] tw:text-destructive">{pickerError}</strong>
                <Button variant="outline" className="tw:h-10 tw:rounded-full tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" onClick={() => void openDirectory(listing?.path ?? initialPath)}>Try again</Button>
              </div>
            )}
            {!pickerError && listing?.directories.length === 0 && (
              <div className="tw:grid tw:h-full tw:min-h-[220px] tw:place-content-center tw:justify-items-center tw:gap-[10px] tw:p-[20px] tw:text-center tw:text-[calc(13px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground tw:[overflow-wrap:anywhere]">
                <FolderOpen className="tw:size-[34px] tw:text-[var(--color-border-strong)]" />
                <strong className="tw:max-w-[52ch] tw:text-[calc(16px*var(--app-font-scale))] tw:leading-[1.35] tw:text-[var(--color-text-subtle)]">This folder has no subfolders</strong>
                <span>You can still select the current folder.</span>
              </div>
            )}
            {!pickerError &&
              listing?.directories.map((directory) => (
                <Button key={directory.path} variant="ghost" className="tw:h-auto tw:min-h-[58px] tw:w-full tw:justify-start tw:rounded-[11px] tw:px-3 tw:py-2 tw:font-normal tw:whitespace-normal tw:transition-[background,transform] tw:active:[transform:scale(.995)] tw:hover:bg-background! tw:[@media(pointer:coarse)]:min-h-16" onClick={() => void openDirectory(directory.path)}>
                  <span className="tw:grid tw:size-[36px] tw:flex-none tw:place-items-center tw:rounded-[9px] tw:bg-[var(--color-accent-soft)] tw:text-[var(--color-warning)]">
                    <Folder className="tw:size-[19px] tw:fill-current tw:[fill-opacity:0.12]" />
                  </span>
                  <span className="tw:min-w-0 tw:flex-1">
                    <strong className="tw:block tw:overflow-hidden tw:text-sm tw:leading-[1.25] tw:text-foreground tw:text-ellipsis tw:whitespace-nowrap">{directory.name}</strong>
                    <small className="tw:mt-[4px] tw:block tw:overflow-hidden tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.25] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">{displayPath(directory.path, listing.home, listing.resolvedHome)}</small>
                  </span>
                  <ChevronRight className="tw:ml-auto tw:size-[16px] tw:text-[var(--color-text-faint)] tw:transition-transform tw:duration-150 tw:group-hover/button:translate-x-[2px] tw:group-hover/button:text-[var(--color-text-subtle)]" />
                </Button>
              ))}
          </div>
          <footer className="tw:flex tw:items-center tw:gap-[8px] tw:border-t tw:border-border tw:bg-[var(--color-surface-raised)] tw:px-[24px] tw:pt-[16px] tw:pb-[20px] tw:[@media(max-width:640px)]:grid tw:[@media(max-width:640px)]:grid-cols-2 tw:[@media(max-width:640px)]:px-[16px] tw:[@media(max-width:640px)]:pt-[14px] tw:[@media(max-width:640px)]:pb-[18px]">
            <div className="tw:mr-auto tw:grid tw:min-w-0 tw:gap-[4px] tw:[@media(max-width:640px)]:col-span-full tw:[@media(max-width:640px)]:mt-0 tw:[@media(max-width:640px)]:mr-0 tw:[@media(max-width:640px)]:mb-[6px] tw:[@media(max-width:640px)]:ml-0">
              <span className="tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.2] tw:text-muted-foreground">Selected folder</span>
              <strong className="tw:max-w-[380px] tw:overflow-hidden tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:font-normal tw:leading-[1.3] tw:text-[var(--color-text-subtle)] tw:text-ellipsis tw:whitespace-nowrap tw:[@media(max-width:640px)]:max-w-[calc(100vw-32px)]">
                {listing ? displayPath(listing.path, listing.home, listing.resolvedHome) : "No folder selected"}
              </strong>
            </div>
            <DialogClose className="tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:[@media(pointer:coarse)]:h-11" render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className="tw:h-10 tw:rounded-full tw:bg-primary tw:px-4 tw:text-xs tw:text-primary-foreground tw:shadow-[0_6px_16px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] tw:hover:bg-[var(--color-accent-hover)] tw:[@media(pointer:coarse)]:h-11"
              disabled={!listing || loading || !!pickerError}
              onClick={() => listing && onSelect(listing.path)}
            >
              {confirmLabel}
            </Button>
          </footer>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
