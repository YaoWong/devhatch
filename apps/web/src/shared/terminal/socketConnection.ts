import type { ConnectionPhase } from "../../types/terminals";

export type CloseAction = "ignored" | "reconnect" | "terminal" | "unauthorized";

type Schedule = (callback: () => void, delay: number) => unknown;
type Cancel = (handle: unknown) => void;
type VerifyAuthentication = () => Promise<void>;
type Unauthorized = () => void;

export class SocketConnection {
  private attempt = 0;
  private generation = 0;
  private stopped = false;
  private snapshotReceived = false;
  private preSnapshotFailures = 0;
  private retry: unknown | null = null;
  private verification: Promise<void> | null = null;
  private readonly schedule: Schedule;
  private readonly cancel: Cancel;
  private readonly verifyAuthentication: VerifyAuthentication;
  private readonly unauthorized: Unauthorized;

  constructor(
    schedule: Schedule,
    cancel: Cancel,
    verifyAuthentication: VerifyAuthentication = () => Promise.resolve(),
    unauthorized: Unauthorized = () => undefined,
  ) {
    this.schedule = schedule;
    this.cancel = cancel;
    this.verifyAuthentication = verifyAuthentication;
    this.unauthorized = unauthorized;
  }

  begin(): { generation: number; phase: ConnectionPhase } | null {
    if (this.stopped) return null;
    this.cancelRetry();
    this.generation += 1;
    this.snapshotReceived = false;
    return {
      generation: this.generation,
      phase: this.attempt === 0 ? "connecting" : "reconnecting",
    };
  }

  snapshot(generation: number) {
    if (!this.current(generation)) return false;
    this.attempt = 0;
    this.preSnapshotFailures = 0;
    this.snapshotReceived = true;
    return true;
  }

  close(generation: number, code: number, reconnect: () => void): CloseAction {
    if (!this.current(generation)) return "ignored";
    this.generation += 1;
    if (code === 1000) {
      this.stopped = true;
      this.cancelRetry();
      return "terminal";
    }
    if (code === 1008) {
      this.stopped = true;
      this.cancelRetry();
      this.unauthorized();
      return "unauthorized";
    }
    if (this.snapshotReceived) this.preSnapshotFailures = 0;
    else this.preSnapshotFailures += 1;
    const retryGeneration = this.generation;
    const delay = Math.min(500 * 2 ** this.attempt, 5000);
    this.attempt += 1;
    if (this.preSnapshotFailures < 2) {
      this.scheduleRetry(retryGeneration, delay, reconnect);
    } else {
      this.verify(retryGeneration, delay, reconnect);
    }
    return "reconnect";
  }

  stop() {
    this.stopped = true;
    this.generation += 1;
    this.cancelRetry();
  }

  private verify(generation: number, delay: number, reconnect: () => void) {
    if (this.verification) return;
    const verification = this.verifyAuthentication()
      .then(() => {
        if (this.current(generation)) this.scheduleRetry(generation, delay, reconnect);
      })
      .catch((reason: unknown) => {
        if (!this.current(generation)) return;
        if (typeof reason === "object" && reason !== null && "status" in reason && reason.status === 401) {
          this.stopped = true;
          this.generation += 1;
          this.cancelRetry();
          this.unauthorized();
          return;
        }
        this.scheduleRetry(generation, delay, reconnect);
      })
      .finally(() => {
        if (this.verification === verification) this.verification = null;
      });
    this.verification = verification;
  }

  private scheduleRetry(generation: number, delay: number, reconnect: () => void) {
    if (!this.current(generation)) return;
    this.retry = this.schedule(() => {
      this.retry = null;
      if (this.current(generation)) reconnect();
    }, delay);
  }

  private current(generation: number) {
    return !this.stopped && generation === this.generation;
  }

  private cancelRetry() {
    if (this.retry === null) return;
    this.cancel(this.retry);
    this.retry = null;
  }
}
