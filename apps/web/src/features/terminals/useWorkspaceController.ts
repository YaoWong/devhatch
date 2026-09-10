import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAgentSession } from "../../api/agents";
import {
  createTerminal,
  deleteRemoteSession,
  deleteTerminalSession,
  renameRemoteSession,
} from "../../api/terminals";
import {
  createLaunchPath,
  createWorkspace as createWorkspaceRequest,
  deleteLaunchPath,
  deleteWorkspace,
  launchPaths as listLaunchPaths,
  updateLaunchPath,
  updateWorkspace,
  workspaces as listWorkspaces,
} from "../../api/workspaces";
import { logicalPath } from "../../shared/lib/utils";
import type { AgentSession } from "../../types/agents";
import type { DeleteTarget } from "../../types/app";
import {
  isAgentSession,
  sameSessionRef,
  sessionKey,
  sessionRef,
  type LaunchPath,
  type Workspace,
  type WorkspaceSession,
  type WorkspaceSessionRef,
  type WorkspaceSnapshot,
} from "../../types/workspaces";
import { getOrCreateInFlightPromise, WorkspaceMutationQueue } from "./workspaceMutationQueue";

const WORKSPACES_KEY = "workspaces";
const LAUNCH_PATHS_KEY = "launch-paths";
type HomePaths = { home: string; resolvedHome: string } | null;

function normalizeSession(session: WorkspaceSession, paths: HomePaths): WorkspaceSession {
  return { ...session, cwd: logicalPath(session.cwd, paths?.home, paths?.resolvedHome) };
}

function normalizeLaunchPath(path: LaunchPath, paths: HomePaths) {
  return { ...path, path: logicalPath(path.path, paths?.home, paths?.resolvedHome) };
}

export function launchPathSelection(
  paths: LaunchPath[],
  current: string | null,
  preferred?: string | null,
) {
  if (preferred === null) return null;
  const candidate = preferred === undefined ? current : preferred;
  if (candidate && paths.some((path) => path.id === candidate)) return candidate;
  return preferred === undefined && current === null ? null : (paths[0]?.id ?? null);
}

export function toggleLaunchPathSelection(current: string | null, id: string) {
  return current === id ? null : id;
}

export function workspaceSessions(workspace: Workspace | null, sessions: WorkspaceSession[]) {
  const byKey = new Map(sessions.map((session) => [sessionKey(session), session]));
  return (workspace?.members ?? []).flatMap((member) => {
    const session = byKey.get(sessionKey(member));
    return session ? [session] : [];
  });
}

export function workspaceOwningSession(workspaces: Workspace[], ref: WorkspaceSessionRef) {
  return workspaces.find((workspace) => workspace.members.some((member) => sameSessionRef(member, ref))) ?? null;
}

export function mergeWorkspace(current: Workspace[], returned: Workspace) {
  return current.some((workspace) => workspace.id === returned.id)
    ? current.map((workspace) => workspace.id === returned.id ? returned : workspace)
    : [...current, returned];
}

export function mergeCreatedWorkspace(
  current: Workspace[],
  returned: Workspace,
  created: WorkspaceSessionRef,
  stale: boolean,
) {
  if (!stale) return mergeWorkspace(current, returned);
  const existing = current.find((workspace) => workspace.id === returned.id);
  if (!existing) return [...current, returned];
  if (existing.members.some((member) => sameSessionRef(member, created))) return current;
  return current.map((workspace) => workspace.id === existing.id
    ? { ...existing, members: [...existing.members, created] }
    : workspace);
}

export function removeWorkspaceSession(
  workspaces: Workspace[],
  ref: WorkspaceSessionRef,
  returned?: Workspace | null,
) {
  return workspaces.map((workspace) => {
    if (!workspace.members.some((member) => sameSessionRef(member, ref))) return workspace;
    if (returned?.id === workspace.id) return returned;
    const removedIndex = workspace.members.findIndex((member) => sameSessionRef(member, ref));
    const members = workspace.members.filter((member) => !sameSessionRef(member, ref));
    const activeSession = sameSessionRef(workspace.activeSession, ref)
      ? (members[removedIndex] ?? members[0] ?? null)
      : workspace.activeSession;
    return { ...workspace, members, activeSession };
  });
}

export function useWorkspaceController({
  homePaths,
  setHomePaths,
  active,
  reportError,
  closeSidebar,
  bumpFocus,
}: {
  homePaths: HomePaths;
  setHomePaths: (paths: NonNullable<HomePaths>) => void;
  active: boolean;
  reportError: (message: string) => void;
  closeSidebar: () => void;
  bumpFocus: () => void;
}) {
  const [sessions, setSessions] = useState<WorkspaceSession[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [launchPaths, setLaunchPaths] = useState<LaunchPath[]>([]);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [terminalLaunching, setTerminalLaunching] = useState(false);
  const sessionsRef = useRef<WorkspaceSession[]>([]);
  const workspacesRef = useRef<Workspace[]>([]);
  const launchPathsRef = useRef<LaunchPath[]>([]);
  const homePathsRef = useRef(homePaths);
  const selectedWorkspaceIdRef = useRef<string | null>(null);
  const workspaceSelectionRevisionRef = useRef(0);
  const launchPathsInitializedRef = useRef(false);
  const queueRef = useRef(new WorkspaceMutationQueue());
  const workspaceRefreshRef = useRef<Promise<void> | null>(null);
  const launchPathRefreshRef = useRef<Promise<void> | null>(null);
  const terminalLaunchRef = useRef(false);
  const workspaceCreateRef = useRef<Promise<boolean> | null>(null);
  const pinningPathRef = useRef(new Map<string, Promise<void>>());
  const deletingRef = useRef(new Map<string, Promise<boolean>>());
  homePathsRef.current = homePaths;

  const applyWorkspaces = useCallback((next: Workspace[], preferred?: string | null) => {
    workspacesRef.current = next;
    setWorkspaces(next);
    setSelectedWorkspaceId((current) => {
      const candidate = preferred === undefined ? current : preferred;
      const selected = candidate && next.some((workspace) => workspace.id === candidate)
        ? candidate
        : (next[0]?.id ?? null);
      selectedWorkspaceIdRef.current = selected;
      return selected;
    });
  }, []);

  const applyLaunchPaths = useCallback((next: LaunchPath[], paths: HomePaths, preferred?: string | null) => {
    const normalized = next.map((path) => normalizeLaunchPath(path, paths));
    launchPathsRef.current = normalized;
    setLaunchPaths(normalized);
    setSelectedPathId((current) => launchPathSelection(normalized, current, preferred));
  }, []);

  const applySessions = useCallback((next: WorkspaceSession[], paths: HomePaths) => {
    const normalized = next.map((session) => normalizeSession(session, paths));
    sessionsRef.current = normalized;
    setSessions(normalized);
  }, []);

  const applySnapshot = useCallback((snapshot: WorkspaceSnapshot, preferred?: string | null) => {
    const paths = { home: snapshot.home, resolvedHome: snapshot.resolvedHome };
    homePathsRef.current = paths;
    setHomePaths(paths);
    applySessions(snapshot.sessions, paths);
    applyWorkspaces(snapshot.workspaces, preferred);
  }, [applySessions, applyWorkspaces, setHomePaths]);

  const refreshWorkspaces = useCallback(() => {
    if (workspaceRefreshRef.current) return workspaceRefreshRef.current;
    const request = queueRef.current.readAndApplyLatest(WORKSPACES_KEY, listWorkspaces, (snapshot) => {
      applySnapshot(snapshot);
    }).finally(() => {
      if (workspaceRefreshRef.current === request) workspaceRefreshRef.current = null;
    });
    workspaceRefreshRef.current = request;
    return request;
  }, [applySnapshot]);

  const refreshLaunchPaths = useCallback(() => {
    if (launchPathRefreshRef.current) return launchPathRefreshRef.current;
    const request = queueRef.current.readAndApplyLatest(LAUNCH_PATHS_KEY, listLaunchPaths, (data) => {
      const initialPreferred = launchPathsInitializedRef.current || launchPathsRef.current.length
        ? undefined
        : (data.launchPaths[0]?.id ?? null);
      launchPathsInitializedRef.current = true;
      applyLaunchPaths(data.launchPaths, homePathsRef.current, initialPreferred);
    }).finally(() => {
      if (launchPathRefreshRef.current === request) launchPathRefreshRef.current = null;
    });
    launchPathRefreshRef.current = request;
    return request;
  }, [applyLaunchPaths]);

  const refresh = useCallback(() => {
    void refreshWorkspaces().catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)));
    void refreshLaunchPaths().catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)));
  }, [refreshLaunchPaths, refreshWorkspaces, reportError]);

  const initialize = refreshWorkspaces;
  const initializeLaunchPaths = refreshLaunchPaths;

  useEffect(() => {
    if (!active) return;
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [active, refresh]);

  useEffect(() => {
    setSessions((current) => {
      const next = current.map((session) => normalizeSession(session, homePaths));
      sessionsRef.current = next;
      return next;
    });
    setLaunchPaths((current) => {
      const next = current.map((path) => normalizeLaunchPath(path, homePaths));
      launchPathsRef.current = next;
      return next;
    });
  }, [homePaths]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const visibleSessions = useMemo(
    () => workspaceSessions(selectedWorkspace, sessions),
    [selectedWorkspace, sessions],
  );
  const activeSession = useMemo(() => {
    const activeKey = selectedWorkspace?.activeSession ? sessionKey(selectedWorkspace.activeSession) : null;
    return visibleSessions.find((session) => sessionKey(session) === activeKey) ?? visibleSessions[0] ?? null;
  }, [selectedWorkspace, visibleSessions]);
  const terminalSessions = useMemo(
    () => sessions.filter((session): session is Extract<WorkspaceSession, { kind: "terminal" }> => session.kind === "terminal"),
    [sessions],
  );
  const agentSessions = useMemo(() => sessions.filter(isAgentSession), [sessions]);

  const activateWorkspace = useCallback((id: string) => {
    if (!workspacesRef.current.some((workspace) => workspace.id === id)) return;
    workspaceSelectionRevisionRef.current += 1;
    selectedWorkspaceIdRef.current = id;
    setSelectedWorkspaceId(id);
    closeSidebar();
    bumpFocus();
  }, [bumpFocus, closeSidebar]);

  const activateSession = useCallback((ref: WorkspaceSessionRef) => {
    const workspace = workspaceOwningSession(workspacesRef.current, ref);
    if (!workspace) {
      reportError("Unable to find the workspace for this session");
      return;
    }
    workspaceSelectionRevisionRef.current += 1;
    selectedWorkspaceIdRef.current = workspace.id;
    setSelectedWorkspaceId(workspace.id);
    if (sameSessionRef(workspace.activeSession, ref)) {
      closeSidebar();
      bumpFocus();
      return;
    }
    applyWorkspaces(workspacesRef.current.map((item) => item.id === workspace.id ? { ...item, activeSession: ref } : item), workspace.id);
    closeSidebar();
    bumpFocus();
    const mutation = queueRef.current.run(WORKSPACES_KEY, () => updateWorkspace(workspace.id, { activeSession: ref }));
    void mutation.result.then(() => undefined).catch((reason) => {
      reportError(reason instanceof Error ? reason.message : String(reason));
      void refresh();
    });
  }, [applyWorkspaces, bumpFocus, closeSidebar, refresh, reportError]);

  const createWorkspace = useCallback(() => {
    if (workspaceCreateRef.current) return workspaceCreateRef.current;
    const selectionRevisionAtStart = workspaceSelectionRevisionRef.current;
    const mutation = queueRef.current.run(WORKSPACES_KEY, () => createWorkspaceRequest({ members: [] }));
    const request = mutation.result.then(({ workspace }) => {
      const preferred = workspaceSelectionRevisionRef.current === selectionRevisionAtStart ? workspace.id : undefined;
      applyWorkspaces(mergeWorkspace(workspacesRef.current, workspace), preferred);
      closeSidebar();
      return true;
    }).catch((reason) => {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }).finally(() => {
      if (workspaceCreateRef.current === request) workspaceCreateRef.current = null;
    });
    workspaceCreateRef.current = request;
    return request;
  }, [applyWorkspaces, closeSidebar, reportError]);

  const renameWorkspace = useCallback(async (workspace: Workspace, name: string) => {
    const normalizedName = name.trim();
    if (normalizedName === (workspace.name ?? "").trim()) return true;
    const mutation = queueRef.current.run(WORKSPACES_KEY, () => updateWorkspace(workspace.id, { name: normalizedName || null }));
    try {
      await mutation.result;
      applyWorkspaces(workspacesRef.current.map((item) => item.id === workspace.id
        ? { ...item, name: normalizedName || null }
        : item));
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [applyWorkspaces, reportError]);

  const removeWorkspace = useCallback(async (workspace: Workspace) => {
    const mutation = queueRef.current.run(WORKSPACES_KEY, () => deleteWorkspace(workspace.id));
    try {
      await mutation.result;
      const removed = workspacesRef.current.find((item) => item.id === workspace.id) ?? workspace;
      const memberKeys = new Set(removed.members.map(sessionKey));
      sessionsRef.current = sessionsRef.current.filter((session) => !memberKeys.has(sessionKey(session)));
      setSessions(sessionsRef.current);
      applyWorkspaces(workspacesRef.current.filter((item) => item.id !== workspace.id));
      if (!queueRef.current.isLatest(WORKSPACES_KEY, mutation.generation)) void refresh();
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [applyWorkspaces, refresh, reportError]);

  const addTerminal = useCallback(async (cwd?: string, forceNewWorkspace = false, launchConfigId?: string) => {
    if (terminalLaunchRef.current) return null;
    terminalLaunchRef.current = true;
    setTerminalLaunching(true);
    const selectionAtStart = selectedWorkspaceIdRef.current;
    const targetWorkspaceId = forceNewWorkspace ? null : selectionAtStart;
    const mutation = queueRef.current.run(WORKSPACES_KEY, () => createTerminal(cwd, targetWorkspaceId, launchConfigId));
    try {
      const { terminal, workspace } = await mutation.result;
      const normalized = normalizeSession(terminal, homePathsRef.current);
      sessionsRef.current = [...sessionsRef.current.filter((session) => sessionKey(session) !== sessionKey(normalized)), normalized];
      setSessions(sessionsRef.current);
      const preferred = selectedWorkspaceIdRef.current === selectionAtStart ? workspace.id : undefined;
      applyWorkspaces(
        mergeCreatedWorkspace(
          workspacesRef.current,
          workspace,
          sessionRef(normalized),
          !queueRef.current.isLatest(WORKSPACES_KEY, mutation.generation),
        ),
        preferred,
      );
      void refreshLaunchPaths().catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)));
      closeSidebar();
      bumpFocus();
      return normalized;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      void refresh();
      return null;
    } finally {
      terminalLaunchRef.current = false;
      setTerminalLaunching(false);
    }
  }, [applyWorkspaces, bumpFocus, closeSidebar, refresh, refreshLaunchPaths, reportError]);

  const addAgent = useCallback(async (options: Omit<Parameters<typeof createAgentSession>[0], "workspaceId">) => {
    const selectionAtStart = selectedWorkspaceIdRef.current;
    const mutation = queueRef.current.run(WORKSPACES_KEY, () => createAgentSession({ ...options, workspaceId: selectionAtStart }));
    try {
      const { agentSession, workspace } = await mutation.result;
      const normalized = normalizeSession(agentSession, homePathsRef.current) as AgentSession;
      sessionsRef.current = [...sessionsRef.current.filter((session) => sessionKey(session) !== sessionKey(normalized)), normalized];
      setSessions(sessionsRef.current);
      const preferred = selectedWorkspaceIdRef.current === selectionAtStart ? workspace.id : undefined;
      applyWorkspaces(
        mergeCreatedWorkspace(
          workspacesRef.current,
          workspace,
          sessionRef(normalized),
          !queueRef.current.isLatest(WORKSPACES_KEY, mutation.generation),
        ),
        preferred,
      );
      void refreshLaunchPaths().catch((reason) => reportError(reason instanceof Error ? reason.message : String(reason)));
      closeSidebar();
      bumpFocus();
      return normalized;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      void refresh();
      return null;
    }
  }, [applyWorkspaces, bumpFocus, closeSidebar, refresh, refreshLaunchPaths, reportError]);

  const renameSession = useCallback(async (session: WorkspaceSession, name: string) => {
    const nextName = name.trim();
    if (!nextName || nextName === session.name) return true;
    const mutation = queueRef.current.run(WORKSPACES_KEY, async () => {
      const route = session.kind === "agent" ? "/api/agent-sessions" : "/api/terminals";
      return renameRemoteSession(route, session.id, nextName);
    });
    try {
      const result = await mutation.result;
      const updated = normalizeSession(Object.values(result)[0] as WorkspaceSession, homePathsRef.current);
      const key = sessionKey(updated);
      sessionsRef.current = sessionsRef.current.map((item) => sessionKey(item) === key
        ? { ...item, name: updated.name, updatedAt: updated.updatedAt }
        : item);
      setSessions(sessionsRef.current);
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [reportError]);

  const removeLocalSession = useCallback((ref: WorkspaceSessionRef) => {
    queueRef.current.invalidate(WORKSPACES_KEY);
    const key = sessionKey(ref);
    sessionsRef.current = sessionsRef.current.filter((session) => sessionKey(session) !== key);
    setSessions(sessionsRef.current);
    applyWorkspaces(removeWorkspaceSession(workspacesRef.current, ref));
  }, [applyWorkspaces]);

  const deleteSession = useCallback((target: DeleteTarget): Promise<boolean> => {
    const ref: WorkspaceSessionRef = { sessionId: target.id, kind: target.kind };
    return getOrCreateInFlightPromise(deletingRef.current, sessionKey(ref), async () => {
      const mutation = queueRef.current.run(WORKSPACES_KEY, async () => {
        if (ref.kind === "agent") {
          await deleteRemoteSession("/api/agent-sessions", ref.sessionId);
          return null;
        }
        return (await deleteTerminalSession(ref.sessionId)).workspace;
      });
      try {
        const returned = await mutation.result;
        sessionsRef.current = sessionsRef.current.filter((session) => sessionKey(session) !== sessionKey(ref));
        setSessions(sessionsRef.current);
        const stale = !queueRef.current.isLatest(WORKSPACES_KEY, mutation.generation);
        applyWorkspaces(removeWorkspaceSession(workspacesRef.current, ref, stale ? undefined : returned));
        if (ref.kind === "agent" || stale) void refresh();
        return true;
      } catch (reason) {
        void refresh();
        throw reason;
      }
    });
  }, [applyWorkspaces, refresh]);

  const updateUpstreamSession = useCallback((ref: WorkspaceSessionRef, upstreamSessionId: string, cwd?: string) => {
    queueRef.current.invalidate(WORKSPACES_KEY);
    const key = sessionKey(ref);
    const paths = homePathsRef.current;
    sessionsRef.current = sessionsRef.current.map((session) => sessionKey(session) === key && session.kind === "agent"
      ? { ...session, upstreamSessionId, cwd: cwd ? logicalPath(cwd, paths?.home, paths?.resolvedHome) : session.cwd }
      : session);
    setSessions(sessionsRef.current);
  }, []);

  const chooseLaunchPath = useCallback(async (path: string) => {
    const mutation = queueRef.current.run(LAUNCH_PATHS_KEY, () => createLaunchPath(path));
    try {
      const { launchPath } = await mutation.result;
      const normalized = normalizeLaunchPath(launchPath, homePathsRef.current);
      const next = [normalized, ...launchPathsRef.current.filter((item) => item.id !== normalized.id)];
      launchPathsRef.current = next;
      setLaunchPaths(next);
      setSelectedPathId(normalized.id);
      closeSidebar();
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [closeSidebar, reportError]);

  const selectLaunchPath = useCallback((id: string) => {
    if (!launchPathsRef.current.some((path) => path.id === id)) return;
    setSelectedPathId((current) => toggleLaunchPathSelection(current, id));
  }, []);

  const ensureLaunchPathSelected = useCallback((id: string) => {
    if (!launchPathsRef.current.some((path) => path.id === id)) return;
    setSelectedPathId(id);
  }, []);

  const pinLaunchPath = useCallback((path: LaunchPath) => {
    return getOrCreateInFlightPromise(pinningPathRef.current, path.id, async () => {
      const mutation = queueRef.current.run(LAUNCH_PATHS_KEY, () => updateLaunchPath(path.id, { pinned: !path.pinned }));
      try {
        const { launchPath } = await mutation.result;
        const normalized = normalizeLaunchPath(launchPath, homePathsRef.current);
        const next = launchPathsRef.current.map((item) => item.id === path.id ? normalized : item);
        launchPathsRef.current = next;
        setLaunchPaths(next);
        await refreshLaunchPaths();
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    });
  }, [refreshLaunchPaths, reportError]);

  const renameLaunchPath = useCallback(async (path: LaunchPath, alias: string) => {
    const mutation = queueRef.current.run(LAUNCH_PATHS_KEY, () => updateLaunchPath(path.id, { alias: alias.trim() || null }));
    try {
      const { launchPath } = await mutation.result;
      const normalized = normalizeLaunchPath(launchPath, homePathsRef.current);
      const next = launchPathsRef.current.map((item) => item.id === path.id ? normalized : item);
      launchPathsRef.current = next;
      setLaunchPaths(next);
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [reportError]);

  const removeLaunchPath = useCallback(async (path: LaunchPath) => {
    const mutation = queueRef.current.run(LAUNCH_PATHS_KEY, () => deleteLaunchPath(path.id));
    try {
      await mutation.result;
      const next = launchPathsRef.current.filter((item) => item.id !== path.id);
      launchPathsRef.current = next;
      setLaunchPaths(next);
      setSelectedPathId((current) => current === path.id ? null : current);
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [reportError]);

  return {
    sessions,
    terminalSessions,
    agentSessions,
    workspaces,
    selectedWorkspaceId,
    selectedWorkspace,
    visibleSessions,
    activeSession,
    launchPaths,
    selectedPathId,
    terminalLaunching,
    initialize,
    initializeLaunchPaths,
    refresh,
    refreshLaunchPaths,
    activateWorkspace,
    activateSession,
    createWorkspace,
    renameWorkspace,
    removeWorkspace,
    addTerminal,
    addAgent,
    renameSession,
    deleteSession,
    removeLocalSession,
    updateUpstreamSession,
    chooseLaunchPath,
    selectLaunchPath,
    ensureLaunchPathSelected,
    pinLaunchPath,
    renameLaunchPath,
    removeLaunchPath,
  };
}
