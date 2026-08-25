import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import { useTheme } from "./ThemeContext";
import type { ConnectionPhase, TerminalInfo, ThemeId } from "./types";

const terminalThemes: Record<ThemeId, ITheme> = {
  default: { background: "#ffffff", foreground: "#1d1d1f", cursor: "#0071e3", selectionBackground: "#cce4ff", black: "#1d1d1f", red: "#d70015", green: "#16803c", yellow: "#9a6700", blue: "#0066cc", magenta: "#8944ab", cyan: "#007c91", white: "#f5f5f7", brightBlack: "#6e6e73", brightRed: "#ff3b30", brightGreen: "#34c759", brightYellow: "#ffcc00", brightBlue: "#0a84ff", brightMagenta: "#bf5af2", brightCyan: "#64d2ff", brightWhite: "#ffffff" },
  latte: { background: "#eff1f5", foreground: "#4c4f69", cursor: "#1e66f5", selectionBackground: "#acb0be", black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d", blue: "#1e66f5", magenta: "#8839ef", cyan: "#179299", white: "#acb0be", brightBlack: "#6c6f85", brightRed: "#d20f39", brightGreen: "#40a02b", brightYellow: "#df8e1d", brightBlue: "#1e66f5", brightMagenta: "#8839ef", brightCyan: "#179299", brightWhite: "#dce0e8" },
  frappe: { background: "#303446", foreground: "#c6d0f5", cursor: "#8caaee", selectionBackground: "#626880", black: "#51576d", red: "#e78284", green: "#a6d189", yellow: "#e5c890", blue: "#8caaee", magenta: "#ca9ee6", cyan: "#81c8be", white: "#b5bfe2", brightBlack: "#626880", brightRed: "#e78284", brightGreen: "#a6d189", brightYellow: "#e5c890", brightBlue: "#8caaee", brightMagenta: "#ca9ee6", brightCyan: "#81c8be", brightWhite: "#c6d0f5" },
  macchiato: { background: "#24273a", foreground: "#cad3f5", cursor: "#8aadf4", selectionBackground: "#5b6078", black: "#494d64", red: "#ed8796", green: "#a6da95", yellow: "#eed49f", blue: "#8aadf4", magenta: "#c6a0f6", cyan: "#8bd5ca", white: "#b8c0e0", brightBlack: "#5b6078", brightRed: "#ed8796", brightGreen: "#a6da95", brightYellow: "#eed49f", brightBlue: "#8aadf4", brightMagenta: "#c6a0f6", brightCyan: "#8bd5ca", brightWhite: "#cad3f5" },
  mocha: { background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#89b4fa", selectionBackground: "#585b70", black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#cba6f7", cyan: "#94e2d5", white: "#bac2de", brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#cba6f7", brightCyan: "#94e2d5", brightWhite: "#cdd6f4" },
};

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
  onUpstreamSessionChange?: (id: string, upstreamSessionId: string, cwd?: string) => void;
  onError: (message: string) => void;
}) {
  const { themeId } = useTheme();
  const initialThemeRef = useRef(themeId);
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
    const terminal = terminalRef.current;
    if (terminal) terminal.options.theme = terminalThemes[themeId];
  }, [themeId]);
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
        theme: terminalThemes[initialThemeRef.current],
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
            cwd?: string;
            terminal?: { upstreamSessionId?: string; cwd?: string };
          };
          if (message.type === "ready") {
            sendResize();
            if (message.terminal?.upstreamSessionId) {
              onUpstreamSessionChangeRef.current?.(
                session.id,
                message.terminal.upstreamSessionId,
                message.terminal.cwd,
              );
            }
          }
          if (message.type === "upstreamSessionChanged" && message.upstreamSessionId) {
            onUpstreamSessionChangeRef.current?.(
              session.id,
              message.upstreamSessionId,
              message.cwd,
            );
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
