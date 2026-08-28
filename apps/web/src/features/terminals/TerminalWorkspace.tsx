import { Minus, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { ConnectionPhase, TerminalInfo, TerminalWorkspace as TerminalWorkspaceInfo } from "../../types/terminals";
import { Statusbar } from "../../shared/terminal/Statusbar";
import { TerminalSurface } from "../../shared/terminal/TerminalSurface";
import {
  minimizeTerminal,
  reconcileTerminalWorkspaceDock,
  stageTerminal,
  terminalViewTransitionName,
  type TerminalWorkspaceCapacity,
  type TerminalWorkspaceDockState,
} from "./terminalWorkspaceDock";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function TerminalWorkspace({
  visible, busy, launching, sessions, visibleSessions, workspace, phases, focusVersion, capacity, thumbnailsHidden, error,
  onActivate, onRename, onClose, onCreate, onPhaseChange, onError, onDismissError,
}: {
  visible: boolean;
  busy: boolean;
  launching: boolean;
  sessions: TerminalInfo[];
  visibleSessions: TerminalInfo[];
  workspace: TerminalWorkspaceInfo | null;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  capacity: TerminalWorkspaceCapacity;
  thumbnailsHidden: boolean;
  error: string | null;
  onActivate: (id: string) => void;
  onRename: (session: TerminalInfo) => void;
  onClose: (session: TerminalInfo) => void;
  onCreate: (cwd?: string) => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
}) {
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const thumbnailRefs = useRef(new Map<string, HTMLButtonElement>());
  const thumbnailCacheRef = useRef(new Map<string, Blob>());
  const thumbnailUrlRef = useRef(new Map<string, string>());
  const thumbnailImageRefs = useRef(new Map<string, HTMLImageElement>());
  const thumbnailImageRefCallbacks = useRef(new Map<string, (node: HTMLImageElement | null) => void>());
  const stageTransitionRef = useRef<{ transition: ViewTransition; generation: number; applyUpdate: () => void } | null>(null);
  const stageTransitionGenerationRef = useRef(0);
  const isMobile = useMediaQuery("(max-width: 640px)");
  const effectiveCapacity = isMobile ? 1 : capacity;
  const [workspaceStates, setWorkspaceStates] = useState<Map<string, TerminalWorkspaceDockState>>(() => new Map());
  const workspaceId = workspace?.id ?? null;
  const activeId = workspace?.activeTerminalId ?? null;
  const memberIds = useMemo(() => visibleSessions.map((session) => session.id), [visibleSessions]);
  const memberIdSet = useMemo(() => new Set(memberIds), [memberIds]);
  const thumbnailMemberIdsRef = useRef(memberIdSet);
  thumbnailMemberIdsRef.current = memberIdSet;
  const thumbnailWorkspaceIdRef = useRef(workspaceId);
  if (thumbnailWorkspaceIdRef.current !== workspaceId) {
    thumbnailWorkspaceIdRef.current = workspaceId;
    for (const url of thumbnailUrlRef.current.values()) URL.revokeObjectURL(url);
    thumbnailCacheRef.current.clear();
    thumbnailUrlRef.current.clear();
    thumbnailImageRefs.current.clear();
    thumbnailImageRefCallbacks.current.clear();
  }
  for (const id of thumbnailCacheRef.current.keys()) {
    if (!memberIdSet.has(id)) {
      thumbnailCacheRef.current.delete(id);
      thumbnailImageRefCallbacks.current.delete(id);
    }
  }
  for (const [id, url] of thumbnailUrlRef.current) {
    if (!memberIdSet.has(id)) {
      URL.revokeObjectURL(url);
      thumbnailUrlRef.current.delete(id);
    }
  }
  for (const id of thumbnailImageRefs.current.keys()) {
    if (!memberIdSet.has(id)) thumbnailImageRefs.current.delete(id);
  }
  const currentState = workspaceId
    ? reconcileTerminalWorkspaceDock(workspaceStates.get(workspaceId), memberIds, activeId, effectiveCapacity)
    : { stagedIds: [], minimizedIds: [] };
  const latestContextRef = useRef({ workspaceId, memberIds, activeId, effectiveCapacity, currentState });
  latestContextRef.current = { workspaceId, memberIds, activeId, effectiveCapacity, currentState };
  const staged = new Set(currentState.stagedIds);
  const activeSession = visibleSessions.find((session) => session.id === activeId) ?? null;
  const thumbnailSessions = visibleSessions.filter((session) => !staged.has(session.id));
  const thumbnailsVisible = !thumbnailsHidden && thumbnailSessions.length > 0;
  const thumbnailTabStopId = thumbnailSessions[0]?.id;
  const orderedSessions = [
    ...visibleSessions,
    ...sessions.filter((session) => !visibleSessions.some((visibleSession) => visibleSession.id === session.id)),
  ];

  useEffect(() => () => {
    for (const url of thumbnailUrlRef.current.values()) URL.revokeObjectURL(url);
    thumbnailCacheRef.current.clear();
    thumbnailUrlRef.current.clear();
    thumbnailImageRefs.current.clear();
    thumbnailImageRefCallbacks.current.clear();
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    setWorkspaceStates((current) => {
      const previous = current.get(workspaceId);
      const next = reconcileTerminalWorkspaceDock(previous, memberIds, activeId, effectiveCapacity);
      if (previous && previous.stagedIds.join() === next.stagedIds.join() && previous.minimizedIds.join() === next.minimizedIds.join()) return current;
      const updated = new Map(current);
      updated.set(workspaceId, next);
      return updated;
    });
  }, [activeId, effectiveCapacity, memberIds, workspaceId]);

  const updateCurrent = (update: (state: TerminalWorkspaceDockState) => TerminalWorkspaceDockState) => {
    const { workspaceId: latestWorkspaceId } = latestContextRef.current;
    if (!latestWorkspaceId) return;
    setWorkspaceStates((current) => {
      const { workspaceId, memberIds, activeId, effectiveCapacity } = latestContextRef.current;
      if (!workspaceId) return current;
      const updated = new Map(current);
      updated.set(workspaceId, update(reconcileTerminalWorkspaceDock(current.get(workspaceId), memberIds, activeId, effectiveCapacity)));
      return updated;
    });
  };
  const runStageTransition = (update: () => void) => {
    const activeTransition = stageTransitionRef.current;
    if (activeTransition) {
      activeTransition.applyUpdate();
      stageTransitionRef.current = null;
      stageTransitionGenerationRef.current += 1;
      try {
        activeTransition.transition.skipTransition();
      } catch {
        void activeTransition.transition.finished.catch(() => undefined);
      }
      document.documentElement.classList.remove("terminal-stage-transition");
      flushSync(update);
      return;
    }
    const startViewTransition = document.startViewTransition?.bind(document);
    if (!startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    const generation = ++stageTransitionGenerationRef.current;
    let updated = false;
    const applyUpdate = () => {
      if (updated) return;
      updated = true;
      flushSync(update);
    };
    document.documentElement.classList.add("terminal-stage-transition");
    try {
      const transition = startViewTransition(applyUpdate);
      stageTransitionRef.current = { transition, generation, applyUpdate };
      void transition.ready.catch(() => undefined);
      void transition.updateCallbackDone.catch(() => undefined);
      void transition.finished.catch(() => undefined).finally(() => {
        if (stageTransitionRef.current?.generation !== generation) return;
        stageTransitionRef.current = null;
        document.documentElement.classList.remove("terminal-stage-transition");
      });
    } catch {
      if (stageTransitionGenerationRef.current === generation) {
        stageTransitionRef.current = null;
        document.documentElement.classList.remove("terminal-stage-transition");
      }
      applyUpdate();
    }
  };
  const activateAndStage = (id: string) => {
    if (latestContextRef.current.currentState.stagedIds.includes(id)) {
      onActivate(id);
      return;
    }
    runStageTransition(() => {
      updateCurrent((state) => {
        const { activeId, effectiveCapacity } = latestContextRef.current;
        return stageTerminal(state, id, activeId, effectiveCapacity);
      });
      onActivate(id);
    });
  };
  const minimize = (id: string) => {
    runStageTransition(() => {
      const { activeId, currentState } = latestContextRef.current;
      const remaining = currentState.stagedIds.filter((item) => item !== id);
      updateCurrent((state) => minimizeTerminal(state, id));
      if (id === activeId && remaining.length) onActivate(remaining.at(-1)!);
    });
  };
  const updateThumbnail = useCallback((id: string, blob: Blob) => {
    if (!thumbnailMemberIdsRef.current.has(id)) return;
    thumbnailCacheRef.current.set(id, blob);
    const image = thumbnailImageRefs.current.get(id);
    if (!image) return;
    const previous = thumbnailUrlRef.current.get(id);
    const url = URL.createObjectURL(blob);
    thumbnailUrlRef.current.set(id, url);
    image.src = url;
    if (previous) URL.revokeObjectURL(previous);
  }, []);
  const thumbnailImageRef = (id: string) => {
    const existing = thumbnailImageRefCallbacks.current.get(id);
    if (existing) return existing;
    const callback = (node: HTMLImageElement | null) => {
      if (node) {
        thumbnailImageRefs.current.set(id, node);
        const blob = thumbnailCacheRef.current.get(id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          thumbnailUrlRef.current.set(id, url);
          node.src = url;
        }
        return;
      }
      thumbnailImageRefs.current.delete(id);
      const url = thumbnailUrlRef.current.get(id);
      if (url) {
        URL.revokeObjectURL(url);
        thumbnailUrlRef.current.delete(id);
      }
    };
    thumbnailImageRefCallbacks.current.set(id, callback);
    return callback;
  };
  const activateThumbnailByKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = Math.min(index + 1, thumbnailSessions.length - 1);
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = thumbnailSessions.length - 1;
    else return;
    event.preventDefault();
    const session = thumbnailSessions[next];
    if (!session) return;
    activateAndStage(session.id);
    requestAnimationFrame(() => thumbnailRefs.current.get(session.id)?.focus());
  };
  const activateCardByKey = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.target !== event.currentTarget) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = Math.max(0, index - 1);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = Math.min(currentState.stagedIds.length - 1, index + 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = currentState.stagedIds.length - 1;
    const id = currentState.stagedIds[next];
    if (!id) return;
    activateAndStage(id);
    requestAnimationFrame(() => cardRefs.current.get(id)?.focus());
  };

  return (
    <div className={`terminal-workspace ${visible ? "" : "workspace-hidden"}`}>
      <div className="stage terminal-stage">
        {thumbnailsVisible && <div className="terminal-thumbnail-stack" role="listbox" aria-label="Terminals">
          {thumbnailSessions.map((session, index) => <button
            key={session.id}
            ref={(node) => { if (node) thumbnailRefs.current.set(session.id, node); else thumbnailRefs.current.delete(session.id); }}
            type="button"
            role="option"
            aria-selected="false"
            tabIndex={session.id === thumbnailTabStopId ? 0 : -1}
            aria-label={session.name}
            className="terminal-thumbnail"
            style={{ viewTransitionName: terminalViewTransitionName(session.id) }}
            onClick={() => activateAndStage(session.id)}
            onKeyDown={(event) => activateThumbnailByKey(event, index)}
          >
            <img
              ref={thumbnailImageRef(session.id)}
              alt=""
              aria-hidden="true"
            />
            <span className="terminal-thumbnail-caption"><span className={`tab-dot ${phases[session.id] ?? "connecting"}`} />{session.name}</span>
          </button>)}
        </div>}
        {busy && <div className="empty-state">Starting DevHatch…</div>}
        {!busy && !visibleSessions.length && <div className="empty-state"><strong>No terminal workspace selected</strong><button disabled={launching} onClick={() => onCreate()}>Create terminal</button></div>}
        {!busy && !!visibleSessions.length && !currentState.stagedIds.length && <div className="empty-state terminal-stage-empty">Select a terminal thumbnail</div>}
        <div className={`terminal-card-grid count-${currentState.stagedIds.length} ${thumbnailsVisible ? "with-thumbnails" : ""}`} role="list" aria-label="Staged terminals">
          {orderedSessions.map((session) => {
            const shown = visible && workspaceId !== null && staged.has(session.id) && memberIds.includes(session.id);
            const thumbnailSource = visible && workspaceId !== null && !staged.has(session.id) && memberIds.includes(session.id);
            const focused = shown && session.id === activeId;
            const index = currentState.stagedIds.indexOf(session.id);
            return <section
              key={session.id}
              ref={(node) => { if (node) cardRefs.current.set(session.id, node); else cardRefs.current.delete(session.id); }}
               className={`terminal-window terminal-card ${shown ? "shown" : ""} ${thumbnailSource ? "thumbnail-source" : ""} ${focused ? "focused" : ""}`}
               data-slot={shown ? index : undefined}
               style={shown ? { order: index, viewTransitionName: terminalViewTransitionName(session.id) } : { viewTransitionName: "none" }}
               role={shown ? "listitem" : undefined}
               inert={thumbnailSource ? true : undefined}
               aria-hidden={!shown}
               tabIndex={shown ? 0 : -1}
              aria-label={`${session.name} terminal`}
              aria-current={focused ? "true" : undefined}
              onClick={() => activateAndStage(session.id)}
              onKeyDown={(event) => activateCardByKey(event, index)}
            >
              <header className="terminal-window-titlebar">
                <span className={`tab-dot ${phases[session.id] ?? "connecting"}`} /><strong>{session.name}</strong><small>{session.cwd}</small>
                <button aria-label={`Rename ${session.name}`} onClick={(event) => { event.stopPropagation(); onRename(session); }}><Pencil /></button>
                <button aria-label={`Minimize ${session.name}`} onClick={(event) => { event.stopPropagation(); minimize(session.id); }}><Minus /></button>
                <button aria-label={`Close ${session.name}`} onClick={(event) => { event.stopPropagation(); onClose(session); }}><X /></button>
              </header>
               <TerminalSurface session={session} socketBase="/api/terminals" visible={shown} rendered={shown || thumbnailSource} focused={focused} focusVersion={focusVersion} thumbnailEnabled={visible && workspaceId !== null && memberIds.includes(session.id)} thumbnailIntervalMs={shown ? 2000 : 500} onFocus={() => activateAndStage(session.id)} onPhaseChange={onPhaseChange} onThumbnail={updateThumbnail} onError={onError} />
            </section>;
          })}
        </div>
        {error && visible && <div className="error-banner">{error}<button aria-label="Dismiss" onClick={onDismissError}><X /></button></div>}
      </div>
      <Statusbar session={activeSession} phase={activeId ? phases[activeId] : undefined} />
    </div>
  );
}
