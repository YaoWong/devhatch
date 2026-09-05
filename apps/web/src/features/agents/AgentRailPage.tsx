import { ChevronDown, ChevronRight, Code2, Layers3 } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "../../shared/branding/Branding";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { LiveRegion } from "../../shared/ui/LiveRegion";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type {
  Agent,
  AgentLaunchConfig,
  AgentLaunchConfigInput,
  AgentLaunchPath,
  AgentSession,
  AgentWorkspace,
} from "../../types/agents";
import type { ConfirmAction, LaunchPathDisplay } from "../../types/app";
import type { SkillProfile } from "../../types/skills";
import { AgentConfigDialog } from "./AgentConfigDialog";
import { LaunchPaths } from "./LaunchPaths";
import { AgentSessionList } from "./AgentSessionList";
import { AgentWorkspaceList } from "./AgentWorkspaceList";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRows = Parameters<typeof AgentSessionList>[0]["rows"];

export function AgentRailPage({
  busy,
  launching,
  agents,
  workspaces,
  selectedWorkspaceId,
  selectedAgentId,
  selectedAgent,
  agentName,
  configs,
  selectedConfigId,
  profiles,
  selectedProfileId,
  paths,
  selectedPathId,
  includeSubdirectories,
  activeSession,
  sessions,
  historyCount,
  supportsHistory,
  historyAvailable,
  historyDiagnostic,
  historyLoading,
  historySettled,
  historyLoadError,
  rows,
  search,
  homePaths,
  pathDisplay,
  onSelectAgent,
  onSelectWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onCreateWorkspace,
  onSelectConfig,
  onSelectProfile,
  onCreateConfig,
  onUpdateConfig,
  onDeleteConfig,
  onChoosePath,
  onSelectPath,
  onIncludeSubdirectoriesChange,
  onLaunch,
  onPinPath,
  onRenamePath,
  onDeletePath,
  onSearch,
  onActivateSession,
  onResume,
  onDeleteLive,
  onConfirm,
  onDeleteHistory,
  onRetryHistory,
}: {
  busy: boolean;
  launching: boolean;
  agents: Agent[];
  workspaces: AgentWorkspace[];
  selectedWorkspaceId: string | null;
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  agentName: string;
  configs: AgentLaunchConfig[];
  selectedConfigId: string | null;
  profiles: SkillProfile[];
  selectedProfileId: string | null;
  paths: AgentLaunchPath[];
  selectedPathId: string | null;
  includeSubdirectories: boolean;
  activeSession: AgentSession | null;
  sessions: AgentSession[];
  historyCount: number;
  supportsHistory: boolean;
  historyAvailable: boolean;
  historyDiagnostic: string | null;
  historyLoading: boolean;
  historySettled: boolean;
  historyLoadError: string | null;
  rows: SessionRows;
  search: string;
  homePaths: HomePaths;
  pathDisplay: LaunchPathDisplay;
  onSelectAgent: (id: string) => void;
  onSelectWorkspace: (id: string) => void;
  onRenameWorkspace: (workspace: AgentWorkspace, name: string) => Promise<boolean>;
  onDeleteWorkspace: (workspace: AgentWorkspace) => Promise<boolean>;
  onCreateWorkspace: () => void;
  onSelectConfig: (id: string) => void;
  onSelectProfile: (id: string | null) => void;
  onCreateConfig: (input: AgentLaunchConfigInput) => Promise<boolean>;
  onUpdateConfig: (id: string, input: AgentLaunchConfigInput) => Promise<boolean>;
  onDeleteConfig: (id: string) => Promise<boolean>;
  onChoosePath: () => void;
  onSelectPath: (id: string) => void;
  onIncludeSubdirectoriesChange: (enabled: boolean) => void;
  onLaunch: (path: AgentLaunchPath) => void;
  onPinPath: (path: AgentLaunchPath) => Promise<void>;
  onRenamePath: (path: AgentLaunchPath, alias: string) => Promise<boolean>;
  onDeletePath: (path: AgentLaunchPath) => Promise<void>;
  onSearch: (value: string) => void;
  onActivateSession: (id: string) => void;
  onResume: (id: string) => Promise<boolean>;
  onDeleteLive: (session: AgentSession) => void;
  onConfirm: (action: ConfirmAction) => void;
  onDeleteHistory: (id: string) => Promise<void>;
  onRetryHistory: () => Promise<void>;
}) {
  const [page, setPage] = useState(1);
  const [renamePath, setRenamePath] = useState<AgentLaunchPath | null>(null);
  const [renameWorkspace, setRenameWorkspace] = useState<AgentWorkspace | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const showAgentLoading = useDelayedLoading(busy);
  const agentAnnouncement = showAgentLoading
    ? "Loading agents…"
    : busy
      ? ""
      : "Agents loaded.";
  const launchSetupStorageKey = selectedAgentId
    ? `devhatch-agent-launch-setup-collapsed:${selectedAgentId}`
    : null;
  const [launchSetupCollapsed, setLaunchSetupCollapsed] = useState(() =>
    launchSetupStorageKey ? localStorage.getItem(launchSetupStorageKey) === "true" : false,
  );
  useLayoutEffect(() => {
    setLaunchSetupCollapsed(
      launchSetupStorageKey ? localStorage.getItem(launchSetupStorageKey) === "true" : false,
    );
  }, [launchSetupStorageKey]);
  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
  const pageCount = Math.max(1, Math.ceil(paths.length / 10));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  const deletePath = (path: AgentLaunchPath) =>
    onConfirm({
      title: "Delete launch path?",
      description: `${path.path} will be removed from the Agent CLI library.`,
      confirmLabel: "Delete path",
      danger: true,
      action: () => onDeletePath(path),
    });

  return (
    <div className="agent-rail-layout">
      <LiveRegion>{agentAnnouncement}</LiveRegion>
      {configOpen && (
        <AgentConfigDialog
          key={selectedAgent?.id}
          configs={configs}
          agentId={selectedAgent?.id ?? ""}
          agentName={selectedAgent?.name ?? "Agent CLI"}
          selectedConfigId={selectedConfigId}
          onSelect={onSelectConfig}
          onCreate={onCreateConfig}
          onUpdate={onUpdateConfig}
          onDelete={onDeleteConfig}
          onConfirm={onConfirm}
          onClose={() => setConfigOpen(false)}
        />
      )}
      <AgentWorkspaceList
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        launching={launching}
        renamingId={renameWorkspace?.id ?? null}
        onSelect={onSelectWorkspace}
        onRename={setRenameWorkspace}
        onRenameSubmit={onRenameWorkspace}
        onRenameCancel={() => setRenameWorkspace(null)}
        onDelete={onDeleteWorkspace}
        onCreate={onCreateWorkspace}
        onConfirm={onConfirm}
      />
      <div className="menu-section">
        <p className="menu-label">Agent CLI</p>
        {busy ? (
          showAgentLoading ? <div className="quiet-message">Loading agents…</div> : null
        ) : agents.length ? (
          <>
            <CustomSelect
              density="spacious"
              label="Select Agent CLI"
              value={selectedAgentId}
              options={agents}
              getOptionLabel={(agent) => agent.name}
              isOptionDisabled={(agent) => !agent.enabled || agent.availability === "coming-soon"}
              onChange={onSelectAgent}
              renderTrigger={(agent) => <AgentOption agent={agent} fallback="Select agent" />}
              renderOption={(agent) => <AgentOption agent={agent} />}
            />
            <Card className="launch-setup tw:mt-2.5 tw:grid tw:gap-1.5 tw:overflow-visible tw:rounded-[13px] tw:border tw:border-border tw:bg-popover tw:p-2 tw:py-2 tw:text-base tw:leading-[normal] tw:ring-0">
              <Button
                variant="ghost"
                 className="tw:h-10 tw:w-full tw:justify-between tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-[3px] tw:py-0 tw:text-[10px] tw:leading-[1.2] tw:font-bold tw:tracking-[0.08em] tw:text-[var(--color-text-faint)] tw:uppercase tw:transition-none tw:hover:bg-transparent! tw:hover:text-[var(--color-text-faint)]! tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:border-transparent! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2 tw:aria-expanded:bg-transparent! tw:aria-expanded:text-[var(--color-text-faint)]! tw:dark:hover:bg-transparent! tw:[@media(pointer:coarse)]:h-11 tw:[&_svg]:size-[13px] tw:[&_svg]:transition-transform tw:[&_svg]:duration-150 tw:[&_svg]:ease-[ease] tw:aria-expanded:[&_svg]:rotate-180"
                type="button"
                aria-expanded={!launchSetupCollapsed}
                aria-controls="agent-launch-setup-body"
                onClick={() => {
                  const collapsed = !launchSetupCollapsed;
                  setLaunchSetupCollapsed(collapsed);
                  if (launchSetupStorageKey) localStorage.setItem(launchSetupStorageKey, String(collapsed));
                }}
              >
                <span>Launch setup</span>
                <ChevronDown />
              </Button>
              {!launchSetupCollapsed && (
                <div className="tw:grid tw:gap-1.5" id="agent-launch-setup-body">
                  {selectedAgent && !selectedAgent.available && (
                    <Card className="tw:mt-2 tw:grid tw:min-w-0 tw:gap-1 tw:overflow-visible tw:rounded-[9px] tw:border tw:border-destructive tw:bg-[var(--color-danger-soft)] tw:px-2.5 tw:py-[9px] tw:text-[10px] tw:leading-[1.4] tw:text-destructive tw:ring-0 tw:[overflow-wrap:anywhere] tw:[&_code]:overflow-hidden tw:[&_code]:text-ellipsis tw:[&_code]:whitespace-nowrap tw:[&_code]:rounded-[5px] tw:[&_code]:bg-[color-mix(in_srgb,var(--color-danger-soft)_70%,var(--color-surface))] tw:[&_code]:px-1.5 tw:[&_code]:py-[5px] tw:[&_code]:font-mono tw:[&_code]:text-[10px] tw:[&_code]:leading-[1.4] tw:[&_code]:text-destructive tw:[&_code]:select-all tw:[&_strong]:text-[11px]">
                      <strong>{selectedAgent.name} is not installed</strong>
                      {selectedAgent.id === "opencode" ? (
                        <>
                          <span>Install it to launch agent sessions:</span>
                          <code>curl -fsSL https://opencode.ai/install | bash</code>
                        </>
                      ) : selectedAgent.id === "pi" ? (
                        <>
                          <span>Install it to launch agent sessions:</span>
                          <code>npm install -g --ignore-scripts @earendil-works/pi-coding-agent</code>
                        </>
                      ) : (
                        <span>
                          {selectedAgent.id === "traecli"
                            ? "The traecli executable was not found on PATH. Install Trae CLI using its official distribution."
                            : (selectedAgent.diagnostic ?? `Install ${selectedAgent.name} and make sure it is available on PATH.`)}
                        </span>
                      )}
                    </Card>
                  )}
                  {selectedAgent?.supportsSkills && (
                    <CustomSelect
                      density="comfortable"
                      label="Skills"
                      value={selectedProfileId ?? "none"}
                      options={[{ id: "none", slug: "None" }, ...profiles]}
                      getOptionLabel={(profile) => profile.slug}
                      onChange={(id) => onSelectProfile(id === "none" ? null : id)}
                      renderTrigger={(profile) => (
                        <span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-[9px] tw:[&>svg]:size-[18px] tw:[&>svg]:shrink-0 tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mb-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:text-[10px] tw:[&_small]:leading-[1.2] tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-[11px] tw:[&_strong]:leading-[1.2] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap">
                          <Layers3 />
                          <span><small>Skills</small><strong>{profile?.slug ?? "None"}</strong></span>
                        </span>
                      )}
                      renderOption={(profile) => <span className="select-copy"><strong>{profile.slug}</strong><small>{profile.id === "none" ? "Launch without managed skills" : "Apply on new sessions"}</small></span>}
                    />
                  )}
                  <Button
                    variant="ghost"
                    className="tw:min-h-[46px] tw:w-full tw:justify-start tw:gap-[9px] tw:rounded-[9px] tw:border tw:border-border tw:bg-card tw:px-[9px] tw:py-[7px] tw:text-base tw:font-normal tw:leading-[normal] tw:text-foreground tw:text-left tw:transition-none tw:hover:border-input tw:hover:bg-card! tw:hover:text-foreground tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:border-border! tw:hover:focus-visible:border-input! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2 tw:dark:hover:bg-card! tw:[&>svg:first-child]:size-[18px] tw:[&>svg:first-child]:shrink-0 tw:[&>svg:last-child]:size-3 tw:[&>svg:last-child]:text-[var(--color-text-faint)] tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mb-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:text-[10px] tw:[&_small]:leading-[1.2] tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-[11px] tw:[&_strong]:leading-[1.2] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setConfigOpen(true)}
                  >
                    <Code2 />
                    <span><small>Launch script</small><strong>{selectedConfig?.name ?? "None"}</strong></span>
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </Card>
          </>
        ) : (
          <div className="quiet-message">No Agent CLI integrations found.</div>
        )}
      </div>
      <LaunchPaths
        paths={paths}
        selectedPathId={selectedPathId}
        available={Boolean(selectedAgent?.available)}
        canAdd
        launching={launching}
        homePaths={homePaths}
        pathDisplay={pathDisplay}
        page={page}
        renamingId={renamePath?.id ?? null}
        onPageChange={setPage}
        onChoose={onChoosePath}
        onSelect={(path) => onSelectPath(path.id)}
        onLaunch={onLaunch}
        onPin={(path) => void onPinPath(path)}
        onRename={setRenamePath}
        onRenameSubmit={onRenamePath}
        onRenameCancel={() => setRenamePath(null)}
        onDelete={deletePath}
      />
      <AgentSessionList
        agentName={agentName}
        rows={rows}
        sessionCount={sessions.length}
        historyCount={historyCount}
        supportsHistory={supportsHistory}
        historyAvailable={historyAvailable}
        historyDiagnostic={historyDiagnostic}
        historyLoading={historyLoading}
        historySettled={historySettled}
        historyLoadError={historyLoadError}
        launching={launching}
        activeId={activeSession?.id ?? null}
        search={search}
        selectedPath={paths.find((path) => path.id === selectedPathId) ?? null}
        includeSubdirectories={includeSubdirectories}
        homePaths={homePaths}
        onSearch={onSearch}
        onIncludeSubdirectoriesChange={onIncludeSubdirectoriesChange}
        onActivate={onActivateSession}
        onResume={onResume}
        onDeleteLive={onDeleteLive}
        onConfirm={onConfirm}
        onDeleteHistory={onDeleteHistory}
        onRetryHistory={onRetryHistory}
      />
    </div>
  );
}

function AgentOption({ agent, fallback }: { agent?: Agent; fallback?: string }) {
  const descriptions: Record<string, string> = {
    codex: "OpenAI coding agent",
    opencode: "Agentic coding CLI",
    pi: "Minimal coding agent CLI",
    traecli: "Trae coding agent CLI",
  };
  const detail =
    agent?.availability === "coming-soon"
      ? "Coming soon"
      : agent?.available
        ? agent.version
          ? `v${agent.version}`
          : "Installed"
        : "Not installed";
  return (
    <>
      <span className="agent-brand">
        <AgentIcon id={agent?.id} className="agent-option-icon" />
      </span>
      <span className="select-copy">
        <strong>{agent?.name ?? fallback}</strong>
        <small>
          {agent ? (descriptions[agent.id] ?? "Agent CLI integration") : fallback} · {detail}
        </small>
      </span>
    </>
  );
}
