import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bot, Globe2, Settings, Sparkles, SquareTerminal } from "lucide-react";
import type { DetailMode, RailMotion, RailPage, WorkspaceMode } from "../../types/app";

type RailFocusRequest = {
  mode: DetailMode;
  target: "back" | "mode";
};

export function getRailFocusRequest(
  page: RailPage,
  motion: Exclude<RailMotion, null>,
  currentPage: RailPage,
  workspaceMode: WorkspaceMode,
): RailFocusRequest {
  return {
    mode: page === "modes" ? (currentPage === "modes" ? workspaceMode : currentPage) : page,
    target: motion === "forward" ? "back" : "mode",
  };
}

export function useNavigation(bumpFocus: () => void) {
  const [railPage, setRailPage] = useState<RailPage>("modes");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("settings");
  const [railMotion, setRailMotion] = useState<RailMotion>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const motionTimer = useRef<number | null>(null);
  const railFlightRef = useRef<ActiveRailFlight | null>(null);
  const modesPageRef = useRef<HTMLElement | null>(null);
  const pageRefs = useRef<Record<DetailMode, HTMLElement | null>>({
    terminal: null,
    agent: null,
    skills: null,
    webapp: null,
    settings: null,
  });
  const modeRefs = useRef<Record<DetailMode, HTMLButtonElement | null>>({
    terminal: null,
    agent: null,
    skills: null,
    webapp: null,
    settings: null,
  });
  const focusRequestRef = useRef<RailFocusRequest | null>(null);
  const titleRefs = useRef<Record<DetailMode, HTMLSpanElement | null>>({
    terminal: null,
    agent: null,
    skills: null,
    webapp: null,
    settings: null,
  });
  const modeMeta = useMemo(
    () => ({
      terminal: { label: "Terminal", icon: SquareTerminal },
      agent: { label: "Agent CLI", icon: Bot },
      skills: { label: "Skills", icon: Sparkles },
      webapp: { label: "Web Apps", icon: Globe2 },
      settings: { label: "Settings", icon: Settings },
    }),
    [],
  );

  useLayoutEffect(() => {
    const request = focusRequestRef.current;
    if (!request) return;
    const target = request.target === "back"
      ? railPage === request.mode
        ? pageRefs.current[request.mode]?.querySelector<HTMLButtonElement>(".rail-back")
        : null
      : railPage === "modes"
        ? modeRefs.current[request.mode]
        : null;
    if (!target) return;
    focusRequestRef.current = null;
    if (target.closest('[inert], [aria-hidden="true"]')) return;
    target.focus({ preventScroll: true });
  }, [railPage]);

  const animateRail = useCallback(
    (page: RailPage, motion: Exclude<RailMotion, null>, showSettingsOnReturn = false) => {
      const focusRequest = getRailFocusRequest(page, motion, railPage, workspaceMode);
      const detailMode = focusRequest.mode;
      if (motionTimer.current) window.clearTimeout(motionTimer.current);
      railFlightRef.current?.cancel();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        focusRequestRef.current = focusRequest;
        setRailMotion(null);
        setRailPage(page);
        if (motion === "forward" && page !== "modes") {
          setWorkspaceMode(page);
          if (page === "terminal" || page === "agent") bumpFocus();
        } else if (motion === "return" && page === "modes" && showSettingsOnReturn) {
          setWorkspaceMode("settings");
        }
        return;
      }
      const source = modeRefs.current[detailMode];
      const detail = titleRefs.current[detailMode];
      const modesPage = modesPageRef.current;
      const targetPage = pageRefs.current[detailMode];
      if (!source || !detail || !modesPage || !targetPage) return;
      focusRequestRef.current = focusRequest;
      const measuring = motion === "forward" ? targetPage : modesPage;
      measuring.classList.add("is-measuring");
      const sourceRect = source.getBoundingClientRect();
      const detailRect = detail.getBoundingClientRect();
      measuring.classList.remove("is-measuring");
      const sourceLabel = source.querySelector<HTMLElement>("span");
      const detailLabel = detail.querySelector<HTMLElement>("strong");
      if (!sourceLabel || !detailLabel) return;
      const sourceStyle = getComputedStyle(source);
      const sourceLabelStyle = getComputedStyle(sourceLabel);
      const detailStyle = getComputedStyle(detail);
      const detailLabelStyle = getComputedStyle(detailLabel);
      const sourceState = flightState(sourceRect, sourceStyle, sourceLabelStyle);
      const detailState = flightState(detailRect, detailStyle, detailLabelStyle);
      const from = motion === "return" ? detailState : sourceState;
      const to = motion === "return" ? sourceState : detailState;
      const themeStyle = getComputedStyle(document.documentElement);
      const inactiveColor = themeStyle.getPropertyValue("--color-text-subtle").trim();
      const sourceColor = sourceStyle.color;
      const sourceBackground = sourceStyle.backgroundColor;
      const detailColor = detailStyle.color;
      const detailBackground = detailStyle.backgroundColor;
      const fromColor = motion === "forward" ? sourceColor : detailColor;
      const fromBackground = motion === "forward" ? sourceBackground : detailBackground;
      const toColor = motion === "forward" ? detailColor : showSettingsOnReturn ? inactiveColor : sourceColor;
      const toBackground = motion === "forward" || showSettingsOnReturn ? "transparent" : sourceBackground;
      const flight = document.createElement("span");
      flight.className = "shared-title-flight";
      flight.setAttribute("aria-hidden", "true");
      const icon = source.querySelector("svg")?.cloneNode(true);
      if (icon) flight.appendChild(icon);
      const label = document.createElement("span");
      label.textContent = modeMeta[detailMode].label;
      flight.appendChild(label);
      Object.assign(flight.style, frame(from), {
        color: fromColor,
        backgroundColor: fromBackground,
      });
      source.dataset.railFlightSource = "";
      detail.dataset.railFlightSource = "";
      document.body.appendChild(flight);
      let animation: Animation | null = null;
      const cleanup = () => {
        animation?.cancel();
        animation = null;
        flight.remove();
        if (railFlightRef.current?.element !== flight) return;
        delete source.dataset.railFlightSource;
        delete detail.dataset.railFlightSource;
        railFlightRef.current = null;
      };
      railFlightRef.current = { element: flight, cancel: cleanup };
      setRailMotion(motion);
      setRailPage(page);
      if (motion === "forward" && page !== "modes") {
        setWorkspaceMode(page);
        if (page === "terminal" || page === "agent") bumpFocus();
      } else if (motion === "return" && page === "modes" && showSettingsOnReturn) {
        setWorkspaceMode("settings");
      }
      try {
        animation = flight.animate(
          [
            { ...frame(from), color: fromColor, backgroundColor: fromBackground },
            { ...frame(to), color: toColor, backgroundColor: toBackground },
          ],
          { duration: 420, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" },
        );
      } catch {
        cleanup();
        setRailMotion(null);
        return;
      }
      animation.finished.then(cleanup, cleanup);
      motionTimer.current = window.setTimeout(() => setRailMotion(null), 440);
    },
    [bumpFocus, modeMeta, railPage, workspaceMode],
  );

  useEffect(
    () => () => {
      if (motionTimer.current) window.clearTimeout(motionTimer.current);
      railFlightRef.current?.cancel();
    },
    [],
  );

  const openSidebar = useCallback(() => setSidebarOpen(true), []);

  const closeSidebar = useCallback(() => {
    if (motionTimer.current) {
      window.clearTimeout(motionTimer.current);
      motionTimer.current = null;
    }
    railFlightRef.current?.cancel();
    setRailMotion(null);
    setSidebarOpen(false);
  }, []);

  const selectMode = useCallback((mode: DetailMode) => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current);
    railFlightRef.current?.cancel();
    setWorkspaceMode(mode);
    setRailPage(mode);
    setRailMotion(null);
    setSidebarOpen(false);
    if (mode === "terminal" || mode === "agent") bumpFocus();
  }, [bumpFocus]);

  const showGlobalSettings = useCallback(() => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current);
    railFlightRef.current?.cancel();
    setWorkspaceMode("settings");
    setRailPage("modes");
    setRailMotion(null);
    setSidebarOpen(false);
  }, []);

  return {
    railPage,
    workspaceMode,
    railMotion,
    sidebarOpen,
    modesPageRef,
    pageRefs,
    modeRefs,
    titleRefs,
    modeMeta,
    animateRail,
    selectMode,
    showGlobalSettings,
    openSidebar,
    closeSidebar,
  };
}

type ActiveRailFlight = {
  element: HTMLSpanElement;
  cancel: () => void;
};

type FlightState = {
  left: number;
  top: number;
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  borderRadius: number;
  gap: number;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
};

function numericStyle(value: string, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flightState(rect: DOMRect, containerStyle: CSSStyleDeclaration, labelStyle: CSSStyleDeclaration): FlightState {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    paddingLeft: numericStyle(containerStyle.paddingLeft),
    paddingRight: numericStyle(containerStyle.paddingRight),
    borderRadius: numericStyle(containerStyle.borderRadius),
    gap: numericStyle(containerStyle.columnGap),
    fontSize: numericStyle(labelStyle.fontSize),
    fontWeight: numericStyle(labelStyle.fontWeight, 400),
    lineHeight: numericStyle(labelStyle.lineHeight, numericStyle(labelStyle.fontSize) * 1.2),
  };
}

function frame(state: FlightState) {
  return {
    left: `${state.left}px`,
    top: `${state.top}px`,
    width: `${state.width}px`,
    height: `${state.height}px`,
    paddingLeft: `${state.paddingLeft}px`,
    paddingRight: `${state.paddingRight}px`,
    borderRadius: `${state.borderRadius}px`,
    gap: `${state.gap}px`,
    fontSize: `${state.fontSize}px`,
    fontWeight: `${state.fontWeight}`,
    lineHeight: `${state.lineHeight}px`,
  };
}
