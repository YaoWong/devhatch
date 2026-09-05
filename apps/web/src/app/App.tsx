import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { flushSync } from "react-dom";
import { AppDialogs } from "./AppDialogs";
import { AppNavigationRail } from "./AppNavigationRail";
import { AppWorkspaceContent } from "./AppWorkspaceContent";
import { useInitialWorkspaceData } from "./useInitialWorkspaceData";
import { useAgentWorkspace } from "../features/agents/hooks/useAgentWorkspace";
import { useNavigation } from "../features/navigation/useNavigation";
import { readCanvasSidebarPinned, writeCanvasSidebarPinned } from "../features/navigation/canvasSidebarPreference";
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
import {
  CUSTOM_SELECT_OPEN_CHANGE_EVENT,
  hasOpenCustomSelectPortalOwnedBy,
  isCustomSelectOwnedBy,
} from "../shared/ui/customSelectPortal";
import { resolveDialogNavigationState, type ConfirmAction, type DeleteTarget, type LaunchPathDisplay } from "../types/app";
import type { ConnectionPhase, TerminalInfo } from "../types/terminals";

const TERMINAL_ROWS_STORAGE_KEY = "devhatch-terminal-workspace-rows";
const CANVAS_RAIL_ID = "canvas-navigation-rail";
const CANVAS_RAIL_CLOSE_DELAY_MS = 120;
const CANVAS_RAIL_POPOVER_SELECTOR = "[data-canvas-rail-popover]";
const CANVAS_RAIL_DIALOG_SELECTOR = "[data-canvas-rail-dialog]";
const TERMINAL_THUMBNAIL_SIDE_STORAGE_KEY = "devhatch-terminal-thumbnail-side";
const AGENT_WORKSPACE_CAPACITY_STORAGE_KEY = "devhatch-agent-workspace-capacity";
const AGENT_THUMBNAIL_SIDE_STORAGE_KEY = "devhatch-agent-thumbnail-side";
const AGENT_WORKSPACE_LAYOUT_STORAGE_KEY = "devhatch-agent-workspace-layouts-v2";
const LEGACY_AGENT_WORKSPACE_LAYOUT_STORAGE_KEY = "devhatch-agent-workspace-layouts-v1";
const TERMINAL_PATH_DISPLAY_STORAGE_KEY = "devhatch-terminal-path-display";
const AGENT_PATH_DISPLAY_STORAGE_KEY = "devhatch-agent-path-display";
type TerminalThumbnailSide = "left" | "right";

function initialPathDisplay(storageKey: string): LaunchPathDisplay {
  try {
    return localStorage.getItem(storageKey) === "full" ? "full" : "folder";
  } catch {
    return "folder";
  }
}

function initialThumbnailSide(storageKey = TERMINAL_THUMBNAIL_SIDE_STORAGE_KEY): TerminalThumbnailSide {
  try {
    return localStorage.getItem(storageKey) === "right" ? "right" : "left";
  } catch {
    return "left";
  }
}

function isCanvasRailOwnedTarget(rail: Element | null, target: EventTarget | null) {
  const popover = document.querySelector(CANVAS_RAIL_POPOVER_SELECTOR);
  return isCustomSelectOwnedBy(rail, target) || isCustomSelectOwnedBy(popover, target);
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

function MobileNavigationSheet({
  children,
  mobile,
  open,
  restoreFocus,
  railRef,
  triggerRef,
  onOpenChange,
}: {
  children: ReactNode;
  mobile: boolean;
  open: boolean;
  restoreFocus: boolean;
  railRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
}) {
  if (!mobile) return children;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger
        render={
          <Button
            variant="outline"
            size="icon"
            ref={triggerRef}
            className="canvas-mobile-trigger tw:fixed tw:top-2.5 tw:left-2.5 tw:z-40 tw:size-10 tw:rounded-[11px] tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_86%,transparent)] tw:text-foreground tw:shadow-[0_4px_16px_rgb(0_0_0/10%)] tw:backdrop-blur-xl tw:hover:bg-[color-mix(in_srgb,var(--color-surface)_94%,transparent)]! tw:[@media(pointer:coarse)]:size-11"
            type="button"
            aria-label="Open navigation"
          />
        }
      >
        <Menu className="tw:size-[17px]" />
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton
        initialFocus={() => railRef.current ? getFocusableRailElements(railRef.current)[0] ?? railRef.current : false}
        finalFocus={restoreFocus ? triggerRef : false}
        overlayClassName="tw:z-40 tw:bg-[rgb(var(--overlay-color)/35%)] tw:backdrop-blur-none"
        className="tw:data-[side=left]:inset-y-3 tw:data-[side=left]:left-3 tw:data-[side=left]:h-[calc(100dvh-24px)] tw:data-[side=left]:w-[min(320px,calc(100vw-24px))] tw:max-w-none tw:gap-0 tw:overflow-hidden tw:rounded-[18px] tw:border tw:border-border tw:bg-[var(--color-surface)] tw:p-0 tw:shadow-[0_12px_32px_rgb(0_0_0/8%)] tw:data-[side=left]:data-ending-style:-translate-x-[calc(100%+24px)] tw:data-[side=left]:data-starting-style:-translate-x-[calc(100%+24px)]"
      >
        <SheetTitle className="tw:sr-only">Navigation</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
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

function initialAgentWorkspaceLayouts() {
  try { localStorage.removeItem(LEGACY_AGENT_WORKSPACE_LAYOUT_STORAGE_KEY); } catch { return {}; }
  return readTerminalWorkspaceLayouts(AGENT_WORKSPACE_LAYOUT_STORAGE_KEY);
}

function App({ onLogout, logoutBusy, logoutError }: { onLogout: () => Promise<void>; logoutBusy: boolean; logoutError: string | null }) {
  const {
    agentLaunchPathsMaxHeightPx,
    navigationRailWidthPx,
    error: settingsError,
    dismissError: dismissSettingsError,
    setAgentLaunchPathsMaxHeightPx,
    setNavigationRailWidthPx,
  } = useTheme();
  const [canvasPinned, setCanvasPinned] = useState(readCanvasSidebarPinned);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(() => window.matchMedia("(max-width: 920px)").matches);
  const [restoreMobileNavigationFocus, setRestoreMobileNavigationFocus] = useState(true);
  const previousMobileNavigationRef = useRef(mobileNavigation);
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
  const [terminalCapacity, setTerminalCapacityState] = useState<TerminalWorkspaceCapacity>(initialCapacity);
  const [terminalPathDisplay, setTerminalPathDisplayState] = useState<LaunchPathDisplay>(() => initialPathDisplay(TERMINAL_PATH_DISPLAY_STORAGE_KEY));
  const [terminalThumbnailsAutoHide, setTerminalThumbnailsAutoHide] = useState(false);
  const [terminalThumbnailSide, setTerminalThumbnailSideState] = useState<TerminalThumbnailSide>(initialThumbnailSide);
  const [terminalLayoutCount, setTerminalLayoutCount] = useState<TerminalLayoutCount | null>(null);
  const [terminalWorkspaceLayouts, setTerminalWorkspaceLayouts] = useState<Record<string, TerminalWorkspaceLayoutPreferences>>(readTerminalWorkspaceLayouts);
  const [agentCapacity, setAgentCapacityState] = useState<TerminalWorkspaceCapacity>(() => initialCapacity(AGENT_WORKSPACE_CAPACITY_STORAGE_KEY));
  const [agentPathDisplay, setAgentPathDisplayState] = useState<LaunchPathDisplay>(() => initialPathDisplay(AGENT_PATH_DISPLAY_STORAGE_KEY));
  const [agentThumbnailsAutoHide, setAgentThumbnailsAutoHide] = useState(false);
  const [agentThumbnailSide, setAgentThumbnailSideState] = useState<TerminalThumbnailSide>(() => initialThumbnailSide(AGENT_THUMBNAIL_SIDE_STORAGE_KEY));
  const [agentLayoutCount, setAgentLayoutCount] = useState<TerminalLayoutCount | null>(null);
  const [agentWorkspaceLayouts, setAgentWorkspaceLayouts] = useState<Record<string, TerminalWorkspaceLayoutPreferences>>(initialAgentWorkspaceLayouts);
  const setPathDisplay = useCallback((mode: LaunchPathDisplay, storageKey: string, setValue: (mode: LaunchPathDisplay) => void) => {
    setValue(mode);
    try { localStorage.setItem(storageKey, mode); } catch { return; }
  }, []);
  const setTerminalPathDisplay = useCallback((mode: LaunchPathDisplay) => {
    setPathDisplay(mode, TERMINAL_PATH_DISPLAY_STORAGE_KEY, setTerminalPathDisplayState);
  }, [setPathDisplay]);
  const setAgentPathDisplay = useCallback((mode: LaunchPathDisplay) => {
    setPathDisplay(mode, AGENT_PATH_DISPLAY_STORAGE_KEY, setAgentPathDisplayState);
  }, [setPathDisplay]);
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
    const compositeOpen = document.querySelector('[data-slot="sheet-content"][data-open], [data-slot="popover-content"][data-open]') !== null;
    if (activeTransition) {
      try { activeTransition.skipTransition(); } catch { void activeTransition.finished.catch(() => undefined); }
      transitionRef.current = null;
      document.documentElement.classList.remove(transitionClass);
      flushSync(update);
    } else {
      const startViewTransition = document.startViewTransition?.bind(document);
      if (!startViewTransition || compositeOpen || matchMedia("(prefers-reduced-motion: reduce)").matches) update();
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
      const activeCanvasRailPopover = active instanceof Element ? active.closest(CANVAS_RAIL_POPOVER_SELECTOR) : null;
      const focusWillBeLost = movingToMobile
        ? canvasEdgeTriggerRef.current === active || canvasHandleRef.current?.contains(active) || canvasRailRef.current?.contains(active) || isCanvasRailOwnedTarget(canvasRailRef.current, active) || Boolean(activeCanvasRailPopover)
        : canvasMobileTriggerRef.current === active || canvasRailRef.current?.contains(active) || isCanvasRailOwnedTarget(canvasRailRef.current, active) || Boolean(activeCanvasRailPopover);
      breakpointFocusTargetRef.current = focusWillBeLost ? (movingToMobile ? "mobile" : "desktop") : null;
      if (!movingToMobile && focusWillBeLost) setRestoreMobileNavigationFocus(false);
      setMobileNavigation(movingToMobile);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const bumpFocus = useCallback(() => setFocusVersion((value) => value + 1), []);
  const reportError = useCallback((message: string) => setError(message), []);
  const closePicker = useCallback(() => setPickerPurpose(null), []);
  const navigation = useNavigation(bumpFocus);
  const { selectMode, showGlobalSettings, closeSidebar, sidebarOpen } = navigation;
  const navigationSheetOpen = mobileNavigation && sidebarOpen;
  const { anyDialogOpen, requiresMobileNavigationClose } = resolveDialogNavigationState({
    pickerOpen: pickerPurpose !== null,
    confirmAction,
    sessionDeleteOpen: deleteCandidate !== null,
  });
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
    if (restoreFocus && (canvasRailRef.current?.contains(document.activeElement) || isCanvasRailOwnedTarget(canvasRailRef.current, document.activeElement))) {
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
      const activeCanvasRailPopover = active instanceof Element ? active.closest(CANVAS_RAIL_POPOVER_SELECTOR) : null;
      const railHasKeyboardFocus = active instanceof HTMLElement && active.matches(":focus-visible") && (
        canvasRailRef.current?.contains(active) || canvasHandleRef.current?.contains(active) ||
        isCanvasRailOwnedTarget(canvasRailRef.current, active) || activeCanvasRailPopover
      );
      if (
        railResizingRef.current || navigation.railMotion !== null || hasOpenCustomSelectPortalOwnedBy(canvasRailRef.current) ||
        document.querySelector(`${CANVAS_RAIL_POPOVER_SELECTOR}[data-open]`) ||
        document.querySelector(`${CANVAS_RAIL_DIALOG_SELECTOR}[data-open]`) ||
        canvasRailHoverRef.current || canvasHandleHoverRef.current || railHasKeyboardFocus
      ) return;
      setCanvasOpen(false);
    }, CANVAS_RAIL_CLOSE_DELAY_MS);
  }, [cancelCanvasClose, navigation.railMotion]);
  useEffect(() => {
    const rail = canvasRailRef.current;
    if (!rail) return;
    const onSelectOpenChange = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail) {
        cancelCanvasClose();
        return;
      }
      if (!mobileNavigation && !canvasPinned && !canvasRailHoverRef.current && !canvasHandleHoverRef.current) {
        scheduleCanvasClose();
      }
    };
    rail.addEventListener(CUSTOM_SELECT_OPEN_CHANGE_EVENT, onSelectOpenChange);
    return () => rail.removeEventListener(CUSTOM_SELECT_OPEN_CHANGE_EVENT, onSelectOpenChange);
  }, [cancelCanvasClose, canvasPinned, mobileNavigation, scheduleCanvasClose]);
  useEffect(() => {
    const onRailDialogClosed = () => {
      if (!mobileNavigation && !canvasPinned && !canvasRailHoverRef.current && !canvasHandleHoverRef.current) {
        scheduleCanvasClose();
      }
    };
    window.addEventListener("devhatch-canvas-rail-dialog-closed", onRailDialogClosed);
    return () => window.removeEventListener("devhatch-canvas-rail-dialog-closed", onRailDialogClosed);
  }, [canvasPinned, mobileNavigation, scheduleCanvasClose]);
  const onSessionSelected = useCallback(() => {
    if (mobileNavigation || canvasPinned) return;
    cancelCanvasClose();
    setCanvasOpen(false);
  }, [cancelCanvasClose, canvasPinned, mobileNavigation]);
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
    if (requiresMobileNavigationClose && mobileNavigation && sidebarOpen) {
      setRestoreMobileNavigationFocus(false);
      closeSidebar();
    }
  }, [closeSidebar, mobileNavigation, requiresMobileNavigationClose, sidebarOpen]);
  useEffect(() => {
    if (railResizing || navigation.railMotion !== null) cancelCanvasClose();
    else if (!canvasRailHoverRef.current && !canvasHandleHoverRef.current) scheduleCanvasClose();
  }, [cancelCanvasClose, navigation.railMotion, railResizing, scheduleCanvasClose]);
  useEffect(() => () => cancelCanvasClose(), [cancelCanvasClose]);
  useEffect(() => {
    const modes = ["terminal", "agent", "skills", "webapp", "settings"] as const;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === "Escape") {
        if (anyDialogOpen || document.querySelector('[aria-modal="true"]') || isCanvasRailOwnedTarget(canvasRailRef.current, target)) return;
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
      if (event.key === ",") {
        event.preventDefault();
        showGlobalSettings();
        return;
      }
      const index = Number(event.key) - 1;
      const mode = modes[index];
      if (!mode || mode === "settings") return;
      event.preventDefault();
      selectMode(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anyDialogOpen, canvasOpen, canvasPinned, closeCanvasRail, closeSidebar, selectMode, showGlobalSettings, sidebarOpen]);
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
  const agentLayoutPreset = agent.selectedAgentWorkspaceId && agentLayoutCount
    ? agentWorkspaceLayouts[agent.selectedAgentWorkspaceId]?.presets[agentLayoutCount] ?? defaultTerminalLayoutPreset(agentLayoutCount)
    : null;
  const setAgentLayoutPreset = useCallback((preset: TerminalLayoutPreset) => {
    if (!agent.selectedAgentWorkspaceId || !agentLayoutCount) return;
    const workspaceId = agent.selectedAgentWorkspaceId;
    const count = agentLayoutCount;
    updateAgentWorkspaceLayout(workspaceId, (current) => ({ ...current, presets: { ...current.presets, [count]: preset } }));
  }, [agent.selectedAgentWorkspaceId, agentLayoutCount, updateAgentWorkspaceLayout]);
  const webApps = useWebApps(navigation.workspaceMode === "webapp", reportError);
  const skills = useSkillsWorkspace(
    navigation.workspaceMode === "skills" || navigation.workspaceMode === "agent",
    reportError,
    navigation.workspaceMode === "skills",
  );

  const {
    initializeAgents,
    initializePaths,
    initializeWorkspaces: initializeAgentWorkspaces,
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
    initializeAgentWorkspaces,
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
    (session: TerminalInfo, isAgent: boolean, returnFocus?: HTMLElement | null, fallbackFocus?: HTMLElement | null) => {
      const target: DeleteTarget = {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        kind: isAgent ? "agent session" : "terminal",
        returnFocus,
        fallbackFocus,
      };
      if (confirmDelete) setDeleteCandidate(target);
      else {
        void deleteSession(target).finally(() => {
          queueMicrotask(() => {
            if (!returnFocus?.isConnected) fallbackFocus?.focus();
          });
        });
      }
    },
    [confirmDelete, deleteSession],
  );

  const requestOpenTerminalLink = useCallback((url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      setError(`Blocked terminal link: ${url}`);
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setError(`Invalid terminal link: ${url}`);
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      setError(`Blocked terminal link: ${url}`);
      return;
    }
    setConfirmAction({
      title: "Open terminal link?",
      description: url,
      confirmLabel: "Open link",
      action: () => {
        window.open(parsed.href, "_blank", "noopener,noreferrer");
        return true;
      },
    });
  }, []);

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    setActionBusy(true);
    try {
      const succeeded = await confirmAction.action();
      if (succeeded !== false) {
        confirmAction.onClose?.();
        setConfirmAction(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <main
      style={
        {
          "--agent-launch-paths-max-height": `${agentLaunchPathsMaxHeightPx}px`,
          "--navigation-rail-width": `${draftRailWidth}px`,
        } as CSSProperties
      }
      className={
        `app ${railResizing ? "rail-resizing" : ""} ` +
        `${canvasPinned ? "canvas-rail-pinned" : "canvas-rail-auto"} ${canvasOpen ? "canvas-rail-open" : ""} ` +
        `mode-${navigation.workspaceMode}`
      }
    >
      <AppDialogs
        pickerPurpose={pickerPurpose}
        pickerInitialPath={
          pickerPurpose === "agent"
            ? (agent.launcherActiveSession?.cwd ?? terminal.activeSession?.cwd ?? undefined)
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
        onCloseConfirmAction={() => {
          confirmAction?.onClose?.();
          setConfirmAction(null);
        }}
        deleteCandidate={deleteCandidate}
        deleting={deleting}
        onCancelDelete={() => setDeleteCandidate(null)}
        onConfirmDelete={() => {
          if (deleteCandidate) void deleteSession(deleteCandidate);
        }}
      />
      {!mobileNavigation && !canvasPinned && (
        <Button variant="ghost" ref={canvasEdgeTriggerRef} className="canvas-edge-trigger tw:fixed tw:top-1/2 tw:left-0 tw:z-39 tw:size-10 tw:-translate-y-1/2 tw:rounded-none tw:border-0 tw:bg-transparent tw:p-0 tw:hover:bg-transparent! tw:aria-expanded:bg-transparent! tw:active:not-aria-[haspopup]:-translate-y-1/2! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Open navigation" aria-expanded={canvasOpen} aria-controls={CANVAS_RAIL_ID} onMouseEnter={openCanvasRail} onMouseLeave={scheduleCanvasClose} onFocus={() => {
          if (suppressCanvasEdgeFocusRef.current) suppressCanvasEdgeFocusRef.current = false;
          else openCanvasRail();
        }} onBlur={(event) => {
          const next = event.relatedTarget;
          if (canvasRailRef.current?.contains(next) || canvasHandleRef.current?.contains(next)) return;
          scheduleCanvasClose();
        }} onClick={openCanvasRail} />
      )}
      <MobileNavigationSheet
        mobile={mobileNavigation}
        open={navigationSheetOpen}
        restoreFocus={restoreMobileNavigationFocus}
        railRef={canvasRailRef}
        triggerRef={canvasMobileTriggerRef}
        onOpenChange={(open) => {
          if (open) {
            setRestoreMobileNavigationFocus(true);
            navigation.openSidebar();
          } else {
            navigation.closeSidebar();
          }
        }}
      >
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
        onPickWorkspace={() => setPickerPurpose("add-launch-path")}
        onNewWorkspace={() => void terminal.createWorkspace()}
        onPickAgentPath={() => setPickerPurpose("agent")}
        onCloseAgentSession={(session) => requestClose(session, true)}
        onSessionSelected={onSessionSelected}
        terminalCapacity={terminalCapacity}
        terminalLayoutCount={terminalLayoutCount}
         terminalLayoutPreset={terminalLayoutPreset}
         terminalPathDisplay={terminalPathDisplay}
          terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
         terminalThumbnailSide={terminalThumbnailSide}
         terminalLaunchPathsHeight={agentLaunchPathsMaxHeightPx}
         confirmTerminalClose={confirmDelete}
         agentCapacity={agentCapacity}
         agentLayoutCount={agentLayoutCount}
         agentLayoutPreset={agentLayoutPreset}
         agentPathDisplay={agentPathDisplay}
          agentThumbnailsAutoHide={agentThumbnailsAutoHide}
         agentThumbnailSide={agentThumbnailSide}
         onTerminalCapacityChange={setTerminalCapacity}
        onTerminalLayoutPresetChange={setTerminalLayoutPreset}
        onTerminalPathDisplayChange={setTerminalPathDisplay}
         onToggleTerminalThumbnailAutoHide={() => setTerminalThumbnailsAutoHide((autoHide) => !autoHide)}
         onTerminalThumbnailSideChange={setTerminalThumbnailSide}
         onTerminalLaunchPathsHeightChange={setAgentLaunchPathsMaxHeightPx}
         onConfirmTerminalCloseChange={(enabled) => {
           setConfirmDelete(enabled);
           localStorage.setItem("devhatch-confirm-terminal-delete", enabled ? "1" : "0");
         }}
         onAgentCapacityChange={setAgentCapacity}
         onAgentLayoutPresetChange={setAgentLayoutPreset}
         onAgentPathDisplayChange={setAgentPathDisplay}
         onToggleAgentThumbnailAutoHide={() => setAgentThumbnailsAutoHide((autoHide) => !autoHide)}
         onAgentThumbnailSideChange={setAgentThumbnailSide}
         onConfirm={setConfirmAction}
         canvasPinned={canvasPinned}
         railInteractive={mobileNavigation ? navigation.sidebarOpen : canvasPinned || canvasOpen}
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
          const railHasKeyboardFocus = document.activeElement instanceof HTMLElement && document.activeElement.matches(":focus-visible") && (
            canvasRailRef.current?.contains(document.activeElement) ||
            isCanvasRailOwnedTarget(canvasRailRef.current, document.activeElement)
          );
          if (!canvasRailHoverRef.current && !railHasKeyboardFocus) scheduleCanvasClose();
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
            const relatedPopover = event.relatedTarget instanceof Element ? event.relatedTarget.closest(CANVAS_RAIL_POPOVER_SELECTOR) : null;
            const relatedDialog = event.relatedTarget instanceof Element ? event.relatedTarget.closest(CANVAS_RAIL_DIALOG_SELECTOR) : null;
            if (
              event.currentTarget.contains(event.relatedTarget) ||
              canvasHandleRef.current?.contains(event.relatedTarget) ||
              isCanvasRailOwnedTarget(event.currentTarget, event.relatedTarget) ||
              relatedPopover || relatedDialog
           ) return;
           scheduleCanvasClose();
         }}
         onFloatingSettingsOpenChange={(open) => {
           if (open) {
             cancelCanvasClose();
             setCanvasOpen(true);
           } else if (!canvasRailHoverRef.current && !canvasHandleHoverRef.current) {
             scheduleCanvasClose();
           }
         }}
         onStopWebApp={() => void webApps.stop()}
      />
      </MobileNavigationSheet>
      {!mobileNavigation && (
        <RailResizeHandle
        handleRef={canvasHandleRef}
         value={draftRailWidth}
         hidden={!canvasPinned && !canvasOpen}
        onPreview={setDraftRailWidth}
        onCommit={setNavigationRailWidthPx}
        onResizingChange={(resizing) => {
          railResizingRef.current = resizing;
          setRailResizing(resizing);
          if (resizing) cancelCanvasClose();
          else if (!canvasRailHoverRef.current && !canvasHandleHoverRef.current) scheduleCanvasClose();
        }}
         onPointerEnter={() => {
           canvasHandleHoverRef.current = true;
           openCanvasRail();
         }}
         onPointerLeave={() => {
           canvasHandleHoverRef.current = false;
           if (!railResizingRef.current && !canvasRailHoverRef.current && !canvasHandleRef.current?.contains(document.activeElement)) scheduleCanvasClose();
         }}
         onFocus={openCanvasRail}
         onBlur={(event) => {
           const next = event.relatedTarget;
           if (canvasRailRef.current?.contains(next) || canvasHandleRef.current?.contains(next)) return;
           scheduleCanvasClose();
          }}
        />
      )}
      <section className="shell">
        <AppWorkspaceContent
          mode={navigation.workspaceMode}
          terminal={terminal}
          agent={agent}
          skills={skills}
          webApps={webApps}
          busy={busy}
          phases={phases}
          focusVersion={focusVersion}
          terminalCapacity={terminalCapacity}
          terminalThumbnailsAutoHide={terminalThumbnailsAutoHide}
           terminalThumbnailSide={terminalThumbnailSide}
           terminalWorkspaceLayouts={terminalWorkspaceLayouts}
           agentCapacity={agentCapacity}
           agentThumbnailsAutoHide={agentThumbnailsAutoHide}
           agentThumbnailSide={agentThumbnailSide}
           agentWorkspaceLayouts={agentWorkspaceLayouts}
           error={navigation.workspaceMode !== "settings" && !navigationSheetOpen && settingsError ? settingsError : error}
            skillsSection={skillsSection}
            onCloseSession={requestClose}
          onPickAgentPath={() => setPickerPurpose("agent")}
          onPhaseChange={setPhase}
           onTerminalLayoutCountChange={setTerminalLayoutCount}
           onTerminalWorkspaceLayoutChange={updateTerminalWorkspaceLayout}
           onAgentLayoutCountChange={setAgentLayoutCount}
           onAgentWorkspaceLayoutChange={updateAgentWorkspaceLayout}
           onError={reportError}
            onDismissError={() => {
              if (navigation.workspaceMode !== "settings" && !navigationSheetOpen && settingsError) dismissSettingsError();
              else setError(null);
            }}
            onConfirm={setConfirmAction}
            onOpenTerminalLink={requestOpenTerminalLink}
            onLogout={onLogout}
          logoutBusy={logoutBusy}
          logoutError={logoutError}
        />
      </section>
    </main>
  );
}

export default App;
