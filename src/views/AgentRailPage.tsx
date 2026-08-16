import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentIcon } from "../Branding";
import { CustomSelect } from "../components";
import type { Agent, AgentLaunchPath, AgentSession, ConfirmAction } from "../types";
import { LaunchPaths } from "./LaunchPaths";
import { AgentSessionList } from "./AgentSessionList";

type HomePaths = { home: string; resolvedHome: string } | null;
type SessionRows = Parameters<typeof AgentSessionList>[0]["rows"];

export function AgentRailPage({
  busy,
  agents,
  selectedAgentId,
  selectedAgent,
  paths,
  activeSession,
  sessions,
  historyCount,
  rows,
  search,
  homePaths,
  onSelectAgent,
  onChoosePath,
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
}: {
  busy: boolean;
  agents: Agent[];
  selectedAgentId: string | null;
  selectedAgent: Agent | null;
  paths: AgentLaunchPath[];
  activeSession: AgentSession | null;
  sessions: AgentSession[];
  historyCount: number;
  rows: SessionRows;
  search: string;
  homePaths: HomePaths;
  onSelectAgent: (id: string) => void;
  onChoosePath: () => void;
  onLaunch: (path: AgentLaunchPath) => void;
  onPinPath: (path: AgentLaunchPath) => Promise<void>;
  onRenamePath: (path: AgentLaunchPath, alias: string) => Promise<boolean>;
  onDeletePath: (path: AgentLaunchPath) => Promise<void>;
  onSearch: (value: string) => void;
  onActivateSession: (id: string) => void;
  onResume: (id: string) => Promise<void>;
  onDeleteLive: (session: AgentSession) => void;
  onConfirm: (action: ConfirmAction) => void;
  onDeleteHistory: (id: string) => Promise<void>;
}) {
  const [pathDisplay, setPathDisplay] = useState<"folder" | "full">(() =>
    localStorage.getItem("devhatch-agent-path-display") === "full" ? "full" : "folder",
  );
  const [page, setPage] = useState(1);
  const [renamePath, setRenamePath] = useState<AgentLaunchPath | null>(null);
  const [renameAlias, setRenameAlias] = useState("");
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
            {selectedAgent?.id === "opencode" && !selectedAgent.available && (
              <div className="agent-install-message">
                <strong>OpenCode is not installed</strong>
                <span>Install it to launch agent sessions:</span>
                <code>curl -fsSL https://opencode.ai/install | bash</code>
              </div>
            )}
            <button className="config-default" type="button">
              <span>
                <strong>Config</strong>
                <small>OpenCode configuration</small>
              </span>
              <b>Default</b>
              <ChevronRight />
            </button>
          </>
        ) : (
          <div className="quiet-message">No Agent CLI integrations found.</div>
        )}
      </div>
      <LaunchPaths
        paths={paths}
        activeCwd={activeSession?.cwd}
        available={Boolean(selectedAgent?.available)}
        homePaths={homePaths}
        pathDisplay={pathDisplay}
        page={page}
        onDisplayChange={updateDisplay}
        onPageChange={setPage}
        onChoose={onChoosePath}
        onLaunch={onLaunch}
        onPin={(path) => void onPinPath(path)}
        onRename={(path) => {
          setRenamePath(path);
          setRenameAlias(path.alias ?? "");
        }}
        onDelete={deletePath}
      />
      <AgentSessionList
        rows={rows}
        sessionCount={sessions.length}
        historyCount={historyCount}
        activeId={activeSession?.id ?? null}
        search={search}
        homePaths={homePaths}
        onSearch={onSearch}
        onActivate={onActivateSession}
        onResume={onResume}
        onDeleteLive={onDeleteLive}
        onConfirm={onConfirm}
        onDeleteHistory={onDeleteHistory}
      />
    </>
  );
}

function AgentOption({ agent, fallback }: { agent?: Agent; fallback?: string }) {
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
          {agent?.id === "opencode" ? "Agentic coding CLI" : "OpenAI coding agent"} · {detail}
        </small>
      </span>
    </>
  );
}
