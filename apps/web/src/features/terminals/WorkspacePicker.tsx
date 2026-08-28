import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Folder, FolderOpen, HardDrive, Home, X } from "lucide-react";
import { listDirectories } from "../../api/terminals";
import type { DirectoryListing } from "../../types/terminals";
import { displayPath } from "../../shared/lib/utils";

export function WorkspacePicker({
  initialPath,
  purpose,
  onClose,
  onSelect,
}: {
  initialPath?: string;
  purpose: "add-launch-path" | "new-terminal-workspace" | "agent";
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
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
  const title = purpose === "new-terminal-workspace" ? "New Workspace" : purpose === "agent" ? "Add Agent Launch Path" : "Add Launch Path";
  const confirmLabel = purpose === "new-terminal-workspace" ? "Create Workspace" : "Add Launch Path";
  return (
    <div
      className="picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="folder-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        tabIndex={-1}
      >
        <header className="picker-header">
          <div className="picker-title-icon">
            <FolderOpen />
          </div>
          <div>
            <h2 id="folder-picker-title">{title}</h2>
            <p>{purpose === "new-terminal-workspace" ? "Choose a folder for the first terminal" : "Choose a folder on this machine"}</p>
          </div>
          <button className="picker-close" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="picker-toolbar">
          <button
            className="picker-location"
            disabled={!listing?.parent}
            onClick={() => void openDirectory(listing?.parent ?? undefined)}
          >
            <ArrowLeft />
            <span>Up</span>
          </button>
          <button className="picker-location" onClick={() => void openDirectory(listing?.home)}>
            <Home />
            <span>Home</span>
          </button>
          <button className="picker-location" onClick={() => void openDirectory("/")}>
            <HardDrive />
            <span>Root</span>
          </button>
        </div>
        <nav className="picker-breadcrumbs" aria-label="Current folder">
          {breadcrumbs.map((crumb, index) => (
            <span key={crumb.path}>
              <button onClick={() => void openDirectory(crumb.path)}>{crumb.name}</button>
              {index < breadcrumbs.length - 1 && <ChevronRight />}
            </span>
          ))}
        </nav>
        <div className="picker-browser">
          {loading && (
            <div className="picker-message">
              <span className="picker-spinner" />
              Loading folders…
            </div>
          )}
          {!loading && pickerError && (
            <div className="picker-message error">
              <strong>{pickerError}</strong>
              <button onClick={() => void openDirectory(listing?.path ?? initialPath)}>Try again</button>
            </div>
          )}
          {!loading && !pickerError && listing?.directories.length === 0 && (
            <div className="picker-message">
              <FolderOpen />
              <strong>This folder has no subfolders</strong>
              <span>You can still select the current folder.</span>
            </div>
          )}
          {!loading &&
            !pickerError &&
            listing?.directories.map((directory) => (
              <button key={directory.path} className="folder-row" onClick={() => void openDirectory(directory.path)}>
                <span className="folder-icon">
                  <Folder />
                </span>
                <span>
                  <strong>{directory.name}</strong>
                  <small>{displayPath(directory.path, listing.home, listing.resolvedHome)}</small>
                </span>
                <ChevronRight />
              </button>
            ))}
        </div>
        <footer className="picker-footer">
          <div className="picker-selection">
            <span>Selected folder</span>
            <strong>
              {listing ? displayPath(listing.path, listing.home, listing.resolvedHome) : "No folder selected"}
            </strong>
          </div>
          <button className="picker-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="picker-confirm"
            disabled={!listing || loading || !!pickerError}
            onClick={() => listing && onSelect(listing.path)}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
