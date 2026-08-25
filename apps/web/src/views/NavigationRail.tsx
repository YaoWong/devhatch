import { ArrowLeft, Bot, Globe2, Settings, Sparkles, SquareTerminal } from "lucide-react";
import type { RefObject } from "react";
import type { DetailMode, RailMotion, RailPage, WorkspaceMode } from "../types";
import { Brand } from "../Branding";

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
  terminalContent,
  agentContent,
  skillsContent,
  webAppContent,
  settingsContent,
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
  onNavigate: (page: RailPage, motion: Exclude<RailMotion, null>) => void;
  terminalContent: React.ReactNode;
  agentContent: React.ReactNode;
  skillsContent: React.ReactNode;
  webAppContent: React.ReactNode;
  settingsContent: React.ReactNode;
}) {
  const pageClass = (page: DetailMode) =>
    `rail-page ${railPage === page ? "active" : ""} ` +
    `${railMotion === "forward" ? "forward-enter" : ""} ` +
    `${railMotion === "return" ? "return-exit" : ""}`;
  return (
    <aside className="rail">
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
            <ModeButton
              mode="settings"
              modeRefs={modeRefs}
              active={workspaceMode === "settings"}
              onNavigate={onNavigate}
            />
          </nav>
          <div className="mode-footer">⌘ 1–5</div>
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
        <DetailPage
          mode="settings"
          className={pageClass("settings")}
          railMotion={railMotion}
          pageRefs={pageRefs}
          titleRefs={titleRefs}
          onNavigate={onNavigate}
        >
          {settingsContent}
        </DetailPage>
      </div>
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
  mode: DetailMode;
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
    settings: { icon: Settings, label: "Settings" },
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
  mode: DetailMode;
  className: string;
  railMotion: RailMotion;
  pageRefs: PageRefs;
  titleRefs: TitleRefs;
  onNavigate: (page: "modes", motion: "return") => void;
  children: React.ReactNode;
}) {
  const meta = {
    terminal: { icon: SquareTerminal, label: "Terminal" },
    agent: { icon: Bot, label: "Agent CLI" },
    skills: { icon: Sparkles, label: "Skills" },
    webapp: { icon: Globe2, label: "Web Apps" },
    settings: { icon: Settings, label: "Settings" },
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
        <button className="rail-back" aria-label="Back to modes" onClick={() => onNavigate("modes", "return")}>
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
