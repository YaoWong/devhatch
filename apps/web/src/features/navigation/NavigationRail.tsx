import { ArrowLeft, Bot, Globe2, LoaderCircle, Pin, PinOff, SlidersHorizontal, Sparkles, Square, SquareTerminal } from "lucide-react";
import { TerminalSettingsControls } from "../terminals/TerminalSettingsControls";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../terminals/terminalWorkspaceDock";
import type { FocusEventHandler, MouseEventHandler, RefObject } from "react";
import type { Agent } from "../../types/agents";
import type { WebAppOperation } from "../../types/web-apps";
import type { DetailMode, LaunchPathDisplay, RailMotion, RailPage, WorkspaceMode } from "../../types/app";
import { Brand } from "../../shared/branding/Branding";
import { hasOpenCustomSelectPortalOwnedBy } from "../../shared/ui/customSelectPortal";

type RailDetailMode = Exclude<DetailMode, "settings">;
type ModeRefs = RefObject<Record<DetailMode, HTMLButtonElement | null>>;
type PageRefs = RefObject<Record<DetailMode, HTMLElement | null>>;
type TitleRefs = RefObject<Record<DetailMode, HTMLSpanElement | null>>;

export function NavigationRail({
  railPage,
  railMotion,
  workspaceMode,
  terminalCount,
  agentCount,
  modesPageRef,
  modeRefs,
  pageRefs,
  titleRefs,
  onNavigate,
  terminalSettingsOpen,
  terminalSettingsToggleRef,
  terminalSettingsPanelRef,
  terminalCapacity,
  terminalLayoutCount,
  terminalLayoutPreset,
  terminalPathDisplay,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalLaunchPathsHeight,
  confirmTerminalClose,
  onToggleTerminalSettings,
  onCloseTerminalSettings,
  onTerminalCapacityChange,
  onTerminalLayoutPresetChange,
  onTerminalPathDisplayChange,
  onToggleTerminalThumbnailAutoHide,
  onTerminalThumbnailSideChange,
  onTerminalLaunchPathsHeightChange,
  onConfirmTerminalCloseChange,
  agentCapacity,
  agentLayoutCount,
  agentLayoutPreset,
  agentPathDisplay,
  agentThumbnailsAutoHide,
  agentThumbnailSide,
  agents,
  defaultAgentId,
  onAgentCapacityChange,
  onAgentLayoutPresetChange,
  onAgentPathDisplayChange,
  onToggleAgentThumbnailAutoHide,
  onAgentThumbnailSideChange,
  onDefaultAgentChange,
  terminalContent,
  agentContent,
  skillsContent,
  webAppContent,
  canvasPinned,
  railInteractive,
  railId,
  railRef,
  webAppRunning,
  webAppOperation,
  onCanvasPinnedChange,
  onCanvasEnter,
  onCanvasLeave,
  onCanvasFocus,
  onCanvasBlur,
  onStopWebApp,
}: {
  railPage: RailPage;
  railMotion: RailMotion;
  workspaceMode: WorkspaceMode;
  terminalCount: number;
  agentCount: number;
  modesPageRef: RefObject<HTMLElement | null>;
  modeRefs: ModeRefs;
  pageRefs: PageRefs;
  titleRefs: TitleRefs;
  onNavigate: (page: RailPage, motion: Exclude<RailMotion, null>, showSettingsOnReturn?: boolean) => void;
  terminalSettingsOpen: boolean;
  terminalSettingsToggleRef: RefObject<HTMLButtonElement | null>;
  terminalSettingsPanelRef: RefObject<HTMLDivElement | null>;
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalLayoutCount: TerminalLayoutCount | null;
  terminalLayoutPreset: TerminalLayoutPreset | null;
  terminalPathDisplay: LaunchPathDisplay;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalLaunchPathsHeight: number;
  confirmTerminalClose: boolean;
  onToggleTerminalSettings: () => void;
  onCloseTerminalSettings: () => void;
  onTerminalCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onTerminalLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onTerminalPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleTerminalThumbnailAutoHide: () => void;
  onTerminalThumbnailSideChange: (side: "left" | "right") => void;
  onTerminalLaunchPathsHeightChange: (height: number) => void;
  onConfirmTerminalCloseChange: (enabled: boolean) => void;
  agentCapacity: TerminalWorkspaceCapacity;
  agentLayoutCount: TerminalLayoutCount | null;
  agentLayoutPreset: TerminalLayoutPreset | null;
  agentPathDisplay: LaunchPathDisplay;
  agentThumbnailsAutoHide: boolean;
  agentThumbnailSide: "left" | "right";
  agents: Agent[];
  defaultAgentId: string | null;
  onAgentCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onAgentLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onAgentPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleAgentThumbnailAutoHide: () => void;
  onAgentThumbnailSideChange: (side: "left" | "right") => void;
  onDefaultAgentChange: (agentId: string) => void;
  terminalContent: React.ReactNode;
  agentContent: React.ReactNode;
  skillsContent: React.ReactNode;
  webAppContent: React.ReactNode;
  canvasPinned: boolean;
  railInteractive: boolean;
  railId: string;
  railRef: RefObject<HTMLElement | null>;
  webAppRunning: boolean;
  webAppOperation: WebAppOperation | null;
  onCanvasPinnedChange: () => void;
  onCanvasEnter: MouseEventHandler<HTMLElement>;
  onCanvasLeave: MouseEventHandler<HTMLElement>;
  onCanvasFocus: FocusEventHandler<HTMLElement>;
  onCanvasBlur: FocusEventHandler<HTMLElement>;
  onStopWebApp: () => void;
}) {
  const pageClass = (page: RailDetailMode) =>
    `rail-page ${railPage === page ? "active" : ""} ` +
    `${railMotion === "forward" ? "forward-enter" : ""} ` +
    `${railMotion === "return" ? "return-exit" : ""}`;
  const settingsAvailable =
    (railPage === "terminal" && workspaceMode === "terminal") ||
    (railPage === "agent" && workspaceMode === "agent");
  return (
    <aside
      ref={railRef}
      id={railId}
      className="rail"
      tabIndex={-1}
      inert={!railInteractive ? true : undefined}
      onMouseEnter={onCanvasEnter}
      onMouseLeave={onCanvasLeave}
      onFocus={onCanvasFocus}
      onBlur={onCanvasBlur}
      onKeyDown={(event) => {
        if (event.key === "Escape" && terminalSettingsOpen && !hasOpenCustomSelectPortalOwnedBy(event.currentTarget)) {
          event.preventDefault();
          event.stopPropagation();
          onCloseTerminalSettings();
        }
      }}
    >
      <Brand />
      <div className="rail-pages">
        <section
          ref={modesPageRef}
          className={
            `rail-page ${railPage === "modes" ? "active" : ""} ` +
            `${railMotion === "forward" ? "forward-exit" : ""} ` +
            `${railMotion === "return" ? "return-enter" : ""}`
          }
        >
          <nav className="primary-nav" aria-label="Workspace modes">
            <ModeButton
              mode="terminal"
              modeRefs={modeRefs}
              active={workspaceMode === "terminal"}
              count={terminalCount}
              onNavigate={onNavigate}
            />
            <ModeButton
              mode="agent"
              modeRefs={modeRefs}
              active={workspaceMode === "agent"}
              count={agentCount}
              onNavigate={onNavigate}
            />
            <ModeButton
              mode="skills"
              modeRefs={modeRefs}
              active={workspaceMode === "skills"}
              onNavigate={onNavigate}
            />
            <ModeButton
              mode="webapp"
              modeRefs={modeRefs}
              active={workspaceMode === "webapp"}
              onNavigate={onNavigate}
            />
          </nav>
        </section>
        <DetailPage
          mode="terminal"
          className={pageClass("terminal")}
          railMotion={railMotion}
          pageRefs={pageRefs}
          titleRefs={titleRefs}
          onNavigate={onNavigate}
        >
          {terminalContent}
        </DetailPage>
        <DetailPage
          mode="agent"
          className={pageClass("agent")}
          railMotion={railMotion}
          pageRefs={pageRefs}
          titleRefs={titleRefs}
          onNavigate={onNavigate}
        >
          {agentContent}
        </DetailPage>
        <DetailPage
          mode="skills"
          className={pageClass("skills")}
          railMotion={railMotion}
          pageRefs={pageRefs}
          titleRefs={titleRefs}
          onNavigate={onNavigate}
        >
          {skillsContent}
        </DetailPage>
        <DetailPage
          mode="webapp"
          className={pageClass("webapp")}
          railMotion={railMotion}
          pageRefs={pageRefs}
          titleRefs={titleRefs}
          onNavigate={onNavigate}
        >
          {webAppContent}
        </DetailPage>
      </div>
      {workspaceMode === "webapp" && webAppRunning && (
        <div className="canvas-mode-actions">
          <button className="secondary-button canvas-stop-button" type="button" aria-label={webAppOperation === "stop" ? "Stopping web app" : "Stop web app"} disabled={webAppOperation !== null} onClick={onStopWebApp}>
            {webAppOperation === "stop" ? <LoaderCircle className="spin" /> : <Square />}
            <span>{webAppOperation === "stop" ? "Stopping…" : "Stop Web App"}</span>
          </button>
        </div>
      )}
      {terminalSettingsOpen && railPage === workspaceMode && (workspaceMode === "terminal" || workspaceMode === "agent") && (
        <div ref={terminalSettingsPanelRef} id={`canvas-${workspaceMode}-settings`} className={`canvas-terminal-settings ${canvasPinned ? "pinned" : ""}`} role="group" aria-label={`${workspaceMode === "terminal" ? "Terminal" : "Agent"} settings`}>
          <TerminalSettingsControls
            capacity={workspaceMode === "terminal" ? terminalCapacity : agentCapacity}
            layoutCount={workspaceMode === "terminal" ? terminalLayoutCount : agentLayoutCount}
            layoutPreset={workspaceMode === "terminal" ? terminalLayoutPreset : agentLayoutPreset}
            pathDisplay={workspaceMode === "terminal" ? terminalPathDisplay : agentPathDisplay}
            thumbnailsAutoHide={workspaceMode === "terminal" ? terminalThumbnailsAutoHide : agentThumbnailsAutoHide}
            thumbnailSide={workspaceMode === "terminal" ? terminalThumbnailSide : agentThumbnailSide}
            launchPathsHeight={terminalLaunchPathsHeight}
            confirmClose={confirmTerminalClose}
            agents={workspaceMode === "agent" ? agents : undefined}
            defaultAgentId={defaultAgentId}
            showLaunchPathsHeight={workspaceMode === "agent"}
            onCapacityChange={workspaceMode === "terminal" ? onTerminalCapacityChange : onAgentCapacityChange}
            onLayoutPresetChange={workspaceMode === "terminal" ? onTerminalLayoutPresetChange : onAgentLayoutPresetChange}
            onPathDisplayChange={workspaceMode === "terminal" ? onTerminalPathDisplayChange : onAgentPathDisplayChange}
            onToggleThumbnailAutoHide={workspaceMode === "terminal" ? onToggleTerminalThumbnailAutoHide : onToggleAgentThumbnailAutoHide}
            onThumbnailSideChange={workspaceMode === "terminal" ? onTerminalThumbnailSideChange : onAgentThumbnailSideChange}
            onLaunchPathsHeightChange={onTerminalLaunchPathsHeightChange}
            onConfirmCloseChange={onConfirmTerminalCloseChange}
            onDefaultAgentChange={workspaceMode === "agent" ? onDefaultAgentChange : undefined}
          />
        </div>
      )}
      <footer className={`canvas-rail-footer ${settingsAvailable ? "has-settings" : ""}`}>
        <div className="canvas-settings-slot" inert={!settingsAvailable ? true : undefined}>
          <button
            ref={terminalSettingsToggleRef}
            className={`settings-nav-item ${terminalSettingsOpen ? "active" : ""}`}
            type="button"
            aria-hidden={!settingsAvailable}
            aria-expanded={settingsAvailable ? terminalSettingsOpen : false}
            aria-controls={`canvas-${workspaceMode}-settings`}
            tabIndex={settingsAvailable ? undefined : -1}
            onClick={onToggleTerminalSettings}
          >
            <SlidersHorizontal />
            <span>{workspaceMode === "terminal" ? "Terminal" : "Agent"} settings</span>
          </button>
        </div>
        <button
          className="canvas-auto-hide"
          type="button"
          aria-label="Auto-hide navigation"
          aria-pressed={!canvasPinned}
          title={`Auto-hide navigation: ${canvasPinned ? "off" : "on"}`}
          onClick={onCanvasPinnedChange}
        >
          {canvasPinned ? <Pin /> : <PinOff />}
          <span className="sr-only">Auto-hide navigation</span>
        </button>
      </footer>
    </aside>
  );
}

function ModeButton({
  mode,
  modeRefs,
  active,
  count,
  onNavigate,
}: {
  mode: RailDetailMode;
  modeRefs: ModeRefs;
  active: boolean;
  count?: number;
  onNavigate: (page: RailPage, motion: "forward") => void;
}) {
  const meta = {
    terminal: { icon: SquareTerminal, label: "Terminal" },
    agent: { icon: Bot, label: "Agent CLI" },
    skills: { icon: Sparkles, label: "Skills" },
    webapp: { icon: Globe2, label: "Web Apps" },
  }[mode];
  const Icon = meta.icon;
  return (
    <button
      ref={(node) => {
        modeRefs.current[mode] = node;
      }}
      className={`nav-item ${active ? "active" : ""}`}
      onClick={() => onNavigate(mode, "forward")}
    >
      <Icon />
      <span>{meta.label}</span>
      {count !== undefined && <b>{count}</b>}
    </button>
  );
}

function DetailPage({
  mode,
  className,
  railMotion,
  pageRefs,
  titleRefs,
  onNavigate,
  children,
}: {
  mode: RailDetailMode;
  className: string;
  railMotion: RailMotion;
  pageRefs: PageRefs;
  titleRefs: TitleRefs;
  onNavigate: (page: "modes", motion: "return", showSettingsOnReturn?: boolean) => void;
  children: React.ReactNode;
}) {
  const meta = {
    terminal: { icon: SquareTerminal, label: "Terminal" },
    agent: { icon: Bot, label: "Agent CLI" },
    skills: { icon: Sparkles, label: "Skills" },
    webapp: { icon: Globe2, label: "Web Apps" },
  }[mode];
  const Icon = meta.icon;
  return (
    <section
      ref={(node) => {
        pageRefs.current[mode] = node;
      }}
      className={className}
    >
      <div className="rail-page-title">
        <button className="rail-back" aria-label="Back to modes" onClick={() => onNavigate("modes", "return", true)}>
          <ArrowLeft />
        </button>
        <span
          ref={(node) => {
            titleRefs.current[mode] = node;
          }}
          className="mode-title"
        >
          <Icon />
          <strong>{meta.label}</strong>
        </span>
      </div>
      <div
        className={
          `rail-detail ${mode === "agent" ? "agent-detail" : ""} ` +
          `${railMotion === "forward" ? "awaiting-title" : ""}`
        }
      >
        {children}
      </div>
    </section>
  );
}
