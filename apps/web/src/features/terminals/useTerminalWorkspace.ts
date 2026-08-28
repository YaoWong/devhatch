import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTerminal,
  createTerminalLaunchPath,
  deleteTerminalLaunchPath,
  deleteTerminalSession,
  deleteTerminalWorkspace,
  renameRemoteSession,
  terminalLaunchPaths,
  terminalWorkspaces,
  terminals,
  updateTerminalLaunchPath,
  updateTerminalWorkspace,
} from "../../api/terminals";
import type { DeleteTarget } from "../../types/app";
import type { TerminalInfo, TerminalLaunchPath, TerminalWorkspace } from "../../types/terminals";
import { logicalPath } from "../../shared/lib/utils";
import { getOrCreateInFlightPromise, mergeDeletedTerminal, mergeTerminalSession, mergeWorkspaceMembers, WorkspaceMutationQueue } from "./workspaceMutationQueue";

type HomePaths = { home: string; resolvedHome: string } | null;

function normalizeSessionPath(session: TerminalInfo, paths: HomePaths) {
  return { ...session, cwd: logicalPath(session.cwd, paths?.home, paths?.resolvedHome) };
}

function normalizeLaunchPathValue(path: TerminalLaunchPath, paths: HomePaths) {
  return { ...path, path: logicalPath(path.path, paths?.home, paths?.resolvedHome) };
}

export function useTerminalWorkspace(
  homePaths: HomePaths,
  setHomePaths: (paths: NonNullable<HomePaths>) => void,
  reportError: (message: string) => void,
  closeSidebar: () => void,
  bumpFocus: () => void,
) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([]);
  const [launchPaths, setLaunchPaths] = useState<TerminalLaunchPath[]>([]);
  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const sessionsRef = useRef<TerminalInfo[]>([]);
  const workspacesRef = useRef<TerminalWorkspace[]>([]);
  const authoritativeWorkspacesRef = useRef<TerminalWorkspace[]>([]);
  const selectedWorkspaceIdRef = useRef<string | null>(null);
  const launchRef = useRef(false);
  const deletingPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const workspaceMutationsRef = useRef(new WorkspaceMutationQueue());

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  useEffect(() => { selectedWorkspaceIdRef.current = selectedWorkspaceId; }, [selectedWorkspaceId]);

  const normalizeSession = useCallback((session: TerminalInfo, paths = homePaths) => normalizeSessionPath(session, paths), [homePaths]);
  const normalizeLaunchPath = useCallback((path: TerminalLaunchPath, paths = homePaths) => normalizeLaunchPathValue(path, paths), [homePaths]);
  const mutateWorkspace = useCallback(<T,>(id: string, task: () => Promise<T>) => workspaceMutationsRef.current.run(id, task), []);
  const mutateLatestWorkspace = useCallback(<T,>(id: string, task: (workspace: TerminalWorkspace) => Promise<T>) => (
    workspaceMutationsRef.current.runLatest(
      id,
      () => authoritativeWorkspacesRef.current.find((workspace) => workspace.id === id),
      async (workspace) => {
        if (!workspace) throw new Error("Workspace no longer exists");
        return task(workspace);
      },
    )
  ), []);

  const applyWorkspaces = useCallback((next: TerminalWorkspace[], preferred?: string | null, authoritative = false) => {
    workspacesRef.current = next;
    if (authoritative) authoritativeWorkspacesRef.current = next;
    setWorkspaces(next);
    setSelectedWorkspaceId((current) => {
      const candidate = preferred === undefined ? current : preferred;
      const selected = candidate && next.some((workspace) => workspace.id === candidate) ? candidate : (next[0]?.id ?? null);
      selectedWorkspaceIdRef.current = selected;
      return selected;
    });
  }, []);

  const applyAuthoritativeWorkspace = useCallback((workspace: TerminalWorkspace) => {
    authoritativeWorkspacesRef.current = [
      ...authoritativeWorkspacesRef.current.filter((item) => item.id !== workspace.id),
      workspace,
    ];
  }, []);

  const refreshAll = useCallback(async () => {
    const mutationSnapshot = workspaceMutationsRef.current.snapshot();
    await workspaceMutationsRef.current.settle();
    const [terminalData, pathData, workspaceData] = await Promise.all([terminals(), terminalLaunchPaths(), terminalWorkspaces()]);
    const paths = { home: terminalData.home, resolvedHome: terminalData.resolvedHome };
    setHomePaths(paths);
    const nextSessions = terminalData.terminals.map((session) => normalizeSession(session, paths));
    sessionsRef.current = nextSessions;
    setSessions(nextSessions);
    setLaunchPaths(pathData.terminalLaunchPaths.map((path) => normalizeLaunchPath(path, paths)));
    const unchanged = workspaceData.terminalWorkspaces.filter(
      (workspace) => !workspaceMutationsRef.current.changedSince(mutationSnapshot, workspace.id),
    );
    const changed = workspacesRef.current.filter(
      (workspace) => workspaceMutationsRef.current.changedSince(mutationSnapshot, workspace.id),
    );
    authoritativeWorkspacesRef.current = [
      ...unchanged,
      ...authoritativeWorkspacesRef.current.filter(
        (workspace) => workspaceMutationsRef.current.changedSince(mutationSnapshot, workspace.id),
      ),
    ];
    applyWorkspaces([...unchanged, ...changed]);
  }, [applyWorkspaces, normalizeLaunchPath, normalizeSession, setHomePaths]);

  const initialize = useCallback((data: Awaited<ReturnType<typeof terminals>>) => {
    const paths = { home: data.home, resolvedHome: data.resolvedHome };
    const next = data.terminals.map((session) => normalizeSessionPath(session, paths));
    setHomePaths(paths);
    sessionsRef.current = next;
    setSessions(next);
  }, [setHomePaths]);

  const initializeLaunchPaths = useCallback((data: Awaited<ReturnType<typeof terminalLaunchPaths>>, paths: HomePaths) => {
    setLaunchPaths(data.terminalLaunchPaths.map((path) => normalizeLaunchPathValue(path, paths)));
  }, []);

  const initializeWorkspaces = useCallback((data: Awaited<ReturnType<typeof terminalWorkspaces>>) => {
    applyWorkspaces(data.terminalWorkspaces, undefined, true);
  }, [applyWorkspaces]);

  useEffect(() => {
    setSessions((current) => current.map((session) => normalizeSession(session)));
    setLaunchPaths((current) => current.map((path) => normalizeLaunchPath(path)));
  }, [normalizeLaunchPath, normalizeSession]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  );
  const visibleSessions = useMemo(() => {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    return (selectedWorkspace?.members ?? []).flatMap((member) => {
      const session = byId.get(member.terminalId);
      return session ? [session] : [];
    });
  }, [selectedWorkspace, sessions]);
  const activeId = selectedWorkspace?.activeTerminalId ?? null;
  const activeSession = visibleSessions.find((session) => session.id === activeId) ?? null;

  const addTerminal = useCallback(async (cwd?: string, forceNewWorkspace = false) => {
    if (launchRef.current) return null;
    launchRef.current = true;
    setLaunching(true);
    const selectedBeforeLaunch = selectedWorkspaceIdRef.current;
    const selectedAtStart = forceNewWorkspace ? null : selectedBeforeLaunch;
    const mutationKey = selectedAtStart ?? `new:${Date.now()}`;
    const mutation = mutateWorkspace(mutationKey, async () => {
      const result = await createTerminal(cwd, selectedAtStart ?? undefined);
      applyAuthoritativeWorkspace(result.terminalWorkspace);
      return result;
    });
    try {
      const { terminal, terminalWorkspace } = await mutation.result;
      const normalized = normalizeSession(terminal);
      sessionsRef.current = mergeTerminalSession(sessionsRef.current, normalized);
      setSessions(sessionsRef.current);
      const latest = workspaceMutationsRef.current.isLatest(mutationKey, mutation.generation);
      const preferred = selectedWorkspaceIdRef.current === selectedBeforeLaunch ? terminalWorkspace.id : undefined;
      const nextWorkspaces = latest
        ? [...workspacesRef.current.filter((item) => item.id !== terminalWorkspace.id), terminalWorkspace]
        : mergeWorkspaceMembers(workspacesRef.current, terminalWorkspace);
      applyWorkspaces(nextWorkspaces, preferred);
      void terminalLaunchPaths().then((data) => initializeLaunchPaths(data, homePaths)).catch(() => undefined);
      closeSidebar();
      bumpFocus();
      return normalized;
    } catch (reason) {
      if (workspaceMutationsRef.current.isLatest(mutationKey, mutation.generation)) {
        reportError(reason instanceof Error ? reason.message : String(reason));
        void refreshAll().catch(() => undefined);
      }
      return null;
    } finally {
      launchRef.current = false;
      setLaunching(false);
    }
  }, [applyAuthoritativeWorkspace, applyWorkspaces, bumpFocus, closeSidebar, homePaths, initializeLaunchPaths, mutateWorkspace, normalizeSession, refreshAll, reportError]);

  const chooseLaunchPath = useCallback(async (path: string) => {
    try {
      const { terminalLaunchPath } = await createTerminalLaunchPath(path);
      const normalized = normalizeLaunchPath(terminalLaunchPath);
      setLaunchPaths((current) => [normalized, ...current.filter((item) => item.id !== normalized.id)]);
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [normalizeLaunchPath, reportError]);

  const activateWorkspace = useCallback((id: string) => {
    selectedWorkspaceIdRef.current = id;
    setSelectedWorkspaceId(id);
    closeSidebar();
  }, [closeSidebar]);

  const activateSession = useCallback(async (id: string) => {
    const workspace = workspacesRef.current.find((item) => item.id === selectedWorkspaceIdRef.current);
    if (!workspace) return;
    if (workspace.activeTerminalId === id) { bumpFocus(); return; }
    const optimistic = { ...workspace, activeTerminalId: id };
    applyWorkspaces(workspacesRef.current.map((item) => item.id === workspace.id ? optimistic : item), workspace.id);
    bumpFocus();
    const mutation = mutateLatestWorkspace(workspace.id, async (latest) => {
      const saved = await updateTerminalWorkspace(latest.id, { activeTerminalId: id });
      applyAuthoritativeWorkspace(saved.terminalWorkspace);
      return saved;
    });
    try {
      const saved = await mutation.result;
      if (!workspaceMutationsRef.current.isLatest(workspace.id, mutation.generation)) return;
      applyWorkspaces(workspacesRef.current.map((item) => item.id === workspace.id ? saved.terminalWorkspace : item));
    } catch (reason) {
      if (!workspaceMutationsRef.current.isLatest(workspace.id, mutation.generation)) return;
      reportError(reason instanceof Error ? reason.message : String(reason));
      void refreshAll().catch(() => undefined);
    }
  }, [applyAuthoritativeWorkspace, applyWorkspaces, bumpFocus, mutateLatestWorkspace, refreshAll, reportError]);

  const renameWorkspace = useCallback(async (workspace: TerminalWorkspace) => {
    const name = window.prompt("Workspace name", workspace.name ?? "")?.trim();
    if (name === undefined || name === (workspace.name ?? "")) return;
    const mutation = mutateWorkspace(workspace.id, async () => {
      const saved = await updateTerminalWorkspace(workspace.id, { name: name || null });
      applyAuthoritativeWorkspace(saved.terminalWorkspace);
      return saved;
    });
    try {
      const saved = await mutation.result;
      if (!workspaceMutationsRef.current.isLatest(workspace.id, mutation.generation)) return;
      applyWorkspaces(workspacesRef.current.map((item) => item.id === workspace.id ? saved.terminalWorkspace : item));
    } catch (reason) {
      if (workspaceMutationsRef.current.isLatest(workspace.id, mutation.generation)) reportError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [applyAuthoritativeWorkspace, applyWorkspaces, mutateWorkspace, reportError]);

  const removeWorkspace = useCallback(async (workspace: TerminalWorkspace) => {
    const mutation = mutateWorkspace(workspace.id, async () => {
      await deleteTerminalWorkspace(workspace.id);
      authoritativeWorkspacesRef.current = authoritativeWorkspacesRef.current.filter((item) => item.id !== workspace.id);
      return terminalWorkspaces();
    });
    try {
      const refreshed = await mutation.result;
      if (!workspaceMutationsRef.current.isLatest(workspace.id, mutation.generation)) return true;
      applyWorkspaces(refreshed.terminalWorkspaces, undefined, true);
      return true;
    } catch (reason) {
      if (workspaceMutationsRef.current.isLatest(workspace.id, mutation.generation)) reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [applyWorkspaces, mutateWorkspace, reportError]);

  const pinLaunchPath = useCallback(async (path: TerminalLaunchPath) => {
    try {
      const saved = await updateTerminalLaunchPath(path.id, { pinned: !path.pinned });
      setLaunchPaths((current) => current.map((item) => item.id === path.id ? normalizeLaunchPath(saved.terminalLaunchPath) : item));
    } catch (reason) { reportError(reason instanceof Error ? reason.message : String(reason)); }
  }, [normalizeLaunchPath, reportError]);

  const renameLaunchPath = useCallback(async (path: TerminalLaunchPath, alias: string) => {
    try {
      const saved = await updateTerminalLaunchPath(path.id, { alias: alias.trim() || null });
      setLaunchPaths((current) => current.map((item) => item.id === path.id ? normalizeLaunchPath(saved.terminalLaunchPath) : item));
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [normalizeLaunchPath, reportError]);

  const removeLaunchPath = useCallback(async (path: TerminalLaunchPath) => {
    try {
      await deleteTerminalLaunchPath(path.id);
      setLaunchPaths((current) => current.filter((item) => item.id !== path.id));
      return true;
    } catch (reason) {
      reportError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [reportError]);

  const renameSession = useCallback(async (session: TerminalInfo) => {
    const name = window.prompt("Session name", session.name)?.trim();
    if (!name || name === session.name) return;
    try {
      const result = await renameRemoteSession("/api/terminals", session.id, name);
      const updated = normalizeSession(Object.values(result)[0] as TerminalInfo);
      setSessions((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { reportError(reason instanceof Error ? reason.message : String(reason)); }
  }, [normalizeSession, reportError]);

  const deleteSession = useCallback((target: DeleteTarget): Promise<boolean> => (
    getOrCreateInFlightPromise(deletingPromisesRef.current, target.id, async () => {
      const workspaceId = workspacesRef.current.find((workspace) => workspace.members.some((member) => member.terminalId === target.id))?.id;
      const mutation = mutateWorkspace(workspaceId ?? `terminal:${target.id}`, async () => {
        const result = await deleteTerminalSession(target.id);
        if (result.terminalWorkspace) applyAuthoritativeWorkspace(result.terminalWorkspace);
        else if (workspaceId) authoritativeWorkspacesRef.current = authoritativeWorkspacesRef.current.filter((item) => item.id !== workspaceId);
        return result;
      });
      try {
        const { terminalWorkspace } = await mutation.result;
        sessionsRef.current = sessionsRef.current.filter((item) => item.id !== target.id);
        setSessions(sessionsRef.current);
        const next = mergeDeletedTerminal(workspacesRef.current, target.id, workspaceId, terminalWorkspace);
        applyWorkspaces(next);
        return true;
      } catch (reason) {
        await refreshAll().catch(() => undefined);
        throw reason;
      }
    })
  ), [applyAuthoritativeWorkspace, applyWorkspaces, mutateWorkspace, refreshAll]);

  return {
    sessions, launchPaths, workspaces, selectedWorkspaceId, selectedWorkspace, activeId, activeSession,
    visibleSessions, launching, initialize, initializeLaunchPaths, initializeWorkspaces, addTerminal,
    chooseLaunchPath, activateWorkspace, activateSession, renameWorkspace,
    removeWorkspace, pinLaunchPath, renameLaunchPath, removeLaunchPath, renameSession, deleteSession,
  };
}
