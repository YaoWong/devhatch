import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import type { ConnectionPhase, TerminalInfo } from "./types";

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";

export function TerminalSurface({
  session,
  active,
  focusVersion,
  socketBase,
  onPhaseChange,
  onRemoved,
  onUpstreamSessionChange,
  onError,
}: {
  session: TerminalInfo;
  active: boolean;
  focusVersion: number;
  socketBase: string;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onRemoved?: (id: string) => void;
  onUpstreamSessionChange?: (id: string, upstreamSessionId: string) => void;
  onError: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const activateRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<number | null>(null);
  const activeRef = useRef(active);
  const onRemovedRef = useRef(onRemoved);
  const onUpstreamSessionChangeRef = useRef(onUpstreamSessionChange);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
    onUpstreamSessionChangeRef.current = onUpstreamSessionChange;
  }, [onRemoved, onUpstreamSessionChange]);
  useEffect(() => {
    activeRef.current = active;
    if (active) requestAnimationFrame(() => activateRef.current?.());
    else terminalRef.current?.blur();
  }, [active, focusVersion]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let attempt = 0;
    let protocolReady = false;
    let inputBuffer = "";
    let resizeFrame: number | null = null;
    let lastResize = "";
    let terminal: Terminal;
    let fit: FitAddon;
    try {
      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: '"JetBrainsMono Nerd Font Web", monospace',
        fontSize: 13,
        fontWeight: "normal",
        fontWeightBold: "bold",
        lineHeight: 1,
        scrollback: 5000,
        theme: {
          background: "#ffffff",
          foreground: "#1d1d1f",
          cursor: "#0071e3",
          selectionBackground: "#cce4ff",
          black: "#1d1d1f",
          red: "#d70015",
          green: "#16803c",
          yellow: "#9a6700",
          blue: "#0066cc",
          magenta: "#8944ab",
          cyan: "#007c91",
          white: "#f5f5f7",
          brightBlack: "#6e6e73",
          brightRed: "#ff3b30",
          brightGreen: "#34c759",
          brightYellow: "#ffcc00",
          brightBlue: "#0a84ff",
          brightMagenta: "#bf5af2",
          brightCyan: "#64d2ff",
          brightWhite: "#ffffff",
        },
      });
      fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container);
      try {
        terminal.loadAddon(new WebglAddon());
      } catch {
        terminal.refresh(0, terminal.rows - 1);
      }
    } catch (reason) {
      onPhaseChange(session.id, "disconnected");
      onError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    terminalRef.current = terminal;
    const sendResize = () => {
      if (!activeRef.current) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const socket = socketRef.current;
      const dimensions = `${terminal.cols}x${terminal.rows}`;
      if (protocolReady && socket?.readyState === WebSocket.OPEN && dimensions !== lastResize) {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        lastResize = dimensions;
      }
    };
    const scheduleResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        sendResize();
      });
    };
    activateRef.current = () => {
      sendResize();
      terminal.focus();
    };
    const connect = () => {
      if (disposed) return;
      protocolReady = false;
      lastResize = "";
      onPhaseChange(session.id, attempt ? "reconnecting" : "connecting");
      const socket = new WebSocket(`${socketProtocol}//${window.location.host}${socketBase}/${session.id}/socket`);
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (!disposed && socketRef.current === socket) attempt = 0;
      });
      socket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== socket) return;
        try {
          const message = JSON.parse(String(event.data)) as {
            type: string;
            data?: string;
            upstreamSessionId?: string;
            terminal?: { upstreamSessionId?: string };
          };
          if (message.type === "ready") {
            sendResize();
            if (message.terminal?.upstreamSessionId) {
              onUpstreamSessionChangeRef.current?.(session.id, message.terminal.upstreamSessionId);
            }
          }
          if (message.type === "upstreamSessionChanged" && message.upstreamSessionId) {
            onUpstreamSessionChangeRef.current?.(session.id, message.upstreamSessionId);
          }
          if (message.type === "snapshot") {
            terminal.reset();
            if (message.data) terminal.write(message.data);
            protocolReady = true;
            onPhaseChange(session.id, "connected");
            sendResize();
            if (inputBuffer) {
              socket.send(JSON.stringify({ type: "input", data: inputBuffer }));
              inputBuffer = "";
            }
            if (activeRef.current) requestAnimationFrame(() => terminal.focus());
          }
          if (message.type === "output" && message.data) terminal.write(message.data);
          if (message.type === "exit" || message.type === "processExited") {
            onPhaseChange(session.id, "exited");
            if (!onRemovedRef.current) {
              disposed = true;
              socket.close(1000, "process exited");
            }
          }
          if (message.type === "removed") {
            disposed = true;
            if (retryRef.current) window.clearTimeout(retryRef.current);
            onRemovedRef.current?.(session.id);
            socket.close(1000, "removed");
          }
        } catch {
          return;
        }
      });
      socket.addEventListener("close", (event) => {
        if (disposed || socketRef.current !== socket) return;
        protocolReady = false;
        socketRef.current = null;
        if (event.code === 1000) return;
        onPhaseChange(session.id, "disconnected");
        retryRef.current = window.setTimeout(connect, Math.min(500 * 2 ** attempt++, 5000));
      });
    };
    const input = terminal.onData((data) => {
      const socket = socketRef.current;
      if (protocolReady && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
      else inputBuffer = (inputBuffer + data).slice(-64 * 1024);
    });
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(container);
    void document.fonts.ready.then(() => {
      if (!disposed && activeRef.current) scheduleResize();
    });
    connect();
    if (activeRef.current) requestAnimationFrame(() => activateRef.current?.());
    return () => {
      disposed = true;
      if (retryRef.current) window.clearTimeout(retryRef.current);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      input.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "surface closed");
      terminal.dispose();
      terminalRef.current = null;
      activateRef.current = null;
    };
  }, [session.id, socketBase, onPhaseChange, onError]);
  return <div ref={containerRef} className={`terminal-surface ${active ? "active" : ""}`} />;
}
