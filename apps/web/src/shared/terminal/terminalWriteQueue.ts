import type { IDisposable, IParser } from "@xterm/xterm";

type TerminalWrite = (data: string, callback: () => void) => void;
type WriteFailure = (generation: number) => void;
type WriteLifecycle = {
  onStart?: () => void;
  onSettled?: () => void;
};
type Parser = Pick<IParser, "registerCsiHandler" | "registerDcsHandler" | "registerOscHandler">;
type ReplyMatcher = (data: string) => boolean;

type PendingWrite = {
  generation: number;
  data: string;
  onComplete?: () => void;
  lifecycle?: WriteLifecycle;
};

export class TerminalSnapshotReplayGuard {
  private generation: number | null = null;
  private expectedReplies: ReplyMatcher[] = [];

  get active() {
    return this.generation !== null;
  }

  begin(generation: number) {
    this.generation = generation;
    this.expectedReplies = [];
  }

  end(generation: number) {
    if (this.generation !== generation) return;
    this.generation = null;
    this.expectedReplies = [];
  }

  clear() {
    this.generation = null;
    this.expectedReplies = [];
  }

  expectReply(matcher: ReplyMatcher) {
    if (this.active) this.expectedReplies.push(matcher);
  }

  suppress(data: string) {
    if (!this.active) return false;
    const index = this.expectedReplies.findIndex((matches) => matches(data));
    if (index < 0) return false;
    this.expectedReplies.splice(index, 1);
    return true;
  }
}

function parameter(params: (number | number[])[], index = 0) {
  const value = params[index];
  return Array.isArray(value) ? value[0] ?? 0 : value ?? 0;
}

function expectOscReply(guard: TerminalSnapshotReplayGuard, ident: string) {
  const pattern = new RegExp(`^\\x1b\\]${ident.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")};rgb:[0-9a-f]{4}/[0-9a-f]{4}/[0-9a-f]{4}\\x1b\\\\$`, "i");
  guard.expectReply((data) => pattern.test(data));
}

export function registerTerminalSnapshotReplayHandlers(parser: Parser, guard: TerminalSnapshotReplayGuard): IDisposable {
  const disposables: IDisposable[] = [];
  const suppressCsiQuery = (id: { prefix?: string; intermediates?: string; final: string }, query: (params: (number | number[])[]) => boolean) => {
    disposables.push(parser.registerCsiHandler(id, (params) => guard.active && query(params)));
  };

  suppressCsiQuery({ final: "c" }, (params) => parameter(params) <= 0);
  suppressCsiQuery({ prefix: ">", final: "c" }, (params) => parameter(params) <= 0);
  suppressCsiQuery({ final: "n" }, (params) => parameter(params) === 5 || parameter(params) === 6);
  suppressCsiQuery({ prefix: "?", final: "n" }, (params) => parameter(params) === 6);
  suppressCsiQuery({ intermediates: "$", final: "p" }, () => true);
  suppressCsiQuery({ prefix: "?", intermediates: "$", final: "p" }, () => true);
  suppressCsiQuery({ final: "t" }, (params) => {
    const operation = parameter(params);
    return operation === 16 || operation === 18 || operation === 14 && parameter(params, 1) !== 2;
  });
  disposables.push(parser.registerDcsHandler({ intermediates: "$", final: "q" }, () => guard.active));
  disposables.push(parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
    if (!guard.active) return false;
    const reports = params.filter((value) => parameter([value]) === 1004).length;
    for (let index = 0; index < reports; index += 1) {
      guard.expectReply((data) => data === "\x1b[I" || data === "\x1b[O");
    }
    return false;
  }));
  disposables.push(parser.registerOscHandler(4, (data) => {
    if (!guard.active) return false;
    const slots = data.split(";");
    for (let index = 0; index + 1 < slots.length; index += 2) {
      const colorIndexText = slots[index];
      if (!/^\d+$/.test(colorIndexText)) continue;
      const colorIndex = Number(colorIndexText);
      if (slots[index + 1] === "?" && colorIndex >= 0 && colorIndex <= 255) {
        expectOscReply(guard, `4;${colorIndex}`);
      }
    }
    return false;
  }));
  for (const ident of [10, 11, 12]) {
    disposables.push(parser.registerOscHandler(ident, (data) => {
      if (!guard.active) return false;
      for (const [index, value] of data.split(";").entries()) {
        const responseIdent = ident + index;
        if (responseIdent > 12) break;
        if (value === "?") expectOscReply(guard, String(responseIdent));
      }
      return false;
    }));
  }
  return {
    dispose: () => {
      for (const disposable of disposables) disposable.dispose();
      guard.clear();
    },
  };
}

const DEFAULT_MAX_PENDING_CHARACTERS = 2 * 1024 * 1024;

export class TerminalWriteQueue {
  private generation: number | null = null;
  private pending: PendingWrite[] = [];
  private pendingCharacters = 0;
  private activeEntry: PendingWrite | null = null;
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
    return this.writeEntry({ generation, data, onComplete });
  }

  snapshot(generation: number, data: string, onComplete: () => void, lifecycle?: WriteLifecycle) {
    return this.writeEntry({ generation, data: `\x1bc${data}`, onComplete, lifecycle });
  }

  dispose() {
    this.settleActiveEntry();
    this.settlePendingEntries();
    this.disposed = true;
    this.generation = null;
    this.pending = [];
    this.pendingCharacters = 0;
  }

  private writeEntry(entry: PendingWrite) {
    if (this.disposed || this.failed || entry.generation !== this.generation || !entry.data) return false;
    if (!this.writing) {
      this.submit(entry);
      return !this.failed;
    }
    if (this.pendingCharacters + entry.data.length > this.maxPendingCharacters) {
      this.fail(entry.generation);
      return false;
    }
    this.pending.push(entry);
    this.pendingCharacters += entry.data.length;
    return true;
  }

  private submit(entry: PendingWrite) {
    this.writing = true;
    this.activeEntry = entry;
    entry.lifecycle?.onStart?.();
    try {
      this.writeToTerminal(entry.data, () => this.complete(entry));
    } catch {
      this.writing = false;
      this.activeEntry = null;
      entry.lifecycle?.onSettled?.();
      this.fail(entry.generation);
    }
  }

  private complete(entry: PendingWrite) {
    if (!this.writing || this.activeEntry !== entry) return;
    this.writing = false;
    this.activeEntry = null;
    entry.lifecycle?.onSettled?.();
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

  private settleEntry(entry: PendingWrite) {
    const settle = entry.lifecycle?.onSettled;
    entry.lifecycle = undefined;
    settle?.();
  }

  private settleActiveEntry() {
    if (this.activeEntry) this.settleEntry(this.activeEntry);
  }

  private settlePendingEntries() {
    for (const entry of this.pending) this.settleEntry(entry);
  }

  private fail(generation: number) {
    if (this.disposed || this.failed || generation !== this.generation) return;
    this.failed = true;
    this.pending = [];
    this.pendingCharacters = 0;
    this.onFailure(generation);
  }
}
