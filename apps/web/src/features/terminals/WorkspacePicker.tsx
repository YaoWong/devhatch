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
        <DialogContent className="folder-picker tw:grid tw:h-[min(680px,calc(100dvh-48px))] tw:w-[min(760px,calc(100%-48px))] tw:grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] tw:overflow-hidden tw:rounded-[20px] tw:border tw:border-border tw:bg-card tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:max-sm:inset-0 tw:max-sm:size-full tw:max-sm:translate-none tw:max-sm:rounded-none tw:max-sm:border-0" finalFocus={resolveFinalFocus}>
          <LiveRegion>{announcement}</LiveRegion>
          <header className="picker-header">
            <div className="picker-title-icon">
              <FolderOpen />
            </div>
            <div className="picker-header-copy">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>Choose a folder on this machine</DialogDescription>
            </div>
            <DialogClose
              aria-label="Close"
              className="picker-close tw:ml-auto tw:size-10 tw:rounded-full tw:bg-background tw:text-muted-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11"
              render={<Button variant="ghost" size="icon" />}
            >
              <X />
            </DialogClose>
          </header>
          <div className="picker-toolbar">
            <Button
              variant="outline"
              className="picker-location tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11"
              disabled={!listing?.parent}
              onClick={() => void openDirectory(listing?.parent ?? undefined)}
            >
              <ArrowLeft />
              <span>Up</span>
            </Button>
            <Button variant="outline" className="picker-location tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11" onClick={() => void openDirectory(listing?.home)}>
              <Home />
              <span>Home</span>
            </Button>
            <Button variant="outline" className="picker-location tw:h-10 tw:rounded-[9px] tw:px-3 tw:text-xs tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11" onClick={() => void openDirectory("/")}>
              <HardDrive />
              <span>Root</span>
            </Button>
          </div>
          <nav className="picker-breadcrumbs" aria-label="Current folder">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.path}>
                <Button variant="ghost" className="tw:min-h-10 tw:max-w-[180px] tw:rounded-md tw:px-[7px] tw:font-mono tw:text-xs tw:font-normal tw:text-[var(--color-text-subtle)] tw:[@media(pointer:coarse)]:min-h-11" onClick={() => void openDirectory(crumb.path)}>{crumb.name}</Button>
                {index < breadcrumbs.length - 1 && <ChevronRight />}
              </span>
            ))}
          </nav>
          <div className="picker-browser">
            {showLoading && (
              <div className="picker-loading">
                <span className="picker-spinner" />
                Loading folders…
              </div>
            )}
            {!loading && pickerError && (
              <div className="picker-message error" role="alert">
                <strong>{pickerError}</strong>
                <Button variant="outline" className="tw:h-10 tw:rounded-full tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" onClick={() => void openDirectory(listing?.path ?? initialPath)}>Try again</Button>
              </div>
            )}
            {!pickerError && listing?.directories.length === 0 && (
              <div className="picker-message">
                <FolderOpen />
                <strong>This folder has no subfolders</strong>
                <span>You can still select the current folder.</span>
              </div>
            )}
            {!pickerError &&
              listing?.directories.map((directory) => (
                <Button key={directory.path} variant="ghost" className="folder-row tw:h-auto tw:min-h-[58px] tw:w-full tw:justify-start tw:rounded-[11px] tw:px-3 tw:py-2 tw:font-normal tw:whitespace-normal tw:transition-[background,transform] tw:hover:bg-background! tw:[@media(pointer:coarse)]:min-h-16" onClick={() => void openDirectory(directory.path)}>
                  <span className="folder-icon">
                    <Folder />
                  </span>
                  <span>
                    <strong>{directory.name}</strong>
                    <small>{displayPath(directory.path, listing.home, listing.resolvedHome)}</small>
                  </span>
                  <ChevronRight />
                </Button>
              ))}
          </div>
          <footer className="picker-footer">
            <div className="picker-selection">
              <span>Selected folder</span>
              <strong>
                {listing ? displayPath(listing.path, listing.home, listing.resolvedHome) : "No folder selected"}
              </strong>
            </div>
            <DialogClose className="picker-cancel tw:h-10 tw:rounded-full tw:px-4 tw:text-xs tw:[@media(pointer:coarse)]:h-11" render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className="picker-confirm tw:h-10 tw:rounded-full tw:bg-primary tw:px-4 tw:text-xs tw:text-primary-foreground tw:shadow-[0_6px_16px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] tw:hover:bg-[var(--color-accent-hover)] tw:[@media(pointer:coarse)]:h-11"
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
