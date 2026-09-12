import { ArrowLeft, Globe2, LoaderCircle, Pin, PinOff, SlidersHorizontal, Sparkles, Square, SquareTerminal } from "lucide-react";
import type { FocusEventHandler, MouseEventHandler, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Agent } from "../../types/agents";
import type { DetailMode, LaunchPathDisplay, RailMotion, RailPage, WorkspaceMode } from "../../types/app";
import type { WebAppOperation } from "../../types/web-apps";
import { Brand } from "../../shared/branding/Branding";
import { TerminalSettingsControls } from "../terminals/TerminalSettingsControls";
import type { TerminalLayoutCount, TerminalLayoutPreset } from "../terminals/terminalWorkspaceLayout";
import type { TerminalWorkspaceCapacity } from "../terminals/terminalWorkspaceDock";

type RailDetailMode = Exclude<DetailMode, "settings">;
type ModeRefs = RefObject<Record<DetailMode, HTMLButtonElement | null>>;
type PageRefs = RefObject<Record<DetailMode, HTMLElement | null>>;
type TitleRefs = RefObject<Record<DetailMode, HTMLSpanElement | null>>;

export function NavigationRail({
  railPage,
  railMotion,
  railWidthPx,
  workspaceMode,
  sessionCount,
  modesPageRef,
  modeRefs,
  pageRefs,
  titleRefs,
  onNavigate,
  terminalSettingsOpen,
  capacity,
  layoutCount,
  layoutPreset,
  pathDisplay,
  thumbnailsAutoHide,
  thumbnailSide,
  launchPathsHeight,
  workspaceHeight,
  confirmClose,
  agents,
  defaultAgentId,
  onTerminalSettingsOpenChange,
  onCapacityChange,
  onLayoutPresetChange,
  onPathDisplayChange,
  onToggleThumbnailAutoHide,
  onThumbnailSideChange,
  onLaunchPathsHeightChange,
  onWorkspaceHeightChange,
  onConfirmCloseChange,
  onDefaultAgentChange,
  terminalContent,
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
  railWidthPx: number | null;
  workspaceMode: WorkspaceMode;
  sessionCount: number;
  modesPageRef: RefObject<HTMLElement | null>;
  modeRefs: ModeRefs;
  pageRefs: PageRefs;
  titleRefs: TitleRefs;
  onNavigate: (page: RailPage, motion: Exclude<RailMotion, null>, showSettingsOnReturn?: boolean) => void;
  terminalSettingsOpen: boolean;
  capacity: TerminalWorkspaceCapacity;
  layoutCount: TerminalLayoutCount | null;
  layoutPreset: TerminalLayoutPreset | null;
  pathDisplay: LaunchPathDisplay;
  thumbnailsAutoHide: boolean;
  thumbnailSide: "left" | "right";
  launchPathsHeight: number;
  workspaceHeight: number;
  confirmClose: boolean;
  agents: Agent[];
  defaultAgentId: string | null;
  onTerminalSettingsOpenChange: (open: boolean) => void;
  onCapacityChange: (capacity: TerminalWorkspaceCapacity) => void;
  onLayoutPresetChange: (preset: TerminalLayoutPreset) => void;
  onPathDisplayChange: (mode: LaunchPathDisplay) => void;
  onToggleThumbnailAutoHide: () => void;
  onThumbnailSideChange: (side: "left" | "right") => void;
  onLaunchPathsHeightChange: (height: number) => void;
  onWorkspaceHeightChange: (height: number) => void;
  onConfirmCloseChange: (enabled: boolean) => void;
  onDefaultAgentChange: (agentId: string) => void;
  terminalContent: React.ReactNode;
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
  const settingsAvailable = railPage === "terminal" && workspaceMode === "terminal";
  return (
    <aside
      ref={railRef}
      id={railId}
      className={`rail ${railWidthPx !== null && railWidthPx >= 320 ? "rail-width-320" : ""} ${railWidthPx !== null && railWidthPx >= 340 ? "rail-width-340" : ""} ${railWidthPx !== null && railWidthPx >= 420 ? "rail-width-420" : ""} ${railWidthPx !== null && railWidthPx >= 440 ? "rail-width-440" : ""}`}
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
          aria-hidden={railPage !== "modes"}
          inert={railPage !== "modes" ? true : undefined}
        >
          <nav className="tw:flex tw:w-full tw:flex-col tw:gap-[8px] tw:pt-[12px]" aria-label="Workspace modes">
            <ModeButton mode="terminal" modeRefs={modeRefs} active={workspaceMode === "terminal"} count={sessionCount} onNavigate={onNavigate} />
            <ModeButton mode="skills" modeRefs={modeRefs} active={workspaceMode === "skills"} onNavigate={onNavigate} />
            <ModeButton mode="webapp" modeRefs={modeRefs} active={workspaceMode === "webapp"} onNavigate={onNavigate} />
          </nav>
        </section>
        <DetailPage mode="terminal" className={pageClass("terminal")} railMotion={railMotion} active={railPage === "terminal"} pageRefs={pageRefs} titleRefs={titleRefs} onNavigate={onNavigate}>
          {terminalContent}
        </DetailPage>
        <DetailPage mode="skills" className={`${pageClass("skills")} skills-rail-page`} railMotion={railMotion} active={railPage === "skills"} pageRefs={pageRefs} titleRefs={titleRefs} onNavigate={onNavigate}>
          {skillsContent}
        </DetailPage>
        <DetailPage mode="webapp" className={pageClass("webapp")} railMotion={railMotion} active={railPage === "webapp"} pageRefs={pageRefs} titleRefs={titleRefs} onNavigate={onNavigate}>
          {webAppContent}
        </DetailPage>
      </div>
      {workspaceMode === "webapp" && webAppRunning && (
        <div className="tw:flex tw:items-center tw:justify-center tw:gap-[8px] tw:border-t tw:border-border tw:pt-[10px]">
          <Button variant="outline" className="tw:h-10 tw:w-full tw:rounded-full tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" aria-label={webAppOperation === "stop" ? "Stopping web app" : "Stop web app"} disabled={webAppOperation !== null} onClick={onStopWebApp}>
            {webAppOperation === "stop" ? <LoaderCircle className="spin" /> : <Square />}
            <span>{webAppOperation === "stop" ? "Stopping…" : "Stop Web App"}</span>
          </Button>
        </div>
      )}
      <footer className={`canvas-rail-footer ${settingsAvailable ? "has-settings" : ""}`}>
        <Popover open={settingsAvailable && terminalSettingsOpen} onOpenChange={onTerminalSettingsOpenChange}>
          <div className="canvas-settings-slot" inert={!settingsAvailable ? true : undefined}>
            <PopoverTrigger
              disabled={!settingsAvailable}
              render={<Button variant="ghost" className="tw:h-10 tw:min-w-0 tw:w-full tw:justify-start tw:rounded-xl tw:border-0 tw:bg-transparent! tw:px-3 tw:py-2 tw:text-sm tw:font-semibold tw:text-[var(--color-text-subtle)] tw:transition-none tw:[@media(pointer:coarse)]:h-11 tw:hover:bg-transparent! tw:hover:text-[var(--color-text-subtle)]! tw:aria-expanded:bg-transparent! tw:aria-expanded:text-[var(--color-text-subtle)]! tw:data-popup-open:bg-transparent! tw:data-popup-open:text-[var(--color-text-subtle)]!" type="button" aria-hidden={!settingsAvailable} tabIndex={settingsAvailable ? undefined : -1} />}
            >
              <SlidersHorizontal className="tw:size-[19px] tw:text-current" />
              <span>Workbench settings</span>
            </PopoverTrigger>
          </div>
          <PopoverContent id="canvas-terminal-settings" data-canvas-rail-popover="" side="top" align="start" sideOffset={8} initialFocus={false} className="canvas-terminal-settings tw:max-h-[var(--available-height)] tw:min-w-0 tw:w-[calc(var(--anchor-width)+48px)] tw:overflow-x-hidden tw:overflow-y-auto tw:overscroll-contain tw:rounded-xl tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:p-3 tw:shadow-[0_12px_32px_rgb(0_0_0/16%)] tw:ring-0 tw:backdrop-blur-xl tw:[@media(pointer:coarse)]:w-[calc(var(--anchor-width)+52px)]" aria-label="Workbench settings">
            <TerminalSettingsControls
              capacity={capacity}
              layoutCount={layoutCount}
              layoutPreset={layoutPreset}
              pathDisplay={pathDisplay}
              thumbnailsAutoHide={thumbnailsAutoHide}
              thumbnailSide={thumbnailSide}
              launchPathsHeight={launchPathsHeight}
              workspaceHeight={workspaceHeight}
              confirmClose={confirmClose}
              agents={agents}
              defaultAgentId={defaultAgentId}
              onCapacityChange={onCapacityChange}
              onLayoutPresetChange={onLayoutPresetChange}
              onPathDisplayChange={onPathDisplayChange}
              onToggleThumbnailAutoHide={onToggleThumbnailAutoHide}
              onThumbnailSideChange={onThumbnailSideChange}
              onLaunchPathsHeightChange={onLaunchPathsHeightChange}
              onWorkspaceHeightChange={onWorkspaceHeightChange}
              onConfirmCloseChange={onConfirmCloseChange}
              onDefaultAgentChange={onDefaultAgentChange}
            />
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="icon" className="tw:size-10 tw:rounded-[10px] tw:bg-transparent tw:text-muted-foreground tw:transition-transform tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Auto-hide navigation" aria-pressed={!canvasPinned} title={`Auto-hide navigation: ${canvasPinned ? "off" : "on"}`} onClick={onCanvasPinnedChange}>
          {canvasPinned ? <Pin className="tw:size-4" /> : <PinOff className="tw:size-4" />}
        </Button>
      </footer>
    </aside>
  );
}

function ModeButton({ mode, modeRefs, active, count, onNavigate }: {
  mode: RailDetailMode;
  modeRefs: ModeRefs;
  active: boolean;
  count?: number;
  onNavigate: (page: RailPage, motion: "forward") => void;
}) {
  const meta = {
    terminal: { icon: SquareTerminal, label: "Workbench" },
    skills: { icon: Sparkles, label: "Skills" },
    webapp: { icon: Globe2, label: "Web Apps" },
  }[mode];
  const Icon = meta.icon;
  return (
    <Button ref={(node) => { modeRefs.current[mode] = node; }} variant="ghost" type="button" className={`nav-item tw:h-auto tw:min-h-14 tw:w-full tw:justify-start tw:gap-[12px] tw:rounded-xl tw:border-0 tw:px-3 tw:py-2 tw:text-[calc(16px*var(--app-font-scale))] tw:font-[650] tw:transition-[background-color,color,transform] ${active ? "tw:bg-foreground tw:text-[var(--color-on-solid)] tw:hover:bg-foreground! tw:hover:text-[var(--color-on-solid)]!" : "tw:text-[var(--color-text-subtle)] tw:hover:bg-[var(--color-canvas)]!"}`} aria-current={active ? "page" : undefined} onClick={() => onNavigate(mode, "forward")}>
      <Icon className="tw:size-[22px] tw:flex-none" />
      <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">{meta.label}</span>
      {count !== undefined && <b className="tw:ml-auto tw:grid tw:h-[20px] tw:min-w-[20px] tw:flex-none tw:place-items-center tw:rounded-[99px] tw:bg-[var(--color-surface)] tw:px-[6px] tw:font-mono tw:text-[calc(10px*var(--app-font-scale))] tw:font-normal tw:leading-none tw:text-[var(--color-text)]">{count}</b>}
    </Button>
  );
}

function DetailPage({ mode, className, railMotion, active, pageRefs, titleRefs, onNavigate, children }: {
  mode: RailDetailMode;
  className: string;
  railMotion: RailMotion;
  active: boolean;
  pageRefs: PageRefs;
  titleRefs: TitleRefs;
  onNavigate: (page: "modes", motion: "return", showSettingsOnReturn?: boolean) => void;
  children: React.ReactNode;
}) {
  const meta = {
    terminal: { icon: SquareTerminal, label: "Workbench" },
    skills: { icon: Sparkles, label: "Skills" },
    webapp: { icon: Globe2, label: "Web Apps" },
  }[mode];
  const Icon = meta.icon;
  return (
    <section ref={(node) => { pageRefs.current[mode] = node; }} className={className} aria-hidden={!active} inert={!active ? true : undefined}>
      <div className="rail-page-title">
        <Button variant="ghost" size="icon" className="rail-back tw:size-10 tw:flex-none tw:rounded-lg tw:text-[var(--color-text-subtle)] tw:transition-none tw:hover:bg-[var(--color-canvas)]! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Back to modes" onClick={() => onNavigate("modes", "return", true)}>
          <ArrowLeft className="tw:size-[18px]" />
        </Button>
        <span ref={(node) => { titleRefs.current[mode] = node; }} className="mode-title">
          <Icon />
          <strong>{meta.label}</strong>
        </span>
      </div>
      <div className={`rail-detail ${mode === "terminal" ? "agent-detail" : ""} ${railMotion === "forward" ? "awaiting-title" : ""}`}>
        {children}
      </div>
    </section>
  );
}
