import { ChevronLeft, ChevronRight, Folder, Pencil, Pin, Play, Plus, Trash2 } from "lucide-react";
import type { AgentLaunchPath } from "../types";
import { displayPath, logicalPath, workspaceName } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function LaunchPaths({
  paths,
  activeCwd,
  available,
  homePaths,
  pathDisplay,
  page,
  onDisplayChange,
  onPageChange,
  onChoose,
  onLaunch,
  onPin,
  onRename,
  onDelete,
}: {
  paths: AgentLaunchPath[];
  activeCwd?: string;
  available: boolean;
  homePaths: HomePaths;
  pathDisplay: "folder" | "full";
  page: number;
  onDisplayChange: (mode: "folder" | "full") => void;
  onPageChange: (page: number) => void;
  onChoose: () => void;
  onLaunch: (path: AgentLaunchPath) => void;
  onPin: (path: AgentLaunchPath) => void;
  onRename: (path: AgentLaunchPath) => void;
  onDelete: (path: AgentLaunchPath) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(paths.length / 10));
  const visiblePaths = paths.length > 24 ? paths.slice((page - 1) * 10, page * 10) : paths;
  return (
    <div className="menu-section">
      <div className="path-section-head">
        <p className="menu-label">Launch Path</p>
        <div className="path-head-actions">
          <button
            className={`path-mode-toggle ${pathDisplay}`}
            type="button"
            role="switch"
            aria-label={`Switch to ${pathDisplay === "folder" ? "full path" : "folder name"}`}
            aria-checked={pathDisplay === "full"}
            onClick={() => onDisplayChange(pathDisplay === "folder" ? "full" : "folder")}
          >
            <span className="path-mode-label">{pathDisplay === "folder" ? "Full path" : "Folder"}</span>
            <span className="path-mode-knob" />
          </button>
          <button className="mini-action" disabled={!available} onClick={onChoose}>
            <Plus />
            Launch
          </button>
        </div>
      </div>
      <div className={`agent-path-list ${paths.length > 8 && paths.length <= 24 ? "scrollable" : ""}`}>
        {visiblePaths.length ? (
          visiblePaths.map((item) => (
            <div
              key={item.id}
              className={`agent-path-row ${
                activeCwd === logicalPath(item.path, homePaths?.home, homePaths?.resolvedHome) ? "active" : ""
              }`}
            >
              <Folder />
              <button className="path-main" title={item.path} disabled={!available} onClick={() => onLaunch(item)}>
                <strong>{pathDisplay === "folder" ? item.alias || workspaceName(item.path) : item.path}</strong>
                {pathDisplay === "folder" && (
                  <small>{displayPath(item.path, homePaths?.home, homePaths?.resolvedHome)}</small>
                )}
              </button>
              <span className="path-actions">
                <button
                  className={item.pinned ? "pinned" : ""}
                  aria-label={item.pinned ? "Unpin path" : "Pin path"}
                  aria-pressed={item.pinned}
                  title={item.pinned ? "Pinned" : "Pin path"}
                  onClick={() => onPin(item)}
                >
                  <Pin />
                </button>
                <button aria-label="Launch path" onClick={() => onLaunch(item)}>
                  <Play />
                </button>
                <button aria-label="Rename alias" onClick={() => onRename(item)}>
                  <Pencil />
                </button>
                <button aria-label="Delete path" onClick={() => onDelete(item)}>
                  <Trash2 />
                </button>
              </span>
            </div>
          ))
        ) : (
          <div className="quiet-message">Choose a directory to launch your first session.</div>
        )}
      </div>
      {paths.length > 24 && (
        <div className="path-pagination">
          <button aria-label="Previous page" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft />
          </button>
          <span>
            {page} / {pageCount}
          </span>
          <button aria-label="Next page" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRight />
          </button>
        </div>
      )}
    </div>
  );
}
