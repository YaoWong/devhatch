import { ChevronLeft, ChevronRight, Folder, Pencil, Pin, Play, Plus, Trash2 } from "lucide-react";
import type { AgentLaunchPath } from "../../types/agents";
import type { LaunchPathDisplay } from "../../types/app";
import { displayPath, workspaceName } from "../../shared/lib/utils";
import { InlineRename } from "../../shared/ui/InlineRename";

type HomePaths = { home: string; resolvedHome: string } | null;

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
}: {
  paths: AgentLaunchPath[];
  selectedPathId: string | null;
  available: boolean;
  canAdd: boolean;
  launching: boolean;
  homePaths: HomePaths;
  pathDisplay: LaunchPathDisplay;
  page: number;
  renamingId: string | null;
  onPageChange: (page: number) => void;
  onChoose: () => void;
  onSelect: (path: AgentLaunchPath) => void;
  onLaunch: (path: AgentLaunchPath) => void;
  onPin: (path: AgentLaunchPath) => void;
  onRename: (path: AgentLaunchPath) => void;
  onRenameSubmit: (path: AgentLaunchPath, alias: string) => Promise<boolean>;
  onRenameCancel: () => void;
  onDelete: (path: AgentLaunchPath) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(paths.length / 10));
  const visiblePaths = paths.length > 24 ? paths.slice((page - 1) * 10, page * 10) : paths;
  return (
    <div className="menu-section paths-section">
      <div className="path-section-head">
        <p className="menu-label">Launch Paths</p>
        <button className="mini-action" disabled={!canAdd} onClick={onChoose}>
          <Plus />
          Add
        </button>
      </div>
      <div className="agent-path-list">
        {visiblePaths.length ? (
          visiblePaths.map((item) => (
            <div
              key={item.id}
              className={`agent-path-row ${selectedPathId === item.id ? "active" : ""}`}
            >
              <Folder />
              {renamingId === item.id ? (
                <div className="path-main">
                  <span>
                    <InlineRename initialValue={item.alias || workspaceName(item.path)} label="launch path alias" allowEmpty onSubmit={(alias) => onRenameSubmit(item, alias)} onCancel={onRenameCancel} />
                    {pathDisplay === "folder" && <small>{displayPath(item.path, homePaths?.home, homePaths?.resolvedHome)}</small>}
                  </span>
                </div>
              ) : <button
                type="button"
                className="path-main"
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
              </button>}
              <span className="path-actions">
                <button
                  className={item.pinned ? "pinned" : ""}
                  aria-label={item.pinned ? "Unpin path" : "Pin path"}
                  aria-pressed={item.pinned}
                  title={item.pinned ? "Pinned" : "Pin path"}
                  disabled={renamingId === item.id}
                  onClick={(event) => {
                    onPin(item);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                >
                  <Pin />
                </button>
                <button
                  aria-label="Launch path"
                  disabled={!available || launching || renamingId === item.id}
                  onClick={(event) => {
                    onLaunch(item);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                >
                  <Play />
                </button>
                <button
                  aria-label="Rename alias"
                  disabled={renamingId === item.id}
                  onClick={(event) => {
                    onRename(item);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                >
                  <Pencil />
                </button>
                <button
                  aria-label="Delete path"
                  disabled={renamingId === item.id}
                  onClick={(event) => {
                    onDelete(item);
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                >
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
