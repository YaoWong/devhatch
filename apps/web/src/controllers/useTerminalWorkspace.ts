import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createTerminal, deleteRemoteSession, endpoints, renameRemoteSession } from "../api";
import type { DeleteTarget, TerminalInfo } from "../types";
import { logicalPath, uniquePaths } from "../utils";

type HomePaths = { home: string; resolvedHome: string } | null;

export function useTerminalWorkspace(
  homePaths: HomePaths,
  setHomePaths: (paths: NonNullable<HomePaths>) => void,
  reportError: (message: string) => void,
  closeSidebar: () => void,
  bumpFocus: () => void,
) {
  const [sessions, setSessions] = useState<TerminalInfo[]>([]);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const sessionsRef = useRef<TerminalInfo[]>([]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const initialize = useCallback(
    (data: Awaited<ReturnType<typeof endpoints.terminals>>) => {
      const paths = { home: data.home, resolvedHome: data.resolvedHome };
      const normalized = data.terminals.map((session) => ({
        ...session,
        cwd: logicalPath(session.cwd, paths.home, paths.resolvedHome),
      }));
      const workspaces = uniquePaths(normalized);
      setHomePaths(paths);
      setSessions(normalized);
      setWorkspaces(workspaces);
      setSelectedWorkspace(workspaces[0] ?? null);
      setActiveId(normalized[0]?.id ?? null);
    },
    [setHomePaths],
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
        setWorkspaces((current) => (current.includes(normalized.cwd) ? current : [normalized.cwd, ...current]));
        setSelectedWorkspace(normalized.cwd);
        setActiveId(normalized.id);
        closeSidebar();
        bumpFocus();
      } catch (reason) {
        reportError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [bumpFocus, closeSidebar, homePaths, reportError],
  );

  const chooseWorkspace = useCallback(
    (path: string) => {
      const normalized = logicalPath(path, homePaths?.home, homePaths?.resolvedHome);
      setWorkspaces((current) => (current.includes(normalized) ? current : [normalized, ...current]));
      setSelectedWorkspace(normalized);
      setActiveId(sessionsRef.current.find((session) => session.cwd === normalized)?.id ?? null);
    },
    [homePaths],
  );

  const activateWorkspace = useCallback(
    (path: string) => {
      setSelectedWorkspace(path);
      setActiveId(sessionsRef.current.find((session) => session.cwd === path)?.id ?? null);
      closeSidebar();
    },
    [closeSidebar],
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
    addTerminal,
    chooseWorkspace,
    activateWorkspace,
    activateSession,
    renameSession,
    deleteSession,
  };
}
