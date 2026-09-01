import { ChevronRight, Minus, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import type { ConnectionPhase, TerminalInfo, TerminalWorkspace as TerminalWorkspaceInfo } from "../../types/terminals";
import { TerminalSurface } from "../../shared/terminal/TerminalSurface";
import { TextInputDialog } from "../../shared/ui/TextInputDialog";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import {
  minimizeTerminal,
  reconcileTerminalWorkspaceDock,
  stageTerminal,
  terminalViewTransitionName,
  type TerminalWorkspaceCapacity,
  type TerminalWorkspaceDockState,
} from "./terminalWorkspaceDock";
import {
  clampTerminalLayoutCut,
  defaultTerminalLayoutPreset,
  defaultTerminalLayoutRatios,
  terminalLayoutKey,
  terminalLayoutWeights,
  type TerminalLayoutCount,
  type TerminalLayoutPreset,
  type TerminalWorkspaceLayoutPreferences,
} from "./terminalWorkspaceLayout";

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

type TerminalGridStyle = CSSProperties & Record<`--${string}`, string>;
type SplitDescriptor = {
  axis: "x" | "y";
  ratioIndex: number;
  cutIndex: number;
  ratioIndices: number[];
  paneCount: number;
  className: string;
};

function terminalLayoutDescriptors(count: TerminalLayoutCount, preset: TerminalLayoutPreset): SplitDescriptor[] {
  if (count === 2) return [{ axis: preset === "rows" ? "y" : "x", ratioIndex: 0, cutIndex: 0, ratioIndices: [0], paneCount: 2, className: `split-${preset === "rows" ? "y" : "x"}-0` }];
  if (count === 3 && (preset === "columns" || preset === "rows")) return [0, 1].map((index) => ({ axis: preset === "columns" ? "x" : "y", ratioIndex: index, cutIndex: index, ratioIndices: [0, 1], paneCount: 3, className: `split-${preset === "columns" ? "x" : "y"}-${index}` }));
  if (count === 3) return [
    { axis: "x", ratioIndex: 0, cutIndex: 0, ratioIndices: [0], paneCount: 2, className: "split-x-0" },
    { axis: "y", ratioIndex: 1, cutIndex: 0, ratioIndices: [1], paneCount: 2, className: "split-y-0" },
  ];
  if (preset === "columns" || preset === "rows") return [0, 1, 2].map((index) => ({ axis: preset === "columns" ? "x" : "y", ratioIndex: index, cutIndex: index, ratioIndices: [0, 1, 2], paneCount: 4, className: `split-${preset === "columns" ? "x" : "y"}-${index}` }));
  return [
    { axis: "x", ratioIndex: 0, cutIndex: 0, ratioIndices: [0], paneCount: 2, className: "split-x-0" },
    { axis: "y", ratioIndex: 1, cutIndex: 0, ratioIndices: [1], paneCount: 2, className: "split-y-0" },
  ];
}

function terminalGridStyle(count: TerminalLayoutCount | null, preset: TerminalLayoutPreset | null, ratios: number[]): TerminalGridStyle | undefined {
  if (!count || !preset) return undefined;
  const style: TerminalGridStyle = {};
  if (count === 2) {
    const weights = terminalLayoutWeights([ratios[0] ?? 0.5]);
    const prefix = preset === "rows" ? "r" : "p";
    weights.forEach((weight, index) => { style[`--${prefix}${index}`] = `${weight}fr`; });
    return style;
  }
  if (count === 3 && preset !== "columns" && preset !== "rows" || count === 4 && preset === "grid") {
    terminalLayoutWeights([ratios[0] ?? 0.5]).forEach((weight, index) => { style[`--p${index}`] = `${weight}fr`; });
    terminalLayoutWeights([ratios[1] ?? 0.5]).forEach((weight, index) => { style[`--r${index}`] = `${weight}fr`; });
    return style;
  }
  const prefix = preset === "rows" ? "r" : "p";
  terminalLayoutWeights(ratios).forEach((weight, index) => { style[`--${prefix}${index}`] = `${weight}fr`; });
  return style;
}

export function TerminalWorkspace({
  visible, busy, launching, sessions, visibleSessions, workspace, workspaceKey, activeSessionId, workspaceLabel = "terminal workspace", sessionLabel = "terminal", sessionIdentity, stageId = "terminal", socketBase = "/api/terminals", emptyIcon, phases, focusVersion, capacity, thumbnailsAutoHide, thumbnailSide, workspaceLayouts, error,
  onActivate, onRename, onClose, onCreate, onChoosePath, onPhaseChange, onLayoutCountChange, onWorkspaceLayoutChange, onRemoved, onUpstreamSessionChange, onOpenLink, onError, onDismissError,
}: {
  visible: boolean;
  busy: boolean;
  launching: boolean;
  sessions: TerminalInfo[];
  visibleSessions: TerminalInfo[];
  workspace?: TerminalWorkspaceInfo | null;
  workspaceKey?: string | null;
  activeSessionId?: string | null;
  workspaceLabel?: string;
  sessionLabel?: string;
  sessionIdentity?: (session: TerminalInfo) => string;
  stageId?: string;
  socketBase?: string;
  emptyIcon?: React.ReactNode;
  phases: Record<string, ConnectionPhase>;
  focusVersion: number;
  capacity: TerminalWorkspaceCapacity;
  thumbnailsAutoHide: boolean;
  thumbnailSide: "left" | "right";
  workspaceLayouts: Record<string, TerminalWorkspaceLayoutPreferences>;
  error: string | null;
  onActivate: (id: string) => void;
  onRename: (session: TerminalInfo, name: string) => Promise<boolean>;
  onClose: (session: TerminalInfo) => void;
  onCreate?: (cwd?: string) => void;
  onChoosePath?: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onLayoutCountChange: (count: TerminalLayoutCount | null) => void;
  onWorkspaceLayoutChange: (workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => void;
  onRemoved?: (id: string) => void;
  onUpstreamSessionChange?: (id: string, upstreamSessionId: string, cwd?: string) => void;
  onOpenLink: (url: string) => void;
  onError: (message: string) => void;
  onDismissError: () => void;
}) {
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const gridRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRefs = useRef(new Map<string, HTMLButtonElement>());
  const thumbnailCacheRef = useRef(new Map<string, Blob>());
  const thumbnailUrlRef = useRef(new Map<string, string>());
  const thumbnailImageRefs = useRef(new Map<string, HTMLImageElement>());
  const thumbnailImageRefCallbacks = useRef(new Map<string, (node: HTMLImageElement | null) => void>());
  const transitionPrepareRefs = useRef(new Map<string, () => Promise<Blob | null>>());
  const thumbnailDockRef = useRef<HTMLDivElement | null>(null);
  const thumbnailCollapseTimerRef = useRef<number | null>(null);
  const [thumbnailDockExpanded, setThumbnailDockExpanded] = useState(!thumbnailsAutoHide);
  const [renamingSession, setRenamingSession] = useState<TerminalInfo | null>(null);
  const showInitialLoading = useDelayedLoading(busy);
  const stageTransitionRef = useRef<{ transition: ViewTransition; generation: number; applyUpdate: () => void; clearCaption: () => void } | null>(null);
  const stageTransitionGenerationRef = useRef(0);
  const stageTransitionRequestRef = useRef(0);
  const isMobile = useMediaQuery("(max-width: 640px)");
  const effectiveCapacity = isMobile ? 1 : capacity;
  const [workspaceStates, setWorkspaceStates] = useState<Map<string, TerminalWorkspaceDockState>>(() => new Map());
  const workspaceId = workspaceKey === undefined ? workspace?.id ?? null : workspaceKey;
  const activeId = activeSessionId === undefined ? workspace?.activeTerminalId ?? null : activeSessionId;
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
  const layoutCount = currentState.stagedIds.length >= 2 && currentState.stagedIds.length <= 4 ? currentState.stagedIds.length as TerminalLayoutCount : null;
  const workspaceLayout = workspaceId ? workspaceLayouts[workspaceId] : undefined;
  const layoutPreset = layoutCount ? workspaceLayout?.presets[layoutCount] ?? defaultTerminalLayoutPreset(layoutCount) : null;
  const layoutRatios = layoutCount && layoutPreset ? workspaceLayout?.ratios[terminalLayoutKey(layoutCount, layoutPreset)] ?? defaultTerminalLayoutRatios(layoutCount, layoutPreset) : [];
  const layoutClassName = layoutCount && layoutPreset ? `layout-${layoutCount}-${layoutPreset}` : "";
  const layoutStyle = terminalGridStyle(layoutCount, layoutPreset, layoutRatios);
  const thumbnailSessions = visibleSessions.filter((session) => !staged.has(session.id));
  const hasThumbnailDock = thumbnailSessions.length > 0;
  const thumbnailDockOpen = hasThumbnailDock && (!thumbnailsAutoHide || thumbnailDockExpanded);
  const thumbnailsReserveSpace = hasThumbnailDock && !thumbnailsAutoHide;
  const thumbnailTabStopId = thumbnailSessions[0]?.id;
  const orderedSessions = [
    ...visibleSessions,
    ...sessions.filter((session) => !visibleSessions.some((visibleSession) => visibleSession.id === session.id)),
  ];

  useEffect(() => () => {
    if (thumbnailCollapseTimerRef.current !== null) window.clearTimeout(thumbnailCollapseTimerRef.current);
    for (const url of thumbnailUrlRef.current.values()) URL.revokeObjectURL(url);
    thumbnailCacheRef.current.clear();
    thumbnailUrlRef.current.clear();
    thumbnailImageRefs.current.clear();
    thumbnailImageRefCallbacks.current.clear();
  }, []);

  useEffect(() => onLayoutCountChange(layoutCount), [layoutCount, onLayoutCountChange]);

  const updateWorkspaceLayout = useCallback((workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => {
    onWorkspaceLayoutChange(workspaceId, update);
  }, [onWorkspaceLayoutChange]);
  const updateLayoutRatio = (descriptor: SplitDescriptor, value: number) => {
    if (!workspaceId || !layoutCount || !layoutPreset) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    const size = descriptor.axis === "x" ? rect.width : rect.height;
    const minimumPixels = descriptor.axis === "x" ? 180 : 110;
    const minimum = Math.min(minimumPixels / Math.max(1, size - (descriptor.paneCount - 1) * 12), 1 / descriptor.paneCount);
    const axisCuts = descriptor.ratioIndices.map((index) => layoutRatios[index]);
    const next = [...layoutRatios];
    next[descriptor.ratioIndex] = clampTerminalLayoutCut(axisCuts, descriptor.cutIndex, value, minimum);
    const key = terminalLayoutKey(layoutCount, layoutPreset);
    updateWorkspaceLayout(workspaceId, (current) => ({ ...current, ratios: { ...current.ratios, [key]: next } }));
  };
  const resizeLayoutByPointer = (event: ReactPointerEvent<HTMLDivElement>, descriptor: SplitDescriptor) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    const move = (pointerEvent: PointerEvent) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const size = descriptor.axis === "x" ? rect.width : rect.height;
      const point = descriptor.axis === "x" ? pointerEvent.clientX - rect.left : pointerEvent.clientY - rect.top;
      const usable = Math.max(1, size - (descriptor.paneCount - 1) * 12);
      updateLayoutRatio(descriptor, (point - (descriptor.cutIndex + 0.5) * 12) / usable);
    };
    const finish = (pointerEvent: PointerEvent) => {
      move(pointerEvent);
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", cancel);
      if (handle.hasPointerCapture(pointerEvent.pointerId)) handle.releasePointerCapture(pointerEvent.pointerId);
    };
    const cancel = (pointerEvent: PointerEvent) => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", cancel);
      if (handle.hasPointerCapture(pointerEvent.pointerId)) handle.releasePointerCapture(pointerEvent.pointerId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", cancel);
    event.preventDefault();
    event.stopPropagation();
  };
  const resizeLayoutByKey = (event: KeyboardEvent<HTMLDivElement>, descriptor: SplitDescriptor) => {
    const decrement = descriptor.axis === "x" ? "ArrowLeft" : "ArrowUp";
    const increment = descriptor.axis === "x" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrement && event.key !== increment && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === decrement || event.key === "Home" ? -1 : 1;
    updateLayoutRatio(descriptor, event.key === "Home" ? 0 : event.key === "End" ? 1 : layoutRatios[descriptor.ratioIndex] + direction * (event.shiftKey ? 0.1 : 0.02));
  };

  const cancelThumbnailCollapse = useCallback(() => {
    if (thumbnailCollapseTimerRef.current !== null) window.clearTimeout(thumbnailCollapseTimerRef.current);
    thumbnailCollapseTimerRef.current = null;
  }, []);
  const cacheThumbnail = useCallback((id: string, blob: Blob) => {
    thumbnailCacheRef.current.set(id, blob);
    const image = thumbnailImageRefs.current.get(id);
    if (!image) return;
    const previous = thumbnailUrlRef.current.get(id);
    const url = URL.createObjectURL(blob);
    thumbnailUrlRef.current.set(id, url);
    image.src = url;
    if (previous) URL.revokeObjectURL(previous);
  }, []);
  const registerTransitionPrepare = useCallback((id: string, prepare: () => Promise<Blob | null>) => {
    transitionPrepareRefs.current.set(id, prepare);
  }, []);
  const expandThumbnailDock = useCallback(() => {
    cancelThumbnailCollapse();
    setThumbnailDockExpanded(true);
  }, [cancelThumbnailCollapse]);
  const scheduleThumbnailCollapse = useCallback(() => {
    if (!thumbnailsAutoHide) return;
    cancelThumbnailCollapse();
    thumbnailCollapseTimerRef.current = window.setTimeout(() => {
      thumbnailCollapseTimerRef.current = null;
      if (!thumbnailDockRef.current?.contains(document.activeElement)) setThumbnailDockExpanded(false);
    }, 600);
  }, [cancelThumbnailCollapse, thumbnailsAutoHide]);
  useEffect(() => {
    cancelThumbnailCollapse();
    setThumbnailDockExpanded(!thumbnailsAutoHide);
  }, [cancelThumbnailCollapse, thumbnailsAutoHide]);

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
  const runStageTransition = async (id: string, update: () => void, revealDock = false) => {
    const request = ++stageTransitionRequestRef.current;
    const activeTransition = stageTransitionRef.current;
    if (activeTransition) {
      activeTransition.applyUpdate();
      activeTransition.clearCaption();
      stageTransitionRef.current = null;
      stageTransitionGenerationRef.current += 1;
      try {
        activeTransition.transition.skipTransition();
      } catch {
        void activeTransition.transition.finished.catch(() => undefined);
      }
      document.documentElement.classList.remove("terminal-stage-transition", "agent-stage-transition");
      flushSync(update);
      return;
    }
    const startViewTransition = document.startViewTransition?.bind(document);
    if (!startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    if (revealDock && thumbnailsAutoHide && !thumbnailDockExpanded) flushSync(() => setThumbnailDockExpanded(true));
    const blob = await transitionPrepareRefs.current.get(id)?.();
    if (request !== stageTransitionRequestRef.current) return;
    if (blob) cacheThumbnail(id, blob);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (request !== stageTransitionRequestRef.current) return;
    const generation = ++stageTransitionGenerationRef.current;
    let caption: HTMLElement | null = null;
    const markCaption = () => {
      caption = thumbnailRefs.current.get(id)?.querySelector<HTMLElement>(".terminal-thumbnail-caption") ?? null;
      if (caption) caption.style.viewTransitionName = `${stageId}-thumbnail-caption-flight`;
    };
    const clearCaption = () => {
      if (caption) caption.style.viewTransitionName = "";
      caption = null;
    };
    markCaption();
    let updated = false;
    const applyUpdate = () => {
      if (updated) return;
      updated = true;
      flushSync(update);
      markCaption();
    };
    document.documentElement.classList.add(`${stageId}-stage-transition`);
    try {
      const transition = startViewTransition(applyUpdate);
      stageTransitionRef.current = { transition, generation, applyUpdate, clearCaption };
      void transition.ready.then(clearCaption, clearCaption);
      void transition.updateCallbackDone.catch(() => undefined);
      void transition.finished.catch(() => undefined).finally(() => {
        if (stageTransitionRef.current?.generation !== generation) return;
        stageTransitionRef.current = null;
        document.documentElement.classList.remove("terminal-stage-transition", "agent-stage-transition");
      });
    } catch {
      clearCaption();
      if (stageTransitionGenerationRef.current === generation) {
        stageTransitionRef.current = null;
        document.documentElement.classList.remove("terminal-stage-transition", "agent-stage-transition");
      }
      applyUpdate();
    }
  };
  const activateAndStage = (id: string) => {
    if (latestContextRef.current.currentState.stagedIds.includes(id)) {
      onActivate(id);
      return;
    }
    void runStageTransition(id, () => {
      updateCurrent((state) => {
        const { activeId, effectiveCapacity } = latestContextRef.current;
        return stageTerminal(state, id, activeId, effectiveCapacity);
      });
      onActivate(id);
    });
  };
  const minimize = (id: string) => {
    if (renamingSession?.id === id) setRenamingSession(null);
    void runStageTransition(id, () => {
      const { activeId, currentState } = latestContextRef.current;
      const remaining = currentState.stagedIds.filter((item) => item !== id);
      updateCurrent((state) => minimizeTerminal(state, id));
      if (id === activeId && remaining.length) onActivate(remaining.at(-1)!);
    }, true);
  };
  const updateThumbnail = useCallback((id: string, blob: Blob) => {
    if (!thumbnailMemberIdsRef.current.has(id)) return;
    cacheThumbnail(id, blob);
  }, [cacheThumbnail]);
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

  const sessionDisplayName = (session: TerminalInfo) => sessionIdentity ? `${sessionIdentity(session)} · ${session.name}` : session.name;

  return (
    <div className={`terminal-workspace ${visible ? "" : "workspace-hidden"}`}>
      {renamingSession && <TextInputDialog title={`Rename ${sessionLabel}`} label="Name" initialValue={renamingSession.name} onSubmit={(name) => onRename(renamingSession, name)} onClose={() => setRenamingSession(null)} />}
      <div className="stage terminal-stage">
        {hasThumbnailDock && <div
          ref={thumbnailDockRef}
          className={`terminal-thumbnail-dock side-${thumbnailSide} ${thumbnailsAutoHide ? "auto-hide" : ""} ${thumbnailDockOpen ? "expanded" : "collapsed"}`}
          onPointerEnter={expandThumbnailDock}
          onPointerLeave={scheduleThumbnailCollapse}
          onFocus={expandThumbnailDock}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleThumbnailCollapse(); }}
        >
          {thumbnailsAutoHide && <button className="terminal-thumbnail-edge-trigger" type="button" aria-label={`Show ${sessionLabel} thumbnails`} aria-expanded={thumbnailDockOpen} aria-controls={`${stageId}-thumbnail-list`} onClick={expandThumbnailDock}><ChevronRight className={thumbnailSide === "right" ? "point-left" : ""} /></button>}
          <nav id={`${stageId}-thumbnail-list`} className="terminal-thumbnail-stack" aria-label={`${sessionLabel} thumbnails`} aria-hidden={!thumbnailDockOpen} inert={!thumbnailDockOpen ? true : undefined}>
            {thumbnailSessions.map((session, index) => <button
              key={session.id}
              ref={(node) => { if (node) thumbnailRefs.current.set(session.id, node); else thumbnailRefs.current.delete(session.id); }}
              type="button"
              tabIndex={session.id === thumbnailTabStopId ? 0 : -1}
              aria-label={`${sessionDisplayName(session)}, ${phases[session.id] ?? "connecting"}`}
              className="terminal-thumbnail"
              style={{ viewTransitionName: `${stageId}-${terminalViewTransitionName(session.id)}` }}
              onClick={() => activateAndStage(session.id)}
              onKeyDown={(event) => activateThumbnailByKey(event, index)}
            >
              <img
                ref={thumbnailImageRef(session.id)}
                alt=""
                aria-hidden="true"
              />
              <span className="terminal-thumbnail-caption"><span className={`tab-dot ${phases[session.id] ?? "connecting"}`} />{sessionDisplayName(session)}</span>
            </button>)}
          </nav>
        </div>}
        {showInitialLoading && <div className="empty-state" role="status">Starting DevHatch…</div>}
        {!busy && !workspaceId && <div className="empty-state">{emptyIcon}<strong>No {workspaceLabel} selected</strong>{onChoosePath && <button disabled={launching} onClick={onChoosePath}>Choose launch path</button>}{onCreate && <button disabled={launching} onClick={() => onCreate()}>Create {sessionLabel}</button>}</div>}
        {!busy && workspaceId && !visibleSessions.length && <div className="empty-state">{emptyIcon}<strong>No {sessionLabel}s in this {workspaceLabel}</strong>{onChoosePath && <button disabled={launching} onClick={onChoosePath}>Choose launch path</button>}{onCreate && <button disabled={launching} onClick={() => onCreate()}>Create {sessionLabel}</button>}</div>}
        {!busy && !!visibleSessions.length && !currentState.stagedIds.length && <div className="empty-state terminal-stage-empty">Select a {sessionLabel} thumbnail</div>}
        <div ref={gridRef} className={`terminal-card-grid count-${currentState.stagedIds.length} ${layoutClassName} ${thumbnailsReserveSpace ? `with-thumbnails thumbnails-${thumbnailSide}` : ""}`} style={layoutStyle} role="list" aria-label={`Staged ${sessionLabel}s`}>
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
               style={shown ? { order: index, viewTransitionName: `${stageId}-${terminalViewTransitionName(session.id)}` } : { viewTransitionName: "none" }}
               role={shown ? "listitem" : undefined}
               inert={thumbnailSource ? true : undefined}
               aria-hidden={!shown}
               tabIndex={shown ? 0 : -1}
              aria-label={`${sessionDisplayName(session)} terminal`}
              aria-current={focused ? "true" : undefined}
              onClick={() => activateAndStage(session.id)}
              onKeyDown={(event) => activateCardByKey(event, index)}
            >
               <header className="terminal-window-titlebar">
                 <span className={`tab-dot ${phases[session.id] ?? "connecting"}`} />
                  <strong>{sessionDisplayName(session)}</strong>
                  <small>{session.cwd}</small>
                  <button aria-label={`Rename ${session.name}`} onClick={(event) => { event.stopPropagation(); setRenamingSession(session); }}><Pencil /></button>
                <button aria-label={`Minimize ${session.name}`} onClick={(event) => { event.stopPropagation(); minimize(session.id); }}><Minus /></button>
                <button aria-label={`Close ${session.name}`} onClick={(event) => { event.stopPropagation(); onClose(session); }}><X /></button>
              </header>
               <TerminalSurface session={session} socketBase={socketBase} visible={shown} rendered={shown || thumbnailSource} focused={focused} focusVersion={focusVersion} thumbnailEnabled={thumbnailSource} thumbnailIntervalMs={500} onFocus={() => activateAndStage(session.id)} onPhaseChange={onPhaseChange} onRemoved={onRemoved} onUpstreamSessionChange={onUpstreamSessionChange} onThumbnail={updateThumbnail} onTransitionPrepareAvailable={registerTransitionPrepare} onOpenLink={onOpenLink} onError={onError} />
            </section>;
           })}
          {layoutCount && layoutPreset && !isMobile && terminalLayoutDescriptors(layoutCount, layoutPreset).map((descriptor) => {
            const value = layoutRatios[descriptor.ratioIndex] ?? 0.5;
            return <div
              key={`${descriptor.axis}-${descriptor.ratioIndex}`}
              className={`terminal-split-handle ${descriptor.className}`}
              role="separator"
              aria-label={`Resize ${sessionLabel} ${descriptor.axis === "x" ? "columns" : "rows"}`}
              aria-orientation={descriptor.axis === "x" ? "vertical" : "horizontal"}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(value * 100)}
              tabIndex={0}
              onPointerDown={(event) => resizeLayoutByPointer(event, descriptor)}
              onKeyDown={(event) => resizeLayoutByKey(event, descriptor)}
            />;
          })}
         </div>
        {error && visible && <div className="error-banner">{error}<button aria-label="Dismiss" onClick={onDismissError}><X /></button></div>}
      </div>
    </div>
  );
}
