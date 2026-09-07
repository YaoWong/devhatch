type TerminalWrite = (data: string, callback: () => void) => void;
type WriteFailure = (generation: number) => void;

type PendingWrite = {
  generation: number;
  data: string;
  onComplete?: () => void;
};

const DEFAULT_MAX_PENDING_CHARACTERS = 2 * 1024 * 1024;

export class TerminalWriteQueue {
  private generation: number | null = null;
  private pending: PendingWrite[] = [];
  private pendingCharacters = 0;
  private writing = false;
  private failed = false;
  private disposed = false;

  private readonly writeToTerminal: TerminalWrite;
  private readonly onFailure: WriteFailure;
  private readonly maxPendingCharacters: number;

  constructor(
    writeToTerminal: TerminalWrite,
    onFailure: WriteFailure,
    maxPendingCharacters = DEFAULT_MAX_PENDING_CHARACTERS,
  ) {
    this.writeToTerminal = writeToTerminal;
    this.onFailure = onFailure;
    this.maxPendingCharacters = maxPendingCharacters;
  }

  begin(generation: number) {
    if (this.disposed) return;
    this.generation = generation;
    this.pending = [];
    this.pendingCharacters = 0;
    this.failed = false;
  }

  write(generation: number, data: string, onComplete?: () => void) {
    if (this.disposed || this.failed || generation !== this.generation || !data) return false;
    const entry = { generation, data, onComplete };
    if (!this.writing) {
      this.submit(entry);
      return !this.failed;
    }
    if (this.pendingCharacters + data.length > this.maxPendingCharacters) {
      this.fail(generation);
      return false;
    }
    this.pending.push(entry);
    this.pendingCharacters += data.length;
    return true;
  }

  snapshot(generation: number, data: string, onComplete: () => void) {
    return this.write(generation, `\x1bc${data}`, onComplete);
  }

  dispose() {
    this.disposed = true;
    this.generation = null;
    this.pending = [];
    this.pendingCharacters = 0;
  }

  private submit(entry: PendingWrite) {
    this.writing = true;
    try {
      this.writeToTerminal(entry.data, () => this.complete(entry));
    } catch {
      this.writing = false;
      this.fail(entry.generation);
    }
  }

  private complete(entry: PendingWrite) {
    if (!this.writing) return;
    this.writing = false;
    if (!this.disposed && !this.failed && entry.generation === this.generation) entry.onComplete?.();
    this.pump();
  }

  private pump() {
    if (this.disposed || this.failed || this.writing) return;
    while (this.pending.length) {
      const entry = this.pending.shift()!;
      this.pendingCharacters -= entry.data.length;
      if (entry.generation !== this.generation) continue;
      this.submit(entry);
      return;
    }
  }

  private fail(generation: number) {
    if (this.disposed || this.failed || generation !== this.generation) return;
    this.failed = true;
    this.pending = [];
    this.pendingCharacters = 0;
    this.onFailure(generation);
  }
}
