import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal, type ITheme } from "@xterm/xterm";
import { verifyAuth } from "../../api/auth";
import { notifyUnauthorized } from "../../api/client";
import { useTheme } from "../theme/ThemeContext";
import type { ConnectionPhase, TerminalInfo } from "../../types/terminals";
import type { ThemeId } from "../../types/settings";
import { SocketConnection } from "./socketConnection";
import { clipboardImage, runImagePaste, type ImagePastePhase } from "./runtimeImagePaste";
import { terminalThumbnailBounds, terminalThumbnailSize } from "./terminalThumbnail";

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
  visible,
  rendered = visible,
  focused,
  focusVersion,
  socketBase,
  className,
  onFocus,
  onPhaseChange,
  onRemoved,
  onUpstreamSessionChange,
  onPasteImage,
  thumbnailEnabled = false,
  thumbnailIntervalMs = 500,
  onThumbnail,
  onTransitionPrepareAvailable,
  onOpenLink,
  onError,
}: {
  session: TerminalInfo;
  visible: boolean;
  rendered?: boolean;
  focused: boolean;
  focusVersion: number;
  socketBase: string;
  className?: string;
  onFocus?: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onRemoved?: (id: string) => void;
  onUpstreamSessionChange?: (id: string, upstreamSessionId: string, cwd?: string) => void;
  onPasteImage?: (image: Blob, signal?: AbortSignal) => Promise<void>;
  thumbnailEnabled?: boolean;
  thumbnailIntervalMs?: number;
  onThumbnail?: (id: string, blob: Blob) => void;
  onTransitionPrepareAvailable?: (id: string, prepare: () => Promise<Blob | null>) => void;
  onOpenLink: (url: string) => void;
  onError: (message: string) => void;
}) {
  const { themeId } = useTheme();
  const [imagePastePhase, setImagePastePhase] = useState<ImagePastePhase>(null);
  const initialThemeRef = useRef(themeId);
  const themeIdRef = useRef(themeId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const activateRef = useRef<(() => void) | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const visibleRef = useRef(visible);
  const focusedRef = useRef(focused);
  visibleRef.current = visible;
  focusedRef.current = focused;
  const onRemovedRef = useRef(onRemoved);
  const onUpstreamSessionChangeRef = useRef(onUpstreamSessionChange);
  const onPasteImageRef = useRef(onPasteImage);
  const thumbnailEnabledRef = useRef(thumbnailEnabled);
  const thumbnailIntervalMsRef = useRef(thumbnailIntervalMs);
  const onThumbnailRef = useRef(onThumbnail);
  const onTransitionPrepareAvailableRef = useRef(onTransitionPrepareAvailable);
  const requestThumbnailRef = useRef<(() => void) | null>(null);
  const thumbnailGenerationRef = useRef(0);
  useEffect(() => {
    onRemovedRef.current = onRemoved;
    onUpstreamSessionChangeRef.current = onUpstreamSessionChange;
    onPasteImageRef.current = onPasteImage;
    onTransitionPrepareAvailableRef.current = onTransitionPrepareAvailable;
  }, [onRemoved, onUpstreamSessionChange, onPasteImage, onTransitionPrepareAvailable]);
  useEffect(() => {
    thumbnailIntervalMsRef.current = thumbnailIntervalMs;
  }, [thumbnailIntervalMs]);
  useEffect(() => {
    thumbnailEnabledRef.current = thumbnailEnabled;
    onThumbnailRef.current = onThumbnail;
    thumbnailGenerationRef.current += 1;
    if (thumbnailEnabled && onThumbnail) requestThumbnailRef.current?.();
  }, [thumbnailEnabled, onThumbnail]);
  useEffect(() => {
    if (activationFrameRef.current !== null) cancelAnimationFrame(activationFrameRef.current);
    activationFrameRef.current = null;
    if (visible) {
      activationFrameRef.current = requestAnimationFrame(() => {
        activationFrameRef.current = null;
        activateRef.current?.();
      });
    }
    if (!focused) terminalRef.current?.blur();
    return () => {
      if (activationFrameRef.current !== null) cancelAnimationFrame(activationFrameRef.current);
      activationFrameRef.current = null;
    };
  }, [visible, focused, focusVersion]);
  useEffect(() => {
    themeIdRef.current = themeId;
    const terminal = terminalRef.current;
    if (terminal) terminal.options.theme = terminalThemes[themeId];
    requestThumbnailRef.current?.();
  }, [themeId]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let protocolReady = false;
    let expectedClose = false;
    let inputBuffer = "";
    let resizeFrame: number | null = null;
    let focusFrame: number | null = null;
    let thumbnailTimer: number | null = null;
    let lastThumbnailAt = 0;
    let lastResize = "";
    let snapshotDimensions: { cols: number; rows: number } | null = null;
    const connection = new SocketConnection(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle as number),
      verifyAuth,
      notifyUnauthorized,
    );
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
        linkHandler: { activate: (_event, url) => onOpenLink(url) },
        scrollback: 5000,
        theme: terminalThemes[initialThemeRef.current],
      });
      fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container);
      try {
        terminal.loadAddon(onThumbnailRef.current ? new WebglAddon(true) : new WebglAddon());
      } catch {
        terminal.refresh(0, terminal.rows - 1);
      }
    } catch (reason) {
      onPhaseChange(session.id, "disconnected");
      onError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    terminalRef.current = terminal;
    const captureThumbnail = () => new Promise<Blob | null>((resolve) => {
      const screen = container.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) {
        resolve(null);
        return;
      }
      const layers = Array.from(screen.querySelectorAll<HTMLCanvasElement>("canvas")).filter((canvas) => canvas.width > 0 && canvas.height > 0);
      const screenRect = screen.getBoundingClientRect();
      if (!layers.length || screenRect.width <= 0 || screenRect.height <= 0) {
        resolve(null);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = terminalThumbnailSize.width;
      canvas.height = terminalThumbnailSize.height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }
      context.fillStyle = terminalThemes[themeIdRef.current].background ?? "#000";
      context.fillRect(0, 0, canvas.width, canvas.height);
      try {
        for (const layer of layers) {
          const bounds = terminalThumbnailBounds(screenRect, layer.getBoundingClientRect());
          context.drawImage(layer, bounds.x, bounds.y, bounds.width, bounds.height);
        }
      } catch {
        resolve(null);
        return;
      }
      canvas.toBlob(resolve, "image/png");
    });
    const prepareTransition = () => {
      if (visibleRef.current) {
        try {
          fit.fit();
          terminal.refresh(0, terminal.rows - 1);
        } catch {
          return Promise.resolve(null);
        }
      }
      return captureThumbnail();
    };
    onTransitionPrepareAvailableRef.current?.(session.id, prepareTransition);
    const emitThumbnail = () => {
      thumbnailTimer = null;
      const callback = onThumbnailRef.current;
      if (disposed || !thumbnailEnabledRef.current || !callback) return;
      const generation = ++thumbnailGenerationRef.current;
      void captureThumbnail().then((blob) => {
        if (!blob || disposed || !thumbnailEnabledRef.current || generation !== thumbnailGenerationRef.current) return;
        onThumbnailRef.current?.(session.id, blob);
      });
    };
    const scheduleThumbnail = () => {
      if (disposed || !thumbnailEnabledRef.current || !onThumbnailRef.current || thumbnailTimer !== null) return;
      const delay = Math.max(0, thumbnailIntervalMsRef.current - (performance.now() - lastThumbnailAt));
      thumbnailTimer = window.setTimeout(() => {
        thumbnailTimer = null;
        if (disposed || !thumbnailEnabledRef.current || !onThumbnailRef.current) return;
        lastThumbnailAt = performance.now();
        emitThumbnail();
      }, delay);
    };
    requestThumbnailRef.current = scheduleThumbnail;
    const render = terminal.onRender(scheduleThumbnail);
    const sendResize = () => {
      if (!visibleRef.current) return;
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
      if (disposed || !visibleRef.current || resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        sendResize();
      });
    };
    activateRef.current = () => {
      sendResize();
      if (focusedRef.current) terminal.focus();
    };
    const connect = () => {
      if (disposed) return;
      const started = connection.begin();
      if (!started) return;
      const { generation, phase } = started;
      protocolReady = false;
      snapshotDimensions = null;
      expectedClose = false;
      lastResize = "";
      onPhaseChange(session.id, phase);
      const socket = new WebSocket(`${socketProtocol}//${window.location.host}${socketBase}/${session.id}/socket`);
      socketRef.current = socket;
      socket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== socket) return;
        try {
          const message = JSON.parse(String(event.data)) as {
            type: string;
            data?: string;
            upstreamSessionId?: string;
            cwd?: string;
            terminal?: { upstreamSessionId?: string; cwd?: string; cols?: number; rows?: number };
          };
          if (message.type === "ready") {
            const cols = message.terminal?.cols;
            const rows = message.terminal?.rows;
            snapshotDimensions = typeof cols === "number" && typeof rows === "number" ? { cols, rows } : null;
            scheduleThumbnail();
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
          if (message.type === "snapshot" && connection.snapshot(generation)) {
            terminal.reset();
            const dimensions = snapshotDimensions;
            snapshotDimensions = null;
            if (dimensions) terminal.resize(dimensions.cols, dimensions.rows);
            const finishSnapshot = () => {
              if (disposed || socketRef.current !== socket) return;
              protocolReady = true;
              onPhaseChange(session.id, "connected");
              sendResize();
              scheduleThumbnail();
              if (inputBuffer) {
                socket.send(JSON.stringify({ type: "input", data: inputBuffer }));
                inputBuffer = "";
              }
              if (focusedRef.current) {
                if (focusFrame !== null) cancelAnimationFrame(focusFrame);
                focusFrame = requestAnimationFrame(() => {
                  focusFrame = null;
                  if (!disposed && socketRef.current === socket) terminal.focus();
                });
              }
            };
            if (message.data) terminal.write(message.data, finishSnapshot);
            else finishSnapshot();
          }
          if (message.type === "output" && message.data) terminal.write(message.data, scheduleThumbnail);
          if (message.type === "exit" || message.type === "processExited") {
            onPhaseChange(session.id, "exited");
            expectedClose = true;
            connection.stop();
            if (!onRemovedRef.current) socket.close(1000, "process exited");
          }
          if (message.type === "removed") {
            disposed = true;
            expectedClose = true;
            connection.stop();
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
        if (expectedClose) return;
        const action = connection.close(generation, event.code, connect);
        if (action !== "ignored") onPhaseChange(session.id, "disconnected");
      });
    };
    const input = terminal.onData((data) => {
      const socket = socketRef.current;
      if (protocolReady && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
      else inputBuffer = (inputBuffer + data).slice(-64 * 1024);
    });
    let pasteInProgress = false;
    let pasteController: AbortController | null = null;
    const paste = (event: ClipboardEvent) => {
      const pasteImage = onPasteImageRef.current;
      if (!pasteImage) return;
      const image = clipboardImage(event);
      if (!image) return;
      event.preventDefault();
      event.stopPropagation();
      if (pasteInProgress) return;
      pasteInProgress = true;
      pasteController = new AbortController();
      void runImagePaste(
        image,
        pasteImage,
        (phase) => { if (!disposed) setImagePastePhase(phase); },
        pasteController,
      )
        .catch((reason) => {
          if (!disposed) onError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          pasteInProgress = false;
          pasteController = null;
        });
    };
    container.addEventListener("paste", paste, true);
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(container);
    void document.fonts.ready.then(() => {
      if (!disposed && visibleRef.current) scheduleResize();
    });
    connect();
    if (visibleRef.current) {
      focusFrame = requestAnimationFrame(() => {
        focusFrame = null;
        if (!disposed) activateRef.current?.();
      });
    }
    return () => {
      pasteController?.abort();
      setImagePastePhase(null);
      disposed = true;
      connection.stop();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (focusFrame !== null) cancelAnimationFrame(focusFrame);
      if (thumbnailTimer !== null) window.clearTimeout(thumbnailTimer);
      thumbnailGenerationRef.current += 1;
      observer.disconnect();
      container.removeEventListener("paste", paste, true);
      input.dispose();
      render.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "surface closed");
      terminal.dispose();
      terminalRef.current = null;
      activateRef.current = null;
      requestThumbnailRef.current = null;
      onTransitionPrepareAvailableRef.current?.(session.id, () => Promise.resolve(null));
    };
  }, [session.id, socketBase, onPhaseChange, onOpenLink, onError]);
  return (
    <div
      className={`terminal-surface ${rendered ? "active" : ""} ${focused ? "focused" : ""} ${className ?? ""}`}
      onPointerDown={onFocus}
    >
      <div ref={containerRef} className="terminal-xterm-host" />
      {imagePastePhase && (
        <div className="terminal-image-paste-status" role="status" aria-live="polite">
          <LoaderCircle className="spin" />
          {imagePastePhase === "preparing" ? "Preparing image…" : "Pasting image…"}
        </div>
      )}
    </div>
  );
}
