import type { WorkspaceMode } from "../types/app";
import type { Agent, AgentSession } from "../types/agents";
import type { WebApp } from "../types/web-apps";
import { displayPath } from "../shared/lib/utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function getModeSubtitle({
  mode,
  openDesign,
  activeAgentSession,
  selectedAgent,
  selectedWorkspace,
  homePaths,
}: {
  mode: WorkspaceMode;
  openDesign: WebApp | null;
  activeAgentSession: AgentSession | null;
  selectedAgent: Agent | null;
  selectedWorkspace: string | null;
  homePaths: HomePaths;
}) {
  if (mode === "settings") return "Preferences for your DevHatch workspace";
  if (mode === "skills") return "Repositories, reusable skills, and launch profiles";
  if (mode === "webapp") {
    return openDesign?.running
      ? `OpenDesign v${openDesign.version ?? ""} · Running locally`
      : "Install and run local developer web apps";
  }
  if (mode === "agent") {
    return activeAgentSession
      ? `${displayPath(activeAgentSession.cwd, homePaths?.home, homePaths?.resolvedHome)} · ${activeAgentSession.agentName}`
      : (selectedAgent?.name ?? "No agent selected");
  }
  return selectedWorkspace
    ? displayPath(selectedWorkspace, homePaths?.home, homePaths?.resolvedHome)
    : "No workspace selected";
}
