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

  async readAndApplyLatest<T>(key: string, task: () => Promise<T>, apply: (value: T) => void) {
    for (;;) {
      const pending = this.queues.get(key);
      if (pending) {
        await pending;
        continue;
      }
      const generation = this.generations.get(key) ?? 0;
      const value = await task();
      if (!this.isLatest(key, generation)) continue;
      apply(value);
      return;
    }
  }

  runLatest<T, R>(key: string, read: () => T, task: (latest: T) => Promise<R>) {
    return this.run(key, () => task(read()));
  }
}
