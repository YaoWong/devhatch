import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createTerminal,
  createTerminalWorkspace,
  deleteRemoteSession,
  deleteTerminalWorkspace,
  endpoints,
  renameRemoteSession,
  updateTerminalWorkspace,
} from "../api";
import type { DeleteTarget, TerminalInfo, TerminalWorkspace } from "../types";
import { logicalPath } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function useTerminalWorkspace(
  homePaths: HomePaths,
  setHomePaths: (paths: NonNullable<HomePaths>) => void,
  reportError: (message: string) => void,
  closeSidebar: () => void,
  bumpFocus: () => void,
) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<TerminalInfo[]>([]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const normalizeWorkspace = useCallback(
    (workspace: TerminalWorkspace): TerminalWorkspace => ({
      ...workspace,
      path: logicalPath(workspace.path, homePaths?.home, homePaths?.resolvedHome),
    }),
    [homePaths],
  );

  const refreshWorkspaces = useCallback(async () => {
    const data = await endpoints.terminalWorkspaces();
    const next = data.terminalWorkspaces.map(normalizeWorkspace);
    setWorkspaces(next);
    setSelectedWorkspace((current) =>
      current && next.some((workspace) => workspace.path === current) ? current : (next[0]?.path ?? null),
    );
    return next;
  }, [normalizeWorkspace]);

  useEffect(() => {
    setWorkspaces((current) => current.map(normalizeWorkspace));
    setSessions((current) =>
      current.map((session) => ({
        ...session,
        cwd: logicalPath(session.cwd, homePaths?.home, homePaths?.resolvedHome),
      })),
    );
    setSelectedWorkspace((current) =>
      current ? logicalPath(current, homePaths?.home, homePaths?.resolvedHome) : current,
    );
  }, [homePaths, normalizeWorkspace]);

  const initialize = useCallback(
    (data: Awaited<ReturnType<typeof endpoints.terminals>>) => {
      const paths = { home: data.home, resolvedHome: data.resolvedHome };
      const normalized = data.terminals.map((session) => ({
        ...session,
        cwd: logicalPath(session.cwd, paths.home, paths.resolvedHome),
      }));
      setHomePaths(paths);
      setSessions(normalized);
      setActiveId(normalized[0]?.id ?? null);
    },
    [setHomePaths],
  );

  const initializeWorkspaces = useCallback(
    (data: Awaited<ReturnType<typeof endpoints.terminalWorkspaces>>, paths: HomePaths) => {
      const next = data.terminalWorkspaces.map((workspace) => ({
        ...workspace,
        path: logicalPath(workspace.path, paths?.home, paths?.resolvedHome),
      }));
      setWorkspaces(next);
      setSelectedWorkspace((current) => current ?? next[0]?.path ?? null);
    },
    [],
  );

  const addTerminal = useCallback(
    async (cwd?: string) => {
      try {
        const { terminal } = await createTerminal(cwd);
        const normalized = {
          ...terminal,
          cwd: logicalPath(terminal.cwd, homePaths?.home, homePaths?.resolvedHome),
        };
        setSessions((current) => [...current, normalized]);
        await refreshWorkspaces();
        setSelectedWorkspace(normalized.cwd);
        setActiveId(normalized.id);
        closeSidebar();
        bumpFocus();
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [bumpFocus, closeSidebar, homePaths, refreshWorkspaces, reportError],
  );

  const chooseWorkspace = useCallback(
    async (path: string) => {
      try {
        const { terminalWorkspace } = await createTerminalWorkspace(path);
        const normalized = normalizeWorkspace(terminalWorkspace);
        await refreshWorkspaces();
        setSelectedWorkspace(normalized.path);
        setActiveId(sessionsRef.current.find((session) => session.cwd === normalized.path)?.id ?? null);
        return true;
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
        return false;
      }
    },
    [normalizeWorkspace, refreshWorkspaces, reportError],
  );

  const activateWorkspace = useCallback(
    (path: string) => {
      setSelectedWorkspace(path);
      setActiveId(sessionsRef.current.find((session) => session.cwd === path)?.id ?? null);
      closeSidebar();
    },
    [closeSidebar],
  );

  const pinWorkspace = useCallback(
    async (workspace: TerminalWorkspace) => {
      try {
        await updateTerminalWorkspace(workspace.id, !workspace.pinned);
        await refreshWorkspaces();
        setSelectedWorkspace(workspace.path);
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [refreshWorkspaces, reportError],
  );

  const removeWorkspace = useCallback(
    async (workspace: TerminalWorkspace) => {
      try {
        const index = workspaces.findIndex((item) => item.id === workspace.id);
        await deleteTerminalWorkspace(workspace.id);
        const next = await refreshWorkspaces();
        if (selectedWorkspace === workspace.path) {
          const selected = next[Math.min(index, next.length - 1)] ?? next[0];
          setSelectedWorkspace(selected?.path ?? null);
          setActiveId(selected ? (sessionsRef.current.find((session) => session.cwd === selected.path)?.id ?? null) : null);
        }
        return true;
      } catch (reason) {
        await Promise.allSettled([endpoints.terminals(), endpoints.terminalWorkspaces()]).then(([terminalResult, workspaceResult]) => {
          if (terminalResult.status === "fulfilled") initialize(terminalResult.value);
          if (workspaceResult.status === "fulfilled") initializeWorkspaces(workspaceResult.value, homePaths);
        });
        reportError(
          reason instanceof ApiError && reason.status === 409 && reason.code === "WORKSPACE_HAS_TERMINALS"
            ? "Close all terminals in this workspace before removing it."
            : reason instanceof Error
              ? reason.message
              : String(reason),
        );
        return true;
      }
    },
    [homePaths, initialize, initializeWorkspaces, refreshWorkspaces, reportError, selectedWorkspace, workspaces],
  );

  const activateSession = useCallback(
    (id: string) => {
      setActiveId(id);
      bumpFocus();
    },
    [bumpFocus],
  );

  const renameSession = useCallback(
    async (session: TerminalInfo) => {
      const name = window.prompt("Session name", session.name)?.trim();
      if (!name || name === session.name) return;
      try {
        const result = await renameRemoteSession("/api/terminals", session.id, name);
        const updated = Object.values(result)[0];
        const normalized = {
          ...updated,
          cwd: logicalPath(updated.cwd, homePaths?.home, homePaths?.resolvedHome),
        };
        setSessions((current) => current.map((item) => (item.id === normalized.id ? normalized : item)));
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [homePaths, reportError],
  );

  const deleteSession = useCallback(
    async (target: DeleteTarget) => {
      await deleteRemoteSession("/api/terminals", target.id);
      const next = sessionsRef.current.filter((item) => item.id !== target.id);
      sessionsRef.current = next;
      setSessions(next);
      setActiveId((active) =>
        active === target.id ? (next.find((item) => item.cwd === selectedWorkspace)?.id ?? null) : active,
      );
    },
    [selectedWorkspace],
  );

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.cwd === selectedWorkspace),
    [selectedWorkspace, sessions],
  );
  const activeSession = visibleSessions.find((session) => session.id === activeId) ?? null;

  return {
    sessions,
    workspaces,
    selectedWorkspace,
    activeId,
    activeSession,
    visibleSessions,
    initialize,
    initializeWorkspaces,
    addTerminal,
    chooseWorkspace,
    activateWorkspace,
    pinWorkspace,
    removeWorkspace,
    activateSession,
    renameSession,
    deleteSession,
  };
}
