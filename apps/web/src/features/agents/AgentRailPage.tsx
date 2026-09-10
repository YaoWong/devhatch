import { ChevronDown, ChevronRight, Code2, Layers3, LoaderCircle, Play } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "../../shared/branding/Branding";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { LiveRegion } from "../../shared/ui/LiveRegion";
import { RailQuietMessage, railMenuLabelClass, railMenuSectionClass, selectCopyClass } from "../../shared/ui/railStyles";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type {
  Agent,
  AgentLaunchConfig,
  AgentLaunchConfigInput,
  AgentSession,
} from "../../types/agents";
import type { ConfirmAction } from "../../types/app";
import type { LaunchPath } from "../../types/workspaces";
import type { SkillProfile } from "../../types/skills";
import { AgentConfigDialog } from "./AgentConfigDialog";
import { AgentSessionList } from "./AgentSessionList";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRows = Parameters<typeof AgentSessionList>[0]["rows"];

function readLaunchSetupCollapsed(key: string | null) {
  if (!key) return false;
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeLaunchSetupCollapsed(key: string | null, collapsed: boolean) {
  if (!key) return;
  try {
    localStorage.setItem(key, String(collapsed));
  } catch {
    return;
  }
}

export function AgentRailPage({
  busy,
  launching,
  agents,
  selectedAgentId,
  selectedAgent,
  agentName,
  configs,
  selectedConfigId,
  profiles,
  selectedProfileId,
  paths,
  selectedPathId,
  installState,
  activeInstallAgent,
  installAnnouncement,
  installBusy,
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
  onSelectAgent,
  onSelectConfig,
  onSelectProfile,
  onCreateConfig,
  onUpdateConfig,
  onDeleteConfig,
  onInstallAgent,
  onIncludeSubdirectoriesChange,
  onLaunch,
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
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  agentName: string;
  configs: AgentLaunchConfig[];
  selectedConfigId: string | null;
  profiles: SkillProfile[];
  selectedProfileId: string | null;
  paths: LaunchPath[];
  selectedPathId: string | null;
  installState?: { installing: boolean; installed: boolean; error: string | null };
  activeInstallAgent: Agent | null;
  installAnnouncement: string;
  installBusy: boolean;
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
  onSelectAgent: (id: string) => void;
  onSelectConfig: (id: string) => void;
  onSelectProfile: (id: string | null) => void;
  onCreateConfig: (input: AgentLaunchConfigInput) => Promise<boolean>;
  onUpdateConfig: (id: string, input: AgentLaunchConfigInput) => Promise<boolean>;
  onDeleteConfig: (id: string) => Promise<boolean>;
  onInstallAgent: (id: string) => Promise<boolean>;
  onIncludeSubdirectoriesChange: (enabled: boolean) => void;
  onLaunch: () => void;
  onSearch: (value: string) => void;
  onActivateSession: (id: string) => void;
  onResume: (id: string) => Promise<boolean>;
  onDeleteLive: (session: AgentSession) => void;
  onConfirm: (action: ConfirmAction) => void;
  onDeleteHistory: (id: string) => Promise<void>;
  onRetryHistory: () => Promise<void>;
}) {
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
    readLaunchSetupCollapsed(launchSetupStorageKey),
  );
  useLayoutEffect(() => {
    setLaunchSetupCollapsed(readLaunchSetupCollapsed(launchSetupStorageKey));
  }, [launchSetupStorageKey]);
  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
  const selectedPath = paths.find((path) => path.id === selectedPathId) ?? null;

  return (
    <div className="agent-rail-layout">
      <LiveRegion>{agentAnnouncement}</LiveRegion>
      <LiveRegion>{installAnnouncement}</LiveRegion>
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
      <div className={`${railMenuSectionClass} agent-launch-section`}>
        <p className={railMenuLabelClass}>Agent CLI</p>
        {busy ? (
          showAgentLoading ? <RailQuietMessage>Loading agents…</RailQuietMessage> : null
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
            {selectedAgent && !selectedAgent.available && (
              <AgentInstallNotice
                agent={selectedAgent}
                state={installState}
                activeInstallAgent={activeInstallAgent}
                installBusy={installBusy}
                onInstall={() => void onInstallAgent(selectedAgent.id)}
              />
            )}
            <Card className={`tw:mt-1.5 tw:grid tw:w-full tw:overflow-visible tw:rounded-[13px] tw:border tw:border-border tw:bg-popover tw:px-0.5 tw:py-0 tw:text-base tw:leading-[normal] tw:ring-0 ${launchSetupCollapsed ? "tw:gap-0" : "tw:gap-0.5"}`}>
              <Button
                variant="ghost"
                className="tw:h-10 tw:w-full tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-1.5 tw:py-0 tw:text-xs tw:leading-[1.2] tw:font-bold tw:tracking-[0.06em] tw:text-[var(--color-text-faint)] tw:uppercase tw:transition-none tw:hover:bg-transparent! tw:hover:text-[var(--color-text-faint)]! tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:border-transparent! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2 tw:aria-expanded:bg-transparent! tw:aria-expanded:text-[var(--color-text-faint)]! tw:dark:hover:bg-transparent! tw:[@media(pointer:coarse)]:h-11 tw:[&_svg]:size-[13px] tw:[&_svg]:transition-transform tw:[&_svg]:duration-150 tw:[&_svg]:ease-[ease] tw:aria-expanded:[&_svg]:rotate-180"
                type="button"
                aria-expanded={!launchSetupCollapsed}
                aria-controls="agent-launch-setup-body"
                onClick={() => {
                  const collapsed = !launchSetupCollapsed;
                  setLaunchSetupCollapsed(collapsed);
                  writeLaunchSetupCollapsed(launchSetupStorageKey, collapsed);
                }}
              >
                <span className="tw:flex tw:w-full tw:items-center tw:justify-between tw:px-0.5">
                  <span>Launch setup</span>
                  <ChevronDown />
                </span>
              </Button>
              {!launchSetupCollapsed && (
                <div className="tw:grid tw:gap-0.5" id="agent-launch-setup-body">
                  {selectedAgent?.supportsSkills && (
                    <CustomSelect
                      density="comfortable"
                      label="Skills"
                      value={selectedProfileId ?? "none"}
                      options={[{ id: "none", slug: "None" }, ...profiles]}
                      getOptionLabel={(profile) => profile.slug}
                      onChange={(id) => onSelectProfile(id === "none" ? null : id)}
                      renderTrigger={(profile) => (
                        <span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-[9px] tw:[&>svg]:size-[18px] tw:[&>svg]:shrink-0 tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mb-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:text-[calc(10px*var(--app-font-scale))] tw:[&_small]:leading-[1.2] tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:leading-[1.2] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap">
                          <Layers3 />
                          <span><small>Skills</small><strong>{profile?.slug ?? "None"}</strong></span>
                        </span>
                      )}
                      renderOption={(profile) => <span className={selectCopyClass}><strong>{profile.slug}</strong><small>{profile.id === "none" ? "Launch without managed skills" : "Apply on new sessions"}</small></span>}
                    />
                  )}
                  <Button
                    variant="ghost"
                    className="tw:h-auto tw:min-h-[46px] tw:w-full tw:justify-start tw:gap-[9px] tw:rounded-[9px] tw:border tw:border-border tw:bg-card tw:px-[9px] tw:py-[7px] tw:text-base tw:font-normal tw:leading-[normal] tw:text-foreground tw:text-left tw:transition-none tw:hover:border-input tw:hover:bg-card! tw:hover:text-foreground tw:active:not-aria-[haspopup]:translate-y-0! tw:focus-visible:border-border! tw:hover:focus-visible:border-input! tw:focus-visible:ring-0! tw:focus-visible:[outline:3px_solid_color-mix(in_srgb,var(--color-accent)_30%,transparent)] tw:focus-visible:outline-offset-2 tw:dark:hover:bg-card! tw:[&>svg:first-child]:size-[18px] tw:[&>svg:first-child]:shrink-0 tw:[&>svg:last-child]:size-3 tw:[&>svg:last-child]:text-[var(--color-text-faint)] tw:[&>span]:min-w-0 tw:[&>span]:flex-1 tw:[&_small]:mb-0.5 tw:[&_small]:block tw:[&_small]:overflow-hidden tw:[&_small]:text-[calc(10px*var(--app-font-scale))] tw:[&_small]:leading-[1.2] tw:[&_small]:text-[var(--color-text-faint)] tw:[&_small]:text-ellipsis tw:[&_small]:whitespace-nowrap tw:[&_strong]:block tw:[&_strong]:overflow-hidden tw:[&_strong]:text-sm tw:[&_strong]:leading-[1.2] tw:[&_strong]:text-ellipsis tw:[&_strong]:whitespace-nowrap"
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => setConfigOpen(true)}
                  >
                    <Code2 />
                    <span><small>Launch script</small><strong>{selectedConfig?.name ?? "None"}</strong></span>
                    <ChevronRight />
                  </Button>
                  <Button
                    className="tw:mt-1 tw:w-full"
                    type="button"
                    disabled={!selectedAgent?.available || !selectedPath || launching}
                    title={selectedPath ? `Launch in ${selectedPath.path}` : "Select a shared Launch Path first"}
                    onClick={onLaunch}
                  >
                    <Play />
                    {launching ? "Launching…" : `Launch ${selectedAgent?.name ?? "Agent"}`}
                  </Button>
                  {!selectedPath && (
                    <p className="tw:m-0 tw:px-1 tw:pb-1 tw:text-[calc(10px*var(--app-font-scale))] tw:leading-[1.4] tw:text-muted-foreground">
                      Select a shared Launch Path to start this agent.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </>
        ) : (
          <RailQuietMessage>No Agent CLI integrations found.</RailQuietMessage>
        )}
      </div>
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

function AgentInstallNotice({
  agent,
  state,
  activeInstallAgent,
  installBusy,
  onInstall,
}: {
  agent: Agent;
  state?: { installing: boolean; installed: boolean; error: string | null };
  activeInstallAgent: Agent | null;
  installBusy: boolean;
  onInstall: () => void;
}) {
  const commands: Record<string, string> = {
    codex: "npm install -g --ignore-scripts @openai/codex",
    opencode: "curl -fsSL https://opencode.ai/install | bash",
    pi: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
  };
  const command = commands[agent.id];
  return (
    <Card
      className="tw:mt-1.5 tw:grid tw:min-w-0 tw:gap-2 tw:overflow-visible tw:rounded-[9px] tw:border tw:border-destructive tw:bg-[var(--color-danger-soft)] tw:px-2.5 tw:py-[9px] tw:text-[calc(10px*var(--app-font-scale))] tw:leading-[1.4] tw:text-destructive tw:ring-0 tw:[overflow-wrap:anywhere] tw:[&_code]:overflow-hidden tw:[&_code]:text-ellipsis tw:[&_code]:whitespace-nowrap tw:[&_code]:rounded-[5px] tw:[&_code]:bg-[color-mix(in_srgb,var(--color-danger-soft)_70%,var(--color-surface))] tw:[&_code]:px-1.5 tw:[&_code]:py-[5px] tw:[&_code]:font-mono tw:[&_code]:text-[calc(10px*var(--app-font-scale))] tw:[&_code]:leading-[1.4] tw:[&_code]:text-destructive tw:[&_code]:select-all tw:[&_strong]:text-sm"
      aria-busy={installBusy || undefined}
    >
      <strong>{agent.name} is not installed</strong>
      {agent.installable ? (
        <>
          <span>Install a managed copy to launch agent sessions.</span>
          <Button
            type="button"
            size="sm"
            className="tw:w-full"
            disabled={installBusy}
            onClick={onInstall}
          >
            {installBusy && <LoaderCircle className="spin" />}
            {state?.installing
              ? "Installing…"
              : activeInstallAgent
                ? `Installing ${activeInstallAgent.name}…`
                : state?.error
                  ? "Retry installation"
                  : `Install ${agent.name}`}
          </Button>
          {state?.error && <span role="alert">{state.error}</span>}
          {command && <><span>Or install it manually:</span><code>{command}</code></>}
        </>
      ) : (
        <span>The traecli executable was not found on PATH. Install Trae CLI using its official distribution.</span>
      )}
    </Card>
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
    <span className="tw:flex tw:min-w-0 tw:w-full tw:items-center tw:gap-[12px]">
      <span className="tw:grid tw:size-[38px] tw:flex-none tw:place-items-center tw:rounded-[10px] tw:border tw:border-border tw:bg-background tw:text-foreground">
        <AgentIcon id={agent?.id} className="tw:size-[23px] tw:text-current" />
      </span>
      <span className={`${selectCopyClass} tw:[&_small]:mt-[4px] tw:[&_small]:text-[calc(11px*var(--app-font-scale))] tw:[&_small]:leading-[1.25] tw:[&_small]:text-muted-foreground tw:[&_strong]:leading-[1.2] tw:[&_strong]:font-[650]`}>
        <strong>{agent?.name ?? fallback}</strong>
        <small>
          {agent ? (descriptions[agent.id] ?? "Agent CLI integration") : fallback} · {detail}
        </small>
      </span>
    </span>
  );
}
