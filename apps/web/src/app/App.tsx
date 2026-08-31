import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Menu } from "lucide-react";
import { flushSync } from "react-dom";
import "@xterm/xterm/css/xterm.css";
import { AppDialogs } from "./AppDialogs";
import { AppHeader } from "./AppHeader";
import { AppNavigationRail } from "./AppNavigationRail";
import { AppWorkspaceContent } from "./AppWorkspaceContent";
import { getModeSubtitle } from "./modeSubtitle";
import { useInitialWorkspaceData } from "./useInitialWorkspaceData";
import { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { useNavigation } from "../features/navigation/useNavigation";
import { readCanvasSidebarPinned, writeCanvasSidebarPinned } from "../features/navigation/canvasSidebarPreference";
import type { SettingsSection } from "../features/settings/SettingsView";
import { useTheme } from "../shared/theme/ThemeContext";
import type { SkillsSection } from "../features/skills/SkillsRailPage";
import { useSkillsWorkspace } from "../features/skills/useSkillsWorkspace";
import { useTerminalWorkspace } from "../features/terminals/useTerminalWorkspace";
import {
  defaultTerminalLayoutPreset,
  readTerminalWorkspaceLayouts,
  writeTerminalWorkspaceLayouts,
  type TerminalLayoutCount,
  type TerminalLayoutPreset,
  type TerminalWorkspaceLayoutPreferences,
} from "../features/terminals/terminalWorkspaceLayout";
import {
  clampTerminalWorkspaceCapacity,
  TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY,
  type TerminalWorkspaceCapacity,
} from "../features/terminals/terminalWorkspaceDock";
import { useWebApps } from "../features/web-apps/useWebApps";
import { RailResizeHandle } from "../shared/ui/RailResizeHandle";
import type { ConfirmAction, DeleteTarget } from "../types/app";
import type { ConnectionPhase, TerminalInfo } from "../types/terminals";
import "./styles/index.css";

const TERMINAL_ROWS_STORAGE_KEY = "devhatch-terminal-workspace-rows";
const CANVAS_RAIL_ID = "canvas-navigation-rail";
const CANVAS_RAIL_CLOSE_DELAY_MS = 120;
const TERMINAL_THUMBNAIL_SIDE_STORAGE_KEY = "devhatch-terminal-thumbnail-side";
const AGENT_WORKSPACE_CAPACITY_STORAGE_KEY = "devhatch-agent-workspace-capacity";
const AGENT_THUMBNAIL_SIDE_STORAGE_KEY = "devhatch-agent-thumbnail-side";
const AGENT_WORKSPACE_LAYOUT_STORAGE_KEY = "devhatch-agent-workspace-layouts-v1";
type TerminalThumbnailSide = "left" | "right";

function initialThumbnailSide(storageKey = TERMINAL_THUMBNAIL_SIDE_STORAGE_KEY): TerminalThumbnailSide {
  try {
    return localStorage.getItem(storageKey) === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

function getFocusableRailElements(rail: HTMLElement) {
  return Array.from(rail.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => {
    for (let current: HTMLElement | null = element; current && rail.contains(current); current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        style.display === "none" || style.visibility === "hidden" || current.inert ||
        current.getAttribute("aria-hidden") === "true" || current.matches(".rail-page:not(.active)")
      ) return false;
      if (current === rail) break;
    }
    return element.getClientRects().length > 0;
  });
}

function initialCapacity(storageKey = TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY): TerminalWorkspaceCapacity {
  try {
    const legacy = storageKey === TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY ? localStorage.getItem(TERMINAL_ROWS_STORAGE_KEY) : null;
    const stored = localStorage.getItem(storageKey) ?? legacy ?? "1";
    const capacity = clampTerminalWorkspaceCapacity(Number(stored));
    localStorage.setItem(storageKey, String(capacity));
    if (storageKey === TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY) localStorage.removeItem(TERMINAL_ROWS_STORAGE_KEY);
    return capacity;
  } catch {
    return 1;
  }
}

function App({ onLogout, logoutBusy, logoutError }: { onLogout: () => Promise<void>; logoutBusy: boolean; logoutError: string | null }) {
  const {
    agentLaunchPathsMaxHeightPx,
    navigationRailWidthPx,
    setAgentLaunchPathsMaxHeightPx,
    setNavigationRailWidthPx,
    layoutMode,
  } = useTheme();
  const [canvasPinned, setCanvasPinned] = useState(readCanvasSidebarPinned);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(() => window.matchMedia("(max-width: 920px)").matches);
  const previousMobileNavigationRef = useRef(mobileNavigation);
  const previousCanvasSidebarOpenRef = useRef(false);
  const canvasCloseTimerRef = useRef<number | null>(null);
  const canvasRailHoverRef = useRef(false);
  const canvasHandleHoverRef = useRef(false);
  const canvasEdgeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const suppressCanvasEdgeFocusRef = useRef(false);
  const canvasMobileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const canvasRailRef = useRef<HTMLElement | null>(null);
  const canvasHandleRef = useRef<HTMLDivElement | null>(null);
  const breakpointFocusTargetRef = useRef<"mobile" | "desktop" | null>(null);
  const [draftRailWidth, setDraftRailWidth] = useState(navigationRailWidthPx);
  const [railResizing, setRailResizing] = useState(false);
  const railResizingRef = useRef(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const [homePaths, setHomePaths] = useState<{ home: string; resolvedHome: string } | null>(null);
  const [phases, setPhases] = useState<Record<string, ConnectionPhase>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerPurpose, setPickerPurpose] = useState<"add-launch-path" | "agent" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(
    () => localStorage.getItem("devhatch-confirm-terminal-delete") === "1",
  );
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [skillsSection, setSkillsSection] = useState<SkillsSection>("repositories");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const [terminalCapacity, setTerminalCapacityState] = useState<TerminalWorkspaceCapacity>(initialCapacity);
  const [terminalThumbnailsHidden, setTerminalThumbnailsHidden] = useState(false);
  const [terminalThumbnailsAutoHide, setTerminalThumbnailsAutoHide] = useState(false);
  const [terminalThumbnailSide, setTerminalThumbnailSideState] = useState<TerminalThumbnailSide>(initialThumbnailSide);
  const [terminalLayoutCount, setTerminalLayoutCount] = useState<TerminalLayoutCount | null>(null);
  const [terminalWorkspaceLayouts, setTerminalWorkspaceLayouts] = useState<Record<string, TerminalWorkspaceLayoutPreferences>>(readTerminalWorkspaceLayouts);
  const [agentCapacity, setAgentCapacityState] = useState<TerminalWorkspaceCapacity>(() => initialCapacity(AGENT_WORKSPACE_CAPACITY_STORAGE_KEY));
  const [agentThumbnailsHidden, setAgentThumbnailsHidden] = useState(false);
  const [agentThumbnailsAutoHide, setAgentThumbnailsAutoHide] = useState(false);
  const [agentThumbnailSide, setAgentThumbnailSideState] = useState<TerminalThumbnailSide>(() => initialThumbnailSide(AGENT_THUMBNAIL_SIDE_STORAGE_KEY));
  const [agentLayoutCount, setAgentLayoutCount] = useState<TerminalLayoutCount | null>(null);
  const [agentWorkspaceLayouts, setAgentWorkspaceLayouts] = useState<Record<string, TerminalWorkspaceLayoutPreferences>>(() => readTerminalWorkspaceLayouts(AGENT_WORKSPACE_LAYOUT_STORAGE_KEY));
  const setTerminalThumbnailSide = useCallback((side: TerminalThumbnailSide) => {
    setTerminalThumbnailSideState(side);
    try { localStorage.setItem(TERMINAL_THUMBNAIL_SIDE_STORAGE_KEY, side); } catch { return; }
  }, []);
  const setAgentThumbnailSide = useCallback((side: TerminalThumbnailSide) => {
    setAgentThumbnailSideState(side);
    try { localStorage.setItem(AGENT_THUMBNAIL_SIDE_STORAGE_KEY, side); } catch { return; }
  }, []);
  const updateTerminalWorkspaceLayout = useCallback((workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => {
    setTerminalWorkspaceLayouts((current) => {
      const next = { ...current, [workspaceId]: update(current[workspaceId] ?? { presets: {}, ratios: {} }) };
      writeTerminalWorkspaceLayouts(next);
      return next;
    });
  }, []);
  const updateAgentWorkspaceLayout = useCallback((workspaceId: string, update: (current: TerminalWorkspaceLayoutPreferences) => TerminalWorkspaceLayoutPreferences) => {
    setAgentWorkspaceLayouts((current) => {
      const next = { ...current, [workspaceId]: update(current[workspaceId] ?? { presets: {}, ratios: {} }) };
      writeTerminalWorkspaceLayouts(next, AGENT_WORKSPACE_LAYOUT_STORAGE_KEY);
      return next;
    });
  }, []);
  const terminalCapacityTransitionRef = useRef<ViewTransition | null>(null);
  const agentCapacityTransitionRef = useRef<ViewTransition | null>(null);
  const setWorkspaceCapacity = useCallback((value: TerminalWorkspaceCapacity, setValue: (value: TerminalWorkspaceCapacity) => void, transitionRef: { current: ViewTransition | null }, storageKey: string, transitionClass: string) => {
    const update = () => setValue(value);
    const activeTransition = transitionRef.current;
    if (activeTransition) {
      try { activeTransition.skipTransition(); } catch { void activeTransition.finished.catch(() => undefined); }
      transitionRef.current = null;
      document.documentElement.classList.remove(transitionClass);
      flushSync(update);
    } else {
      const startViewTransition = document.startViewTransition?.bind(document);
      if (!startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) update();
      else {
        document.documentElement.classList.add(transitionClass);
        try {
          const transition = startViewTransition(() => flushSync(update));
          transitionRef.current = transition;
          void transition.finished.catch(() => undefined).finally(() => {
            if (transitionRef.current !== transition) return;
            transitionRef.current = null;
            document.documentElement.classList.remove(transitionClass);
          });
        } catch {
          document.documentElement.classList.remove(transitionClass);
          update();
        }
      }
    }
    try { localStorage.setItem(storageKey, String(value)); } catch { return; }
  }, []);
  const setTerminalCapacity = useCallback((value: TerminalWorkspaceCapacity) => {
    setWorkspaceCapacity(value, setTerminalCapacityState, terminalCapacityTransitionRef, TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY, "terminal-stage-transition");
  }, [setWorkspaceCapacity]);
  const setAgentCapacity = useCallback((value: TerminalWorkspaceCapacity) => {
    setWorkspaceCapacity(value, setAgentCapacityState, agentCapacityTransitionRef, AGENT_WORKSPACE_CAPACITY_STORAGE_KEY, "agent-stage-transition");
  }, [setWorkspaceCapacity]);
  useEffect(() => setDraftRailWidth(navigationRailWidthPx), [navigationRailWidthPx]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 920px)");
    const update = () => {
      const active = document.activeElement;
      const movingToMobile = query.matches;
      const focusWillBeLost = layoutMode === "canvas" && (movingToMobile
        ? canvasEdgeTriggerRef.current === active || canvasHandleRef.current?.contains(active) || canvasRailRef.current?.contains(active)
        : canvasMobileTriggerRef.current === active || (!canvasPinned && canvasRailRef.current?.contains(active)));
      breakpointFocusTargetRef.current = focusWillBeLost ? (movingToMobile ? "mobile" : "desktop") : null;
      setMobileNavigation(movingToMobile);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [canvasPinned, layoutMode]);
  const bumpFocus = useCallback(() => setFocusVersion((value) => value + 1), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const closePicker = useCallback(() => setPickerPurpose(null), []);
  const navigation = useNavigation(bumpFocus, layoutMode);
  const previousLayoutModeRef = useRef(layoutMode);
  const { selectMode, showGlobalSettings, normalizeSettingsRail, closeSidebar, sidebarOpen, workspaceMode } = navigation;
  useEffect(() => {
    const previousLayoutMode = previousLayoutModeRef.current;
    previousLayoutModeRef.current = layoutMode;
    if (previousLayoutMode !== layoutMode && workspaceMode === "settings") {
      normalizeSettingsRail(layoutMode);
    }
  }, [layoutMode, normalizeSettingsRail, workspaceMode]);
  const dialogOpen = pickerPurpose !== null || confirmAction !== null || deleteCandidate !== null;
  const cancelCanvasClose = useCallback(() => {
    if (canvasCloseTimerRef.current !== null) window.clearTimeout(canvasCloseTimerRef.current);
    canvasCloseTimerRef.current = null;
  }, []);
  const openCanvasRail = useCallback(() => {
    cancelCanvasClose();
    setCanvasOpen(true);
  }, [cancelCanvasClose]);
  const closeCanvasRail = useCallback((restoreFocus = false) => {
    cancelCanvasClose();
    if (restoreFocus && canvasRailRef.current?.contains(document.activeElement)) {
      if (!mobileNavigation) suppressCanvasEdgeFocusRef.current = true;
      (mobileNavigation ? canvasMobileTriggerRef : canvasEdgeTriggerRef).current?.focus();
    }
    setCanvasOpen(false);
  }, [cancelCanvasClose, mobileNavigation]);
  const scheduleCanvasClose = useCallback(() => {
    cancelCanvasClose();
    if (railResizingRef.current || navigation.railMotion !== null) return;
    canvasCloseTimerRef.current = window.setTimeout(() => {
      canvasCloseTimerRef.current = null;
      const active = document.activeElement;
      const railHasKeyboardFocus = active instanceof HTMLElement && active.matches(":focus-visible") && (
        canvasRailRef.current?.contains(active) || canvasHandleRef.current?.contains(active)
      );
      if (
        railResizingRef.current || navigation.railMotion !== null ||
        canvasRailHoverRef.current || canvasHandleHoverRef.current || railHasKeyboardFocus
      ) return;
      setCanvasOpen(false);
    }, CANVAS_RAIL_CLOSE_DELAY_MS);
  }, [cancelCanvasClose, navigation.railMotion]);
  const onSessionSelected = useCallback(() => {
    if (layoutMode !== "canvas" || mobileNavigation || canvasPinned) return;
    cancelCanvasClose();
    const active = document.activeElement;
    if (active instanceof HTMLElement && canvasRailRef.current?.contains(active)) active.blur();
    setCanvasOpen(false);
  }, [cancelCanvasClose, canvasPinned, layoutMode, mobileNavigation]);
  useEffect(() => {
    const wasMobile = previousMobileNavigationRef.current;
    previousMobileNavigationRef.current = mobileNavigation;
    if (wasMobile === mobileNavigation) return;
    closeSidebar();
    cancelCanvasClose();
    canvasRailHoverRef.current = false;
    canvasHandleHoverRef.current = false;
    setCanvasOpen(false);
    const focusTarget = breakpointFocusTargetRef.current;
    breakpointFocusTargetRef.current = null;
    if (!focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusTarget === "mobile") canvasMobileTriggerRef.current?.focus();
      else if (!canvasPinned) {
        suppressCanvasEdgeFocusRef.current = true;
        canvasEdgeTriggerRef.current?.focus();
      } else {
        if (canvasRailRef.current) getFocusableRailElements(canvasRailRef.current)[0]?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelCanvasClose, canvasPinned, closeSidebar, mobileNavigation]);
  useEffect(() => {
    if (dialogOpen && layoutMode === "canvas" && mobileNavigation && sidebarOpen) closeSidebar();
  }, [closeSidebar, dialogOpen, layoutMode, mobileNavigation, sidebarOpen]);
  useEffect(() => {
    if (layoutMode !== "canvas" || !mobileNavigation || !sidebarOpen || dialogOpen) return;
    const rail = canvasRailRef.current;
    const frame = window.requestAnimationFrame(() => {
      const focusable = rail ? getFocusableRailElements(rail) : [];
      focusable[0]?.focus();
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !rail) return;
      const focusable = getFocusableRailElements(rail);
      if (focusable.length === 0) {
        event.preventDefault();
        rail.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !rail.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !rail.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trapFocus);
    };
  }, [dialogOpen, layoutMode, mobileNavigation, sidebarOpen]);
  useEffect(() => {
    const wasOpen = previousCanvasSidebarOpenRef.current;
    const isOpen = layoutMode === "canvas" && mobileNavigation && sidebarOpen;
    previousCanvasSidebarOpenRef.current = isOpen;
    if (wasOpen && !isOpen && !dialogOpen) canvasMobileTriggerRef.current?.focus();
  }, [dialogOpen, layoutMode, mobileNavigation, sidebarOpen]);
  useEffect(() => {
    if (railResizing || navigation.railMotion !== null) cancelCanvasClose();
    else if (!canvasRailHoverRef.current && !canvasHandleHoverRef.current) scheduleCanvasClose();
  }, [cancelCanvasClose, navigation.railMotion, railResizing, scheduleCanvasClose]);
  useEffect(() => () => cancelCanvasClose(), [cancelCanvasClose]);
  useEffect(() => {
    const modes = ["terminal", "agent", "skills", "webapp", "settings"] as const;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape" && layoutMode === "canvas") {
        if (dialogOpen || document.querySelector('[aria-modal="true"]')) return;
        if (sidebarOpen) {
          event.preventDefault();
          closeSidebar();
          return;
        }
        if (!canvasPinned && canvasOpen) {
          event.preventDefault();
          closeCanvasRail(true);
          return;
        }
      }
      if (
        !(target instanceof HTMLElement) ||
        target.matches("input, textarea, select") || target.isContentEditable
      ) return;
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (layoutMode === "canvas" && event.key === ",") {
        event.preventDefault();
        showGlobalSettings();
        return;
      }
      const index = Number(event.key) - 1;
      const mode = modes[index];
      if (!mode || (layoutMode === "canvas" && mode === "settings")) return;
      event.preventDefault();
      selectMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasOpen, canvasPinned, closeCanvasRail, closeSidebar, dialogOpen, layoutMode, selectMode, showGlobalSettings, sidebarOpen]);
  const terminal = useTerminalWorkspace(homePaths, setHomePaths, reportError, navigation.closeSidebar, bumpFocus);
  const terminalLayoutPreset = terminal.selectedWorkspaceId && terminalLayoutCount
    ? terminalWorkspaceLayouts[terminal.selectedWorkspaceId]?.presets[terminalLayoutCount] ?? defaultTerminalLayoutPreset(terminalLayoutCount)
    : null;
  const setTerminalLayoutPreset = useCallback((preset: TerminalLayoutPreset) => {
    if (!terminal.selectedWorkspaceId || !terminalLayoutCount) return;
    const workspaceId = terminal.selectedWorkspaceId;
    const count = terminalLayoutCount;
    updateTerminalWorkspaceLayout(workspaceId, (current) => ({ ...current, presets: { ...current.presets, [count]: preset } }));
  }, [terminal.selectedWorkspaceId, terminalLayoutCount, updateTerminalWorkspaceLayout]);
  const agent = useAgentWorkspace({
    homePaths,
    active: navigation.workspaceMode === "agent",
    reportError,
    closeSidebar: navigation.closeSidebar,
    bumpFocus,
    onLaunched: closePicker,
  });
  const agentLayoutPreset = agent.selectedAgentId && agentLayoutCount
    ? agentWorkspaceLayouts[agent.selectedAgentId]?.presets[agentLayoutCount] ?? defaultTerminalLayoutPreset(agentLayoutCount)
    : null;
  const setAgentLayoutPreset = useCallback((preset: TerminalLayoutPreset) => {
    if (!agent.selectedAgentId || !agentLayoutCount) return;
    const workspaceId = agent.selectedAgentId;
    const count = agentLayoutCount;
    updateAgentWorkspaceLayout(workspaceId, (current) => ({ ...current, presets: { ...current.presets, [count]: preset } }));
  }, [agent.selectedAgentId, agentLayoutCount, updateAgentWorkspaceLayout]);
  const webApps = useWebApps(navigation.workspaceMode === "webapp", reportError);
  const skills = useSkillsWorkspace(
    navigation.workspaceMode === "skills" || navigation.workspaceMode === "agent",
    reportError,
  );

  const {
    initializeAgents,
    initializePaths,
    initializeSessions,
    deleteSession: deleteAgentSession,
  } = agent;
  const {
    initialize: initializeTerminals,
    initializeLaunchPaths: initializeTerminalLaunchPaths,
    initializeWorkspaces: initializeTerminalWorkspaces,
    deleteSession: deleteTerminalSession,
  } = terminal;

  const markReady = useCallback(() => setBusy(false), []);
  useInitialWorkspaceData({
    initializeTerminals,
    initializeTerminalLaunchPaths,
    initializeTerminalWorkspaces,
    initializeAgents,
    initializeSessions,
    initializePaths,
    onError: reportError,
    onReady: markReady,
  });

  const setPhase = useCallback((id: string, phase: ConnectionPhase) => {
    setPhases((current) => (current[id] === phase ? current : { ...current, [id]: phase }));
  }, []);

  const deleteSession = useCallback(
    async (target: DeleteTarget) => {
      setDeleting(true);
      try {
        if (target.kind === "agent session") await deleteAgentSession(target);
        else await deleteTerminalSession(target);
        setPhases((current) => {
          const next = { ...current };
          delete next[target.id];
          return next;
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setDeleting(false);
        setDeleteCandidate(null);
      }
    },
    [deleteAgentSession, deleteTerminalSession],
  );

  const requestClose = useCallback(
    (session: TerminalInfo, isAgent: boolean) => {
      const target: DeleteTarget = {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        kind: isAgent ? "agent session" : "terminal",
      };
      if (confirmDelete) setDeleteCandidate(target);
      else void deleteSession(target);
    },
    [confirmDelete, deleteSession],
  );

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    setActionBusy(true);
    try {
      const succeeded = await confirmAction.action();
      if (succeeded !== false) setConfirmAction(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionBusy(false);
    }
  };

  const modeSubtitle = getModeSubtitle({
    mode: navigation.workspaceMode,
    openDesign: webApps.openDesign,
    activeAgentSession: agent.activeSession,
    selectedAgent: agent.selectedAgent,
    selectedWorkspace: terminal.selectedWorkspace
      ? (terminal.selectedWorkspace.name || "Terminal Workspace")
      : null,
    homePaths,
  });

  return (
    <main
      style={
        {
          "--agent-launch-paths-max-height": `${agentLaunchPathsMaxHeightPx}px`,
          "--navigation-rail-width": `${draftRailWidth}px`,
        } as CSSProperties
      }
      className={
        `app layout-${layoutMode} ${navigation.sidebarOpen ? "drawer-open" : ""} ` +
        `${navigation.sidebarHidden ? "sidebar-hidden" : ""} ${railResizing ? "rail-resizing" : ""} ` +
        `${canvasPinned ? "canvas-rail-pinned" : "canvas-rail-auto"} ${canvasOpen ? "canvas-rail-open" : ""} ` +
        `mode-${navigation.workspaceMode}`
      }
    >
      <AppDialogs
        pickerPurpose={pickerPurpose}
        pickerInitialPath={
          pickerPurpose === "agent"
            ? (agent.activeSession?.cwd ?? terminal.activeSession?.cwd ?? undefined)
            : (terminal.activeSession?.cwd ?? undefined)
        }
        onClosePicker={closePicker}
        onSelectPath={(path) => {
          if (pickerPurpose === "agent") {
            void agent.choosePath(path).then((added) => {
              if (added) closePicker();
            });
          } else {
             void terminal.chooseLaunchPath(path).then((added) => {
               if (added) setPickerPurpose(null);
             });
          }
        }}
        confirmAction={confirmAction}
        actionBusy={actionBusy}
        onRunConfirmAction={runConfirmAction}
        onCloseConfirmAction={() => setConfirmAction(null)}
        deleteCandidate={deleteCandidate}
        deleting={deleting}
        onCancelDelete={() => setDeleteCandidate(null)}
        onConfirmDelete={() => {
          if (deleteCandidate) void deleteSession(deleteCandidate);
        }}
      />
      <button className="drawer-backdrop" aria-label="Close navigation" onClick={navigation.closeSidebar} />
      {layoutMode === "canvas" && !mobileNavigation && !canvasPinned && (
        <button ref={canvasEdgeTriggerRef} className="canvas-edge-trigger" type="button" aria-label="Open navigation" aria-expanded={canvasOpen} aria-controls={CANVAS_RAIL_ID} onMouseEnter={openCanvasRail} onMouseLeave={scheduleCanvasClose} onFocus={() => {
          if (suppressCanvasEdgeFocusRef.current) suppressCanvasEdgeFocusRef.current = false;
          else openCanvasRail();
        }} onBlur={(event) => {
          const next = event.relatedTarget;
          if (canvasRailRef.current?.contains(next) || canvasHandleRef.current?.contains(next)) return;
          scheduleCanvasClose();
        }} onClick={openCanvasRail} />
      )}
      {layoutMode === "canvas" && mobileNavigation && !sidebarOpen && (
        <button ref={canvasMobileTriggerRef} className="canvas-mobile-trigger" type="button" aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls={CANVAS_RAIL_ID} onClick={navigation.toggleSidebar}><Menu /></button>
      )}
      <AppNavigationRail
        navigation={navigation}
        terminal={terminal}
        agent={agent}
        skills={skills}
        webApps={webApps}
        homePaths={homePaths}
        busy={busy}
        skillsSection={skillsSection}
        onSelectSkillsSection={setSkillsSection}
        settingsSection={settingsSection}
        onSelectSettingsSection={setSettingsSection}
        onPickWorkspace={() => setPickerPurpose("add-launch-path")}
        onNewWorkspace={() => void terminal.createWorkspace()}
        onPickAgentPath={() => setPickerPurpose("agent")}
        onCloseAgentSession={(session) => requestClose(session, true)}
        onSessionSelected={onSessionSelected}
        terminalCapacity={terminalCapacity}
        terminalLayoutCount={terminalLayoutCount}
        terminalLayoutPreset={terminalLayoutPreset}
         terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
         terminalThumbnailSide={terminalThumbnailSide}
         terminalLaunchPathsHeight={agentLaunchPathsMaxHeightPx}
         confirmTerminalClose={confirmDelete}
         agentCapacity={agentCapacity}
         agentLayoutCount={agentLayoutCount}
         agentLayoutPreset={agentLayoutPreset}
         agentThumbnailsAutoHide={agentThumbnailsAutoHide}
         agentThumbnailSide={agentThumbnailSide}
         onTerminalCapacityChange={setTerminalCapacity}
        onTerminalLayoutPresetChange={setTerminalLayoutPreset}
         onToggleTerminalThumbnailAutoHide={() => setTerminalThumbnailsAutoHide((autoHide) => !autoHide)}
         onTerminalThumbnailSideChange={setTerminalThumbnailSide}
         onTerminalLaunchPathsHeightChange={setAgentLaunchPathsMaxHeightPx}
         onConfirmTerminalCloseChange={(enabled) => {
           setConfirmDelete(enabled);
           localStorage.setItem("devhatch-confirm-terminal-delete", enabled ? "1" : "0");
         }}
         onAgentCapacityChange={setAgentCapacity}
         onAgentLayoutPresetChange={setAgentLayoutPreset}
         onToggleAgentThumbnailAutoHide={() => setAgentThumbnailsAutoHide((autoHide) => !autoHide)}
         onAgentThumbnailSideChange={setAgentThumbnailSide}
         onConfirm={setConfirmAction}
        layoutMode={layoutMode}
        canvasPinned={canvasPinned}
        railInteractive={mobileNavigation ? navigation.sidebarOpen : layoutMode === "classic" ? !navigation.sidebarHidden : canvasPinned || canvasOpen}
        railId={CANVAS_RAIL_ID}
        railRef={canvasRailRef}
        onCanvasPinnedChange={() => {
          const next = !canvasPinned;
          cancelCanvasClose();
          setCanvasPinned(next);
          writeCanvasSidebarPinned(next);
          if (next) {
            setCanvasOpen(false);
            return;
          }
          canvasRailHoverRef.current = canvasRailRef.current?.matches(":hover") ?? false;
          setCanvasOpen(true);
          if (!canvasRailHoverRef.current && !(document.activeElement instanceof HTMLElement && document.activeElement.matches(":focus-visible") && canvasRailRef.current?.contains(document.activeElement))) scheduleCanvasClose();
        }}
        onCanvasEnter={() => {
          canvasRailHoverRef.current = true;
          openCanvasRail();
        }}
        onCanvasLeave={() => {
          canvasRailHoverRef.current = false;
          scheduleCanvasClose();
        }}
        onCanvasFocus={openCanvasRail}
        onCanvasBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && !canvasHandleRef.current?.contains(event.relatedTarget)) scheduleCanvasClose();
        }}
        onStopWebApp={() => void webApps.stop()}
      />
      <RailResizeHandle
        handleRef={canvasHandleRef}
        value={draftRailWidth}
        hidden={layoutMode === "classic" ? navigation.sidebarHidden : !canvasPinned && !canvasOpen}
        onPreview={setDraftRailWidth}
        onCommit={setNavigationRailWidthPx}
        onResizingChange={(resizing) => {
          railResizingRef.current = resizing;
          setRailResizing(resizing);
          if (resizing) cancelCanvasClose();
          else if (!canvasRailHoverRef.current && !canvasHandleHoverRef.current) scheduleCanvasClose();
        }}
        onPointerEnter={layoutMode === "canvas" ? () => {
          canvasHandleHoverRef.current = true;
          openCanvasRail();
        } : undefined}
        onPointerLeave={layoutMode === "canvas" ? () => {
          canvasHandleHoverRef.current = false;
          if (!railResizingRef.current && !canvasRailHoverRef.current && !canvasHandleRef.current?.contains(document.activeElement)) scheduleCanvasClose();
        } : undefined}
        onFocus={layoutMode === "canvas" ? openCanvasRail : undefined}
        onBlur={layoutMode === "canvas" ? (event) => {
          const next = event.relatedTarget;
          if (canvasRailRef.current?.contains(next) || canvasHandleRef.current?.contains(next)) return;
          scheduleCanvasClose();
        } : undefined}
      />
      <section
        className="shell"
        inert={layoutMode === "canvas" && mobileNavigation && sidebarOpen ? true : undefined}
      >
        {layoutMode === "classic" && (
          <AppHeader
            mode={navigation.workspaceMode}
            label={navigation.modeMeta[navigation.workspaceMode].label}
            subtitle={modeSubtitle}
            onToggleNavigation={navigation.toggleSidebar}
            terminalCapacity={terminalCapacity}
            terminalLayoutCount={terminalLayoutCount}
            terminalLayoutPreset={terminalLayoutPreset}
             terminalThumbnailsHidden={terminalThumbnailsHidden}
             terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
             terminalThumbnailSide={terminalThumbnailSide}
             terminalLaunchPathsHeight={agentLaunchPathsMaxHeightPx}
             confirmTerminalClose={confirmDelete}
             onTerminalCapacityChange={setTerminalCapacity}
            onTerminalLayoutPresetChange={setTerminalLayoutPreset}
             onToggleTerminalThumbnails={() => setTerminalThumbnailsHidden((hidden) => !hidden)}
             onToggleTerminalThumbnailAutoHide={() => setTerminalThumbnailsAutoHide((autoHide) => !autoHide)}
             onTerminalThumbnailSideChange={setTerminalThumbnailSide}
             onTerminalLaunchPathsHeightChange={setAgentLaunchPathsMaxHeightPx}
              onConfirmTerminalCloseChange={(enabled) => {
                setConfirmDelete(enabled);
                localStorage.setItem("devhatch-confirm-terminal-delete", enabled ? "1" : "0");
              }}
              agentCapacity={agentCapacity}
              agentLayoutCount={agentLayoutCount}
              agentLayoutPreset={agentLayoutPreset}
              agentThumbnailsHidden={agentThumbnailsHidden}
              agentThumbnailsAutoHide={agentThumbnailsAutoHide}
              agentThumbnailSide={agentThumbnailSide}
              onAgentCapacityChange={setAgentCapacity}
              onAgentLayoutPresetChange={setAgentLayoutPreset}
              onToggleAgentThumbnails={() => setAgentThumbnailsHidden((hidden) => !hidden)}
              onToggleAgentThumbnailAutoHide={() => setAgentThumbnailsAutoHide((autoHide) => !autoHide)}
              onAgentThumbnailSideChange={setAgentThumbnailSide}
              webAppRunning={Boolean(webApps.openDesign?.running)}
            webAppOperation={webApps.operation}
            onStopWebApp={() => void webApps.stop()}
          />
        )}
        <AppWorkspaceContent
          mode={navigation.workspaceMode}
          layoutMode={layoutMode}
          terminal={terminal}
          agent={agent}
          skills={skills}
          webApps={webApps}
          busy={busy}
          phases={phases}
          focusVersion={focusVersion}
          terminalCapacity={terminalCapacity}
          terminalThumbnailsHidden={terminalThumbnailsHidden}
          terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
           terminalThumbnailSide={terminalThumbnailSide}
           terminalWorkspaceLayouts={terminalWorkspaceLayouts}
           agentCapacity={agentCapacity}
           agentThumbnailsHidden={agentThumbnailsHidden}
           agentThumbnailsAutoHide={agentThumbnailsAutoHide}
           agentThumbnailSide={agentThumbnailSide}
           agentWorkspaceLayouts={agentWorkspaceLayouts}
           error={error}
          skillsSection={skillsSection}
           settingsSection={settingsSection}
           onSelectSettingsSection={setSettingsSection}
           onCloseSession={requestClose}
          onPickAgentPath={() => setPickerPurpose("agent")}
          onPhaseChange={setPhase}
           onTerminalLayoutCountChange={setTerminalLayoutCount}
           onTerminalWorkspaceLayoutChange={updateTerminalWorkspaceLayout}
           onAgentLayoutCountChange={setAgentLayoutCount}
           onAgentWorkspaceLayoutChange={updateAgentWorkspaceLayout}
           onError={reportError}
           onDismissError={() => setError(null)}
           onConfirm={setConfirmAction}
           onLogout={onLogout}
          logoutBusy={logoutBusy}
          logoutError={logoutError}
        />
      </section>
    </main>
  );
}

export default App;
