import { ChevronRight, Code2, Layers3 } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentIcon } from "../Branding";
import { CustomSelect } from "../components/CustomSelect";
import type {
  Agent,
  AgentLaunchConfig,
  AgentLaunchConfigInput,
  AgentLaunchPath,
  AgentSession,
  ConfirmAction,
  SkillProfile,
} from "../types";
import { AgentConfigDialog } from "./AgentConfigDialog";
import { LaunchPaths } from "./LaunchPaths";
import { AgentSessionList } from "./AgentSessionList";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRows = Parameters<typeof AgentSessionList>[0]["rows"];

export function AgentRailPage({
  busy,
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
  agents: Agent[];
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
  onSelectAgent: (id: string) => void;
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
  const [pathDisplay, setPathDisplay] = useState<"folder" | "full">(() =>
    localStorage.getItem("devhatch-agent-path-display") === "full" ? "full" : "folder",
  );
  const [page, setPage] = useState(1);
  const [renamePath, setRenamePath] = useState<AgentLaunchPath | null>(null);
  const [renameAlias, setRenameAlias] = useState("");
  const [configOpen, setConfigOpen] = useState(false);
  const selectedConfig = configs.find((config) => config.id === selectedConfigId) ?? null;
  const pageCount = Math.max(1, Math.ceil(paths.length / 10));
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount]);

  const updateDisplay = (mode: "folder" | "full") => {
    setPathDisplay(mode);
    localStorage.setItem("devhatch-agent-path-display", mode);
  };
  const deletePath = (path: AgentLaunchPath) =>
    onConfirm({
      title: "Delete launch path?",
      description: `${path.path} will be removed from the Agent CLI library.`,
      confirmLabel: "Delete path",
      danger: true,
      action: () => onDeletePath(path),
    });

  return (
    <>
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
      {renamePath && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => event.target === event.currentTarget && setRenamePath(null)}
        >
          <div className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <h2 id="rename-title">Rename launch path</h2>
            <p>{renamePath.path}</p>
            <label>
              Alias
              <input
                autoFocus
                value={renameAlias}
                maxLength={120}
                onChange={(event) => setRenameAlias(event.target.value)}
              />
            </label>
            <div className="dialog-buttons">
              <button onClick={() => setRenamePath(null)}>Cancel</button>
              <button
                className="primary"
                onClick={() =>
                  void onRenamePath(renamePath, renameAlias).then((saved) => {
                    if (saved) setRenamePath(null);
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="menu-section">
        <p className="menu-label">Agent CLI</p>
        {busy ? (
          <div className="quiet-message">Loading agents…</div>
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
              <p className="launch-setup-label">Launch setup</p>
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
          </>
        ) : (
          <div className="quiet-message">No Agent CLI integrations found.</div>
        )}
      </div>
      <LaunchPaths
        paths={paths}
        selectedPathId={selectedPathId}
        available={Boolean(selectedAgent?.available)}
        homePaths={homePaths}
        pathDisplay={pathDisplay}
        page={page}
        onDisplayChange={updateDisplay}
        onPageChange={setPage}
        onChoose={onChoosePath}
        onSelect={(path) => onSelectPath(path.id)}
        onLaunch={onLaunch}
        onPin={(path) => void onPinPath(path)}
        onRename={(path) => {
          setRenamePath(path);
          setRenameAlias(path.alias ?? "");
        }}
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
    </>
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
        <AgentIcon id={agent?.id} />
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
