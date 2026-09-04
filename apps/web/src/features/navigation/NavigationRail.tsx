import { ArrowLeft, Bot, Globe2, LoaderCircle, Pin, PinOff, SlidersHorizontal, Sparkles, Square, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TerminalSettingsControls } from "../terminals/TerminalSettingsControls";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../terminals/terminalWorkspaceDock";
import type { FocusEventHandler, MouseEventHandler, RefObject } from "react";
import type { Agent } from "../../types/agents";
import type { WebAppOperation } from "../../types/web-apps";
import type { DetailMode, LaunchPathDisplay, RailMotion, RailPage, WorkspaceMode } from "../../types/app";
import { Brand } from "../../shared/branding/Branding";

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
  terminalCapacity,
  terminalLayoutCount,
  terminalLayoutPreset,
  terminalPathDisplay,
  terminalThumbnailsAutoHide,
  terminalThumbnailSide,
  terminalLaunchPathsHeight,
  confirmTerminalClose,
  onTerminalSettingsOpenChange,
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
  terminalCapacity: TerminalWorkspaceCapacity;
  terminalLayoutCount: TerminalLayoutCount | null;
  terminalLayoutPreset: TerminalLayoutPreset | null;
  terminalPathDisplay: LaunchPathDisplay;
  terminalThumbnailsAutoHide: boolean;
  terminalThumbnailSide: "left" | "right";
  terminalLaunchPathsHeight: number;
  confirmTerminalClose: boolean;
  onTerminalSettingsOpenChange: (open: boolean) => void;
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
  const settingsControls = (
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
  );
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
    >
      <Brand />
      <div className="rail-pages">
        <section
          ref={modesPageRef}
          className={
            `rail-page modes-page ${railPage === "modes" ? "active" : ""} ` +
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
          <Button variant="outline" className="canvas-stop-button tw:h-10 tw:w-full tw:rounded-full tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" aria-label={webAppOperation === "stop" ? "Stopping web app" : "Stop web app"} disabled={webAppOperation !== null} onClick={onStopWebApp}>
            {webAppOperation === "stop" ? <LoaderCircle className="spin" /> : <Square />}
            <span>{webAppOperation === "stop" ? "Stopping…" : "Stop Web App"}</span>
          </Button>
        </div>
      )}
      {terminalSettingsOpen && canvasPinned && settingsAvailable && (
        <div id={`canvas-${workspaceMode}-settings`} className="canvas-terminal-settings pinned" role="group" aria-label={`${workspaceMode === "terminal" ? "Terminal" : "Agent"} settings`}>
          {settingsControls}
        </div>
      )}
      <footer className={`canvas-rail-footer ${settingsAvailable ? "has-settings" : ""}`}>
        {canvasPinned ? (
          <div className="canvas-settings-slot" inert={!settingsAvailable ? true : undefined}>
            <Button
              variant="ghost"
              className={`settings-nav-item tw:h-10 tw:w-full tw:justify-start tw:rounded-xl tw:border-0 tw:px-3 tw:py-2 tw:text-[13px] tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11 tw:hover:bg-[var(--color-surface-hover)]! tw:hover:text-foreground! ${terminalSettingsOpen ? "active tw:bg-[var(--color-canvas)]" : ""}`}
              type="button"
              aria-hidden={!settingsAvailable}
              aria-expanded={settingsAvailable ? terminalSettingsOpen : false}
              aria-controls={`canvas-${workspaceMode}-settings`}
              tabIndex={settingsAvailable ? undefined : -1}
              onClick={() => onTerminalSettingsOpenChange(!terminalSettingsOpen)}
            >
              <SlidersHorizontal className="tw:size-[19px]" />
              <span>{workspaceMode === "terminal" ? "Terminal" : "Agent"} settings</span>
            </Button>
          </div>
        ) : (
          <Popover open={settingsAvailable && terminalSettingsOpen} onOpenChange={onTerminalSettingsOpenChange}>
            <div className="canvas-settings-slot" inert={!settingsAvailable ? true : undefined}>
              <PopoverTrigger
                disabled={!settingsAvailable}
                render={
                  <Button
                    variant="ghost"
                    className="settings-nav-item tw:h-10 tw:w-full tw:justify-start tw:rounded-xl tw:border-0 tw:px-3 tw:py-2 tw:text-[13px] tw:font-semibold tw:transition-none tw:[@media(pointer:coarse)]:h-11 tw:hover:bg-[var(--color-surface-hover)]! tw:hover:text-foreground! tw:data-popup-open:bg-[var(--color-canvas)]!"
                    type="button"
                    aria-hidden={!settingsAvailable}
                    tabIndex={settingsAvailable ? undefined : -1}
                  />
                }
              >
                <SlidersHorizontal className="tw:size-[19px]" />
                <span>{workspaceMode === "terminal" ? "Terminal" : "Agent"} settings</span>
              </PopoverTrigger>
            </div>
            <PopoverContent
              id={`canvas-${workspaceMode}-settings`}
              data-canvas-rail-popover=""
              side="top"
              align="start"
              sideOffset={8}
              initialFocus={false}
              className="canvas-terminal-settings tw:max-h-[var(--available-height)] tw:w-[calc(var(--anchor-width)+48px)] tw:overflow-y-auto tw:overscroll-contain tw:rounded-xl tw:border tw:border-border tw:bg-[var(--color-surface)] tw:p-3 tw:shadow-[0_12px_32px_rgb(0_0_0/16%)] tw:ring-0 tw:[@media(pointer:coarse)]:w-[calc(var(--anchor-width)+52px)]"
              aria-label={`${workspaceMode === "terminal" ? "Terminal" : "Agent"} settings`}
            >
              {settingsControls}
            </PopoverContent>
          </Popover>
        )}
        <Button
          variant="outline"
          size="icon"
          className="canvas-auto-hide tw:size-10 tw:rounded-[10px] tw:bg-transparent tw:text-muted-foreground tw:transition-transform tw:[@media(pointer:coarse)]:size-11"
          type="button"
          aria-label="Auto-hide navigation"
          aria-pressed={!canvasPinned}
          title={`Auto-hide navigation: ${canvasPinned ? "off" : "on"}`}
          onClick={onCanvasPinnedChange}
        >
          {canvasPinned ? <Pin className="tw:size-4" /> : <PinOff className="tw:size-4" />}
          <span className="sr-only">Auto-hide navigation</span>
        </Button>
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
    <Button
      ref={(node) => {
        modeRefs.current[mode] = node;
      }}
      variant="ghost"
      type="button"
      className={`nav-item tw:h-auto tw:min-h-14 tw:w-full tw:justify-start tw:gap-3 tw:rounded-xl tw:border-0 tw:px-3 tw:py-2 tw:text-[13px] tw:font-semibold tw:transition-[background-color,color,transform] ${active ? "active tw:bg-foreground tw:text-[var(--color-on-solid)] tw:hover:bg-foreground! tw:hover:text-[var(--color-on-solid)]!" : "tw:text-[var(--color-text-subtle)] tw:hover:bg-[var(--color-canvas)]!"}`}
      aria-current={active ? "page" : undefined}
      onClick={() => onNavigate(mode, "forward")}
    >
      <Icon className="tw:size-[22px]" />
      <span>{meta.label}</span>
      {count !== undefined && <b>{count}</b>}
    </Button>
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
        <Button variant="ghost" size="icon" className="rail-back tw:size-10 tw:flex-none tw:rounded-lg tw:text-[var(--color-text-subtle)] tw:transition-none tw:hover:bg-[var(--color-canvas)]! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Back to modes" onClick={() => onNavigate("modes", "return", true)}>
          <ArrowLeft className="tw:size-[18px]" />
        </Button>
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
