export const TERMINAL_WORKSPACE_CAPACITY_STORAGE_KEY = "devhatch-terminal-workspace-capacity";

export type TerminalWorkspaceCapacity = 1 | 2 | 3 | 4;

export type TerminalWorkspaceDockState = {
  stagedIds: string[];
  minimizedIds: string[];
};

export function terminalViewTransitionName(id: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(id)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `terminal-pane-${hash.toString(16).padStart(16, "0")}`;
}

export function clampTerminalWorkspaceCapacity(value: number): TerminalWorkspaceCapacity {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(1, Math.round(value))) as TerminalWorkspaceCapacity;
}

function trimStaged(stagedIds: string[], capacity: number, activeId: string | null) {
  const next = [...stagedIds];
  while (next.length > capacity) {
    const removable = next.findIndex((id) => id !== activeId);
    next.splice(removable < 0 ? 0 : removable, 1);
  }
  return next;
}

export function reconcileTerminalWorkspaceDock(
  state: TerminalWorkspaceDockState | undefined,
  memberIds: string[],
  activeId: string | null,
  capacity: number,
): TerminalWorkspaceDockState {
  const members = new Set(memberIds);
  const minimizedIds = (state?.minimizedIds ?? []).filter((id) => members.has(id));
  let stagedIds = (state?.stagedIds ?? []).filter((id) => members.has(id) && !minimizedIds.includes(id));
  if (activeId && members.has(activeId) && !minimizedIds.includes(activeId) && !stagedIds.includes(activeId)) stagedIds.push(activeId);
  stagedIds = trimStaged(stagedIds, clampTerminalWorkspaceCapacity(capacity), activeId);
  return { stagedIds, minimizedIds };
}

export function stageTerminal(
  state: TerminalWorkspaceDockState,
  id: string,
  activeId: string | null,
  capacity: number,
): TerminalWorkspaceDockState {
  const limit = clampTerminalWorkspaceCapacity(capacity);
  const stagedIds = [...state.stagedIds];
  if (!stagedIds.includes(id)) {
    while (stagedIds.length >= limit) {
      const removable = stagedIds.findIndex((item) => item !== activeId);
      stagedIds.splice(removable < 0 ? 0 : removable, 1);
    }
    stagedIds.push(id);
  }
  return {
    stagedIds,
    minimizedIds: state.minimizedIds.filter((item) => item !== id),
  };
}

export function minimizeTerminal(state: TerminalWorkspaceDockState, id: string): TerminalWorkspaceDockState {
  return {
    stagedIds: state.stagedIds.filter((item) => item !== id),
    minimizedIds: state.minimizedIds.includes(id) ? state.minimizedIds : [...state.minimizedIds, id],
  };
}

export function resizeTerminalWorkspaceDock(
  state: TerminalWorkspaceDockState,
  capacity: number,
  activeId: string | null,
): TerminalWorkspaceDockState {
  return { ...state, stagedIds: trimStaged(state.stagedIds, clampTerminalWorkspaceCapacity(capacity), activeId) };
}
