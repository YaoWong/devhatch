import type { TerminalWorkspace } from "../../types/terminals";

export function getOrCreateInFlightPromise<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const result = task();
  let promise: Promise<T>;
  const clear = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  promise = result.finally(clear);
  inFlight.set(key, promise);
  return promise;
}

export function mergeTerminalSession<T extends { id: string }>(current: T[], returned: T) {
  return [...current.filter((session) => session.id !== returned.id), returned];
}

export function mergeWorkspaceMembers(
  current: TerminalWorkspace[],
  returned: TerminalWorkspace,
): TerminalWorkspace[] {
  const existing = current.find((workspace) => workspace.id === returned.id);
  if (!existing) return [...current, returned];
  const terminalIds = new Set(existing.members.map((member) => member.terminalId));
  const members = [
    ...existing.members,
    ...returned.members.filter((member) => !terminalIds.has(member.terminalId)),
  ];
  if (members.length === existing.members.length) return current;
  return current.map((workspace) => workspace.id === existing.id ? { ...existing, members } : workspace);
}

export function mergeDeletedTerminal(
  current: TerminalWorkspace[],
  terminalId: string,
  workspaceId: string | undefined,
  returned: TerminalWorkspace | null,
): TerminalWorkspace[] {
  if (!returned) {
    return current.filter((workspace) => workspace.id !== workspaceId && !workspace.members.some((member) => member.terminalId === terminalId));
  }
  return current.flatMap((workspace) => {
    if (workspace.id !== returned.id) return [workspace];
    const members = workspace.members.filter((member) => member.terminalId !== terminalId);
    const memberIds = new Set(members.map((member) => member.terminalId));
    const activeTerminalId = workspace.activeTerminalId !== terminalId && workspace.activeTerminalId !== null && memberIds.has(workspace.activeTerminalId)
      ? workspace.activeTerminalId
      : returned.activeTerminalId !== null && memberIds.has(returned.activeTerminalId) ? returned.activeTerminalId : (members[0]?.terminalId ?? null);
    return [{ ...workspace, activeTerminalId, members }];
  });
}

export class WorkspaceMutationQueue {
  private readonly generations = new Map<string, number>();
  private readonly queues = new Map<string, Promise<void>>();

  invalidate(key: string) {
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    return generation;
  }

  isLatest(key: string, generation: number) {
    return (this.generations.get(key) ?? 0) === generation;
  }

  snapshot() {
    return new Map(this.generations);
  }

  async settle() {
    await Promise.all(this.queues.values());
  }

  changedSince(snapshot: ReadonlyMap<string, number>, key: string) {
    return (snapshot.get(key) ?? 0) !== (this.generations.get(key) ?? 0);
  }

  run<T>(key: string, task: () => Promise<T>) {
    const generation = this.invalidate(key);
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return { generation, result };
  }

  read<T>(key: string, task: () => Promise<T>) {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const result = previous.then(async () => {
      const generation = this.generations.get(key) ?? 0;
      return { generation, value: await task() };
    }, async () => {
      const generation = this.generations.get(key) ?? 0;
      return { generation, value: await task() };
    });
    const tail = result.then(() => undefined, () => undefined);
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return result;
  }

  async readLatest<T>(key: string, task: () => Promise<T>): Promise<T> {
    for (;;) {
      const { generation, value } = await this.read(key, task);
      if (this.isLatest(key, generation)) return value;
    }
  }

  runLatest<T, R>(key: string, read: () => T, task: (latest: T) => Promise<R>) {
    return this.run(key, () => task(read()));
  }
}
