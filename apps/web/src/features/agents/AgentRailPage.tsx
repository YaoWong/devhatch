import { ChevronDown, ChevronRight, Code2, Layers3 } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { AgentIcon } from "../../shared/branding/Branding";
import { CustomSelect } from "../../shared/ui/CustomSelect";
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
          showAgentLoading ? <div className="quiet-message" role="status">Loading agents…</div> : null
        ) : agents.length ? (
          <>
            <CustomSelect
              label="Select Agent CLI"
              value={selectedAgentId}
              options={agents}
              isOptionDisabled={(agent) => !agent.enabled || agent.availability === "coming-soon"}
              onChange={onSelectAgent}
              renderTrigger={(agent) => <AgentOption agent={agent} fallback="Select agent" />}
              renderOption={(agent) => <AgentOption agent={agent} />}
            />
            <div className="launch-setup">
              <button
                className="launch-setup-toggle"
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
              </button>
              {!launchSetupCollapsed && (
                <div className="launch-setup-body" id="agent-launch-setup-body">
                  {selectedAgent && !selectedAgent.available && (
                    <div className="agent-install-message">
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
                    </div>
                  )}
                  {selectedAgent?.supportsSkills && (
                    <CustomSelect
                      label="Skills"
                      value={selectedProfileId ?? "none"}
                      options={[{ id: "none", slug: "None" }, ...profiles]}
                      onChange={(id) => onSelectProfile(id === "none" ? null : id)}
                      renderTrigger={(profile) => (
                        <span className="launch-setting-copy">
                          <Layers3 />
                          <span><small>Skills</small><strong>{profile?.slug ?? "None"}</strong></span>
                        </span>
                      )}
                      renderOption={(profile) => <span className="select-copy"><strong>{profile.slug}</strong><small>{profile.id === "none" ? "Launch without managed skills" : "Apply on new sessions"}</small></span>}
                    />
                  )}
                  <button className="launch-setting-row" type="button" onClick={() => setConfigOpen(true)}>
                    <Code2 />
                    <span><small>Launch script</small><strong>{selectedConfig?.name ?? "None"}</strong></span>
                    <ChevronRight />
                  </button>
                </div>
              )}
            </div>
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
