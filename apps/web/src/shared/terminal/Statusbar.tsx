import type { ConnectionPhase, TerminalInfo } from "../../types/terminals";
import { formatUptime } from "../lib/utils";

export function Statusbar({ session, phase }: { session: TerminalInfo | null; phase?: ConnectionPhase }) {
  return (
    <footer className="statusbar">
      <span className={`status-light ${session ? (phase ?? "connecting") : "disconnected"}`} />
      <span>{session ? (phase ?? "connecting") : "No session"}</span>
      <span className="status-path">{session?.shell ?? ""}</span>
      {session && (
        <>
          <span>
            {session.cols} × {session.rows}
          </span>
          <span>uptime {formatUptime(session.createdAt)}</span>
        </>
      )}
    </footer>
  );
}
