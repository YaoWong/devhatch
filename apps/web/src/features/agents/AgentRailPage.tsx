import { ChevronDown, ChevronRight, Code2, Layers3, LoaderCircle, SquareTerminal } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AgentIcon } from "../../shared/branding/Branding";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { LiveRegion } from "../../shared/ui/LiveRegion";
import { railMenuLabelClass, railMenuSectionClass, selectCopyClass } from "../../shared/ui/railStyles";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type { Agent, LaunchConfig, LaunchConfigInput } from "../../types/agents";
import type { ConfirmAction } from "../../types/app";
import type { SkillProfile } from "../../types/skills";
import { TERMINAL_LAUNCH_TARGET_ID } from "./launchSetupPreference";
import { AgentConfigDialog } from "./AgentConfigDialog";

function readLaunchSetupCollapsed(key: string) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeLaunchSetupCollapsed(key: string, collapsed: boolean) {
  try {
    localStorage.setItem(key, String(collapsed));
  } catch {
    return;
  }
}

type LaunchTargetOption = {
  id: string;
  name: string;
  agent: Agent | null;
};

export function AgentRailPage({
  busy,
  launching,
  configsLoading,
  agents,
  selectedTargetId,
  selectedAgent,
  configs,
  selectedConfigId,
  profiles,
  selectedProfileId,
  installState,
  activeInstallAgent,
  installAnnouncement,
  installBusy,
  onSelectTarget,
  onSelectConfig,
  onSelectProfile,
  onCreateConfig,
  onUpdateConfig,
  onDeleteConfig,
  onInstallAgent,
  onConfirm,
}: {
  busy: boolean;
  launching: boolean;
  configsLoading: boolean;
  agents: Agent[];
  selectedTargetId: string;
  selectedAgent: Agent | null;
  configs: LaunchConfig[];
  selectedConfigId: string | null;
  profiles: SkillProfile[];
  selectedProfileId: string | null;
  installState?: { installing: boolean; installed: boolean; error: string | null };
  activeInstallAgent: Agent | null;
  installAnnouncement: string;
  installBusy: boolean;
  onSelectTarget: (id: string) => void;
  onSelectConfig: (id: string) => void;
  onSelectProfile: (id: string | null) => void;
  onCreateConfig: (input: LaunchConfigInput) => Promise<boolean>;
  onUpdateConfig: (id: string, input: LaunchConfigInput) => Promise<boolean>;
  onDeleteConfig: (id: string) => Promise<boolean>;
  onInstallAgent: (id: string) => Promise<boolean>;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const [configOpen, setConfigOpen] = useState(false);
  const showAgentLoading = useDelayedLoading(busy);
  const targetName = selectedAgent?.name ?? "Terminal";
  const targetOptions: LaunchTargetOption[] = [
    { id: TERMINAL_LAUNCH_TARGET_ID, name: "Terminal", agent: null },
    ...agents.map((agent) => ({ id: agent.id, name: agent.name, agent })),
  ];
  const launchSetupStorageKey = `devhatch-launch-setup-collapsed:${selectedTargetId}`;
  const [launchSetupCollapsed, setLaunchSetupCollapsed] = useState(() =>
    readLaunchSetupCollapsed(launchSetupStorageKey),
  );
  useLayoutEffect(() => {
    setLaunchSetupCollapsed(readLaunchSetupCollapsed(launchSetupStorageKey));
  }, [launchSetupStorageKey]);
  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
  const loadingAnnouncement = showAgentLoading ? "Loading launch targets…" : busy ? "" : "Launch targets loaded.";

  return (
    <section className={`${railMenuSectionClass} agent-launch-section`}>
      <LiveRegion>{loadingAnnouncement}</LiveRegion>
      <LiveRegion>{installAnnouncement}</LiveRegion>
      {configOpen && (
        <AgentConfigDialog
          key={selectedTargetId}
          configs={configs}
          agentId={selectedTargetId}
          agentName={targetName}
          selectedConfigId={selectedConfigId}
          onSelect={onSelectConfig}
          onCreate={onCreateConfig}
          onUpdate={onUpdateConfig}
          onDelete={onDeleteConfig}
          onConfirm={onConfirm}
          onClose={() => setConfigOpen(false)}
        />
      )}
      <p className={railMenuLabelClass}>Launch Setup</p>
      <CustomSelect
        density="spacious"
        label="Select launch target"
        value={selectedTargetId}
        options={targetOptions}
        disabled={busy || launching}
        getOptionLabel={(target) => target.name}
        isOptionDisabled={(target) => Boolean(target.agent && (!target.agent.enabled || target.agent.availability === "coming-soon"))}
        onChange={onSelectTarget}
        renderTrigger={(target) => <TargetOption target={target} fallback="Select target" />}
        renderOption={(target) => <TargetOption target={target} />}
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
          aria-controls="launch-setup-body"
          onClick={() => {
            const collapsed = !launchSetupCollapsed;
            setLaunchSetupCollapsed(collapsed);
            writeLaunchSetupCollapsed(launchSetupStorageKey, collapsed);
          }}
        >
          <span className="tw:flex tw:w-full tw:items-center tw:justify-between tw:px-0.5">
            <span>Options</span>
            <ChevronDown />
          </span>
        </Button>
        {!launchSetupCollapsed && (
          <div className="tw:grid tw:gap-0.5" id="launch-setup-body">
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
              disabled={busy || launching || configsLoading}
              onClick={() => setConfigOpen(true)}
            >
              <Code2 />
              <span><small>Launch config</small><strong>{configsLoading ? "Loading…" : (selectedConfig?.name ?? "None")}</strong></span>
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>
    </section>
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
          <Button type="button" size="sm" className="tw:w-full" disabled={installBusy} onClick={onInstall}>
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

function TargetOption({ target, fallback }: { target?: LaunchTargetOption; fallback?: string }) {
  const descriptions: Record<string, string> = {
    codex: "OpenAI coding agent",
    opencode: "Agentic coding CLI",
    pi: "Minimal coding agent CLI",
    traecli: "Trae coding agent CLI",
  };
  const agent = target?.agent;
  const detail = !agent
    ? "Interactive shell · Ready"
    : agent.availability === "coming-soon"
      ? "Coming soon"
      : agent.available
        ? agent.version
          ? `v${agent.version}`
          : "Installed"
        : "Not installed";
  return (
    <span className="tw:flex tw:min-w-0 tw:w-full tw:items-center tw:gap-[12px]">
      <span className="tw:grid tw:size-[38px] tw:flex-none tw:place-items-center tw:rounded-[10px] tw:border tw:border-border tw:bg-background tw:text-foreground">
        {agent ? <AgentIcon id={agent.id} className="tw:size-[23px] tw:text-current" /> : <SquareTerminal className="tw:size-[22px]" />}
      </span>
      <span className={`${selectCopyClass} tw:[&_small]:mt-[4px] tw:[&_small]:text-[calc(11px*var(--app-font-scale))] tw:[&_small]:leading-[1.25] tw:[&_small]:text-muted-foreground tw:[&_strong]:leading-[1.2] tw:[&_strong]:font-[650]`}>
        <strong>{target?.name ?? fallback}</strong>
        <small>
          {target ? (agent ? descriptions[agent.id] ?? "Agent CLI integration" : "Interactive shell") : fallback} · {detail}
        </small>
      </span>
    </span>
  );
}
