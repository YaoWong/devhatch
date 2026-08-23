import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Globe2, Settings, SquareTerminal } from "lucide-react";
import type { DetailMode, RailMotion, RailPage, WorkspaceMode } from "../types";

export function useNavigation(bumpFocus: () => void) {
  const [railPage, setRailPage] = useState<RailPage>("modes");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("terminal");
  const [railMotion, setRailMotion] = useState<RailMotion>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem("devhatch-sidebar-hidden") === "1");
  const motionTimer = useRef<number | null>(null);
  const modesPageRef = useRef<HTMLElement | null>(null);
  const pageRefs = useRef<Record<DetailMode, HTMLElement | null>>({
    terminal: null,
    agent: null,
    webapp: null,
    settings: null,
  });
  const modeRefs = useRef<Record<DetailMode, HTMLButtonElement | null>>({
    terminal: null,
    agent: null,
    webapp: null,
    settings: null,
  });
  const titleRefs = useRef<Record<DetailMode, HTMLSpanElement | null>>({
    terminal: null,
    agent: null,
    webapp: null,
    settings: null,
  });
  const modeMeta = useMemo(
    () => ({
      terminal: { label: "Terminal", icon: SquareTerminal },
      agent: { label: "Agent CLI", icon: Bot },
      webapp: { label: "Web Apps", icon: Globe2 },
      settings: { label: "Settings", icon: Settings },
    }),
    [],
  );

  const animateRail = useCallback(
    (page: RailPage, motion: Exclude<RailMotion, null>) => {
      const detailMode: DetailMode = page === "modes" ? (railPage === "modes" ? workspaceMode : railPage) : page;
      const source = modeRefs.current[detailMode];
      const detail = titleRefs.current[detailMode];
      const modesPage = modesPageRef.current;
      const targetPage = pageRefs.current[detailMode];
      if (!source || !detail || !modesPage || !targetPage) return;
      if (motionTimer.current) window.clearTimeout(motionTimer.current);
      const measuring = motion === "forward" ? targetPage : modesPage;
      measuring.classList.add("is-measuring");
      const sourceRect = source.getBoundingClientRect();
      const detailRect = detail.getBoundingClientRect();
      measuring.classList.remove("is-measuring");
      const sourceStyle = getComputedStyle(source);
      const sourceState = {
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
        paddingLeft: Number.parseFloat(sourceStyle.paddingLeft),
        paddingRight: Number.parseFloat(sourceStyle.paddingRight),
        borderRadius: Number.parseFloat(sourceStyle.borderRadius),
      };
      const detailState = {
        left: detailRect.left,
        top: detailRect.top,
        width: detailRect.width,
        height: detailRect.height,
        paddingLeft: 0,
        paddingRight: 0,
        borderRadius: 0,
      };
      const from = motion === "return" ? detailState : sourceState;
      const to = motion === "return" ? sourceState : detailState;
      setRailMotion(motion);
      setRailPage(page);
      if (motion === "forward" && page !== "modes") {
        setWorkspaceMode(page);
        if (page === "terminal" || page === "agent") bumpFocus();
      }
      requestAnimationFrame(() => {
        const flight = document.createElement("span");
        flight.className = "shared-title-flight";
        const icon = source.querySelector("svg")?.cloneNode(true);
        if (icon) flight.appendChild(icon);
        const label = document.createElement("span");
        label.textContent = modeMeta[detailMode].label;
        flight.appendChild(label);
        Object.assign(flight.style, {
          left: `${from.left}px`,
          top: `${from.top}px`,
          width: `${from.width}px`,
          height: `${from.height}px`,
          paddingLeft: `${from.paddingLeft}px`,
          paddingRight: `${from.paddingRight}px`,
          borderRadius: `${from.borderRadius}px`,
          color: motion === "forward" ? "#fff" : "#1d1d1f",
        });
        source.classList.add("shared-title-hidden");
        detail.classList.add("shared-title-hidden");
        document.body.appendChild(flight);
        const finished =
          motion === "forward" ? animateForward(flight, sourceState, from, to) : animateReturn(flight, from, to);
        finished.finally(() => {
          flight.remove();
          source.classList.remove("shared-title-hidden");
          detail.classList.remove("shared-title-hidden");
        });
      });
      motionTimer.current = window.setTimeout(() => setRailMotion(null), motion === "forward" ? 640 : 540);
    },
    [bumpFocus, modeMeta, railPage, workspaceMode],
  );

  useEffect(
    () => () => {
      if (motionTimer.current) window.clearTimeout(motionTimer.current);
    },
    [],
  );

  const toggleSidebar = useCallback(() => {
    if (window.innerWidth <= 920) {
      setSidebarOpen((value) => !value);
      return;
    }
    setSidebarHidden((value) => {
      localStorage.setItem("devhatch-sidebar-hidden", value ? "0" : "1");
      return !value;
    });
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return {
    railPage,
    workspaceMode,
    railMotion,
    sidebarOpen,
    sidebarHidden,
    modesPageRef,
    pageRefs,
    modeRefs,
    titleRefs,
    modeMeta,
    animateRail,
    toggleSidebar,
    closeSidebar,
  };
}

type FlightState = {
  left: number;
  top: number;
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  borderRadius: number;
};

function frame(state: FlightState) {
  return {
    left: `${state.left}px`,
    top: `${state.top}px`,
    width: `${state.width}px`,
    height: `${state.height}px`,
    paddingLeft: `${state.paddingLeft}px`,
    paddingRight: `${state.paddingRight}px`,
    borderRadius: `${state.borderRadius}px`,
  };
}

function animateForward(flight: HTMLSpanElement, source: FlightState, from: FlightState, to: FlightState) {
  const backdrop = document.createElement("span");
  backdrop.className = "shared-title-backdrop";
  Object.assign(backdrop.style, {
    left: `${source.left}px`,
    top: `${source.top}px`,
    width: `${source.width}px`,
    height: `${source.height}px`,
    borderRadius: `${source.borderRadius}px`,
  });
  document.body.appendChild(backdrop);
  const phase = {
    ...from,
    left: from.left + (to.left - from.left) * 0.08,
    top: from.top + (to.top - from.top) * 0.08,
  };
  const titlePhase = flight.animate(
    [
      { left: `${from.left}px`, top: `${from.top}px`, color: "#fff" },
      { left: `${phase.left}px`, top: `${phase.top}px`, color: "#1d1d1f" },
    ],
    { duration: 240, easing: "cubic-bezier(.32, 0, .67, 0)", fill: "forwards" },
  );
  const backdropPhase = backdrop.animate(
    [
      { transform: "translate3d(0, 0, 0) scale(1)", opacity: 1 },
      {
        transform: `translate3d(${(to.left - from.left) * 0.08}px, ` + `${(to.top - from.top) * 0.08}px, 0) scale(.9)`,
        opacity: 0,
      },
    ],
    { duration: 240, easing: "cubic-bezier(.32, 0, .67, 0)", fill: "forwards" },
  );
  return Promise.all([titlePhase.finished, backdropPhase.finished]).then(() => {
    backdrop.remove();
    return flight.animate([frame(phase), frame(to)], {
      duration: 380,
      easing: "cubic-bezier(.22, 1, .36, 1)",
      fill: "forwards",
    }).finished;
  });
}

function animateReturn(flight: HTMLSpanElement, from: FlightState, to: FlightState) {
  return flight.animate(
    [
      { ...frame(from), background: "transparent" },
      { ...frame(to), background: "#1d1d1f", color: "#fff" },
    ],
    { duration: 520, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" },
  ).finished;
}
