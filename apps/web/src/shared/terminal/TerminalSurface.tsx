import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { verifyAuth } from "../../api/auth";
import { notifyUnauthorized } from "../../api/client";
import { useTheme } from "../theme/ThemeContext";
import type { AgentActivity } from "../../types/agents";
import type { ConnectionPhase } from "../../types/terminals";
import type { WorkspaceSession } from "../../types/workspaces";
import { shouldCopyTerminalSelection, SocketConnection, terminalKeyInput, terminalSocketPath } from "./socketConnection";
import { loadTerminalFonts } from "./terminalFonts";
import { registerTerminalClipboardHandler, registerTerminalSnapshotReplayHandlers, TerminalSnapshotReplayGuard, TerminalWriteQueue } from "./terminalWriteQueue";
import { clipboardImage, runImagePaste, type ImagePastePhase } from "./runtimeImagePaste";
import { TerminalThumbnailCaptureState, terminalThumbnailBounds, terminalThumbnailSize } from "./terminalThumbnail";
import { applyTerminalTheme, terminalThemes } from "./terminalThemes";

const socketProtocol = () => window.location.protocol === "https:" ? "wss:" : "ws:";

function refreshTerminalRenderer(
  terminal: Pick<Terminal, "clearTextureAtlas" | "refresh" | "rows">,
  fit: Pick<FitAddon, "fit">,
) {
  fit.fit();
  terminal.clearTextureAtlas();
  terminal.refresh(0, Math.max(0, terminal.rows - 1));
}

function loadTerminalWebglRenderer(
  terminal: Pick<Terminal, "loadAddon" | "refresh" | "rows">,
  createAddon: () => WebglAddon,
) {
  let addon: WebglAddon | null = null;
  try {
    addon = createAddon();
    terminal.loadAddon(addon);
    addon.onContextLoss(() => {
      addon?.dispose();
      addon = null;
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
    });
    return true;
  } catch {
    addon?.dispose();
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
    return false;
  }
}

export function TerminalSurface({
  session,
  phaseKey = session.id,
  visible,
  rendered = visible,
  focused,
  focusVersion,
  socketBase,
  className,
  onFocus,
  onPhaseChange,
  onAgentActivity,
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
  session: WorkspaceSession;
  phaseKey?: string;
  visible: boolean;
  rendered?: boolean;
  focused: boolean;
  focusVersion: number;
  socketBase: string;
  className?: string;
  onFocus?: () => void;
  onPhaseChange: (id: string, phase: ConnectionPhase) => void;
  onAgentActivity?: (id: string, activity: AgentActivity) => void;
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
  const { themeId, fontSizePx } = useTheme();
  const agentId = session.kind === "agent" ? session.agentId : null;
  const [imagePastePhase, setImagePastePhase] = useState<ImagePastePhase>(null);
  const initialThemeRef = useRef(themeId);
  const initialFontSizeRef = useRef(fontSizePx);
  const themeIdRef = useRef(themeId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const activateRef = useRef<(() => void) | null>(null);
  const activationFrameRef = useRef<number | null>(null);
  const fontUpdateFrameRef = useRef<number | null>(null);
  const visibleRef = useRef(visible);
  const focusedRef = useRef(focused);
  visibleRef.current = visible;
  focusedRef.current = focused;
  const onRemovedRef = useRef(onRemoved);
  const onAgentActivityRef = useRef(onAgentActivity);
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
    onAgentActivityRef.current = onAgentActivity;
    onUpstreamSessionChangeRef.current = onUpstreamSessionChange;
    onPasteImageRef.current = onPasteImage;
    onTransitionPrepareAvailableRef.current = onTransitionPrepareAvailable;
  }, [onRemoved, onAgentActivity, onUpstreamSessionChange, onPasteImage, onTransitionPrepareAvailable]);
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
    const terminal = terminalRef.current;
    if (terminal) terminal.options.screenReaderMode = visible;
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
    if (terminal) applyTerminalTheme(terminal, themeId);
    requestThumbnailRef.current?.();
  }, [themeId]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || terminal.options.fontSize === fontSizePx) return;
    terminal.options.fontSize = fontSizePx;
    terminal.clearTextureAtlas();
    if (fontUpdateFrameRef.current !== null) cancelAnimationFrame(fontUpdateFrameRef.current);
    fontUpdateFrameRef.current = requestAnimationFrame(() => {
      fontUpdateFrameRef.current = null;
      if (terminalRef.current !== terminal) return;
      activateRef.current?.();
      terminal.refresh(0, terminal.rows - 1);
      requestThumbnailRef.current?.();
    });
    return () => {
      if (fontUpdateFrameRef.current !== null) cancelAnimationFrame(fontUpdateFrameRef.current);
      fontUpdateFrameRef.current = null;
    };
  }, [fontSizePx]);
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
    const thumbnailCapture = new TerminalThumbnailCaptureState();
    let lastResize = "";
    let snapshotDimensions: { cols: number; rows: number } | null = null;
    const connection = new SocketConnection(
      (callback, delay) => window.setTimeout(callback, delay),
      (handle) => window.clearTimeout(handle as number),
      verifyAuth,
      notifyUnauthorized,
    );
    const terminalFontFamily = getComputedStyle(document.documentElement).getPropertyValue("--font-family-mono").trim()
      || '"JetBrainsMono Nerd Font Web", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Noto Sans Mono", "Courier New", monospace';
    let terminal: Terminal;
    let fit: FitAddon;
    try {
      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: "monospace",
        fontSize: initialFontSizeRef.current,
        fontWeight: "normal",
        fontWeightBold: "bold",
        lineHeight: 1,
        linkHandler: { activate: (_event, url) => onOpenLink(url) },
        macOptionClickForcesSelection: true,
        screenReaderMode: visibleRef.current,
        scrollback: 5000,
        theme: terminalThemes[initialThemeRef.current],
      });
      fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container);
      terminal.attachCustomKeyEventHandler((event) => {
        if (shouldCopyTerminalSelection(terminal.hasSelection(), event)) return false;
        const data = terminalKeyInput(agentId, event);
        if (!data) return true;
        terminal.input(data, false);
        event.preventDefault();
        return false;
      });
      loadTerminalWebglRenderer(
        terminal,
        () => onThumbnailRef.current ? new WebglAddon(true) : new WebglAddon(),
      );
    } catch (reason) {
      onPhaseChange(phaseKey, "disconnected");
      onError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    terminalRef.current = terminal;
    const snapshotReplayGuard = new TerminalSnapshotReplayGuard();
    const snapshotReplayHandlers = registerTerminalSnapshotReplayHandlers(terminal.parser, snapshotReplayGuard);
    const clipboardHandler = agentId === "opencode" ? registerTerminalClipboardHandler(
      terminal.parser,
      snapshotReplayGuard,
      () => visibleRef.current
        && focusedRef.current
        && window.isSecureContext
        && document.hasFocus()
        && Boolean(navigator.clipboard),
      (text) => navigator.clipboard.writeText(text),
    ) : null;
    const terminalWriter = new TerminalWriteQueue(
      (data, onComplete) => terminal.write(data, onComplete),
      (generation) => {
        if (!connection.isCurrent(generation)) return;
        protocolReady = false;
        const socket = socketRef.current;
        if (socket?.readyState !== WebSocket.OPEN) return;
        socket.close(4001, "terminal output resync required");
      },
    );
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
    onTransitionPrepareAvailableRef.current?.(phaseKey, prepareTransition);
    const emitThumbnail = () => {
      thumbnailTimer = null;
      const callback = onThumbnailRef.current;
      if (disposed || !thumbnailEnabledRef.current || !callback || !thumbnailCapture.start()) return;
      const generation = ++thumbnailGenerationRef.current;
      void captureThumbnail()
        .then((blob) => {
          if (!blob || disposed || !thumbnailEnabledRef.current || generation !== thumbnailGenerationRef.current) return;
          onThumbnailRef.current?.(phaseKey, blob);
        })
        .finally(() => {
          if (thumbnailCapture.finish()) scheduleThumbnail();
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
    const hasRenderableSize = () => {
      const bounds = container.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    };
    const sendDimensions = () => {
      const socket = socketRef.current;
      const dimensions = `${terminal.cols}x${terminal.rows}`;
      if (protocolReady && socket?.readyState === WebSocket.OPEN && dimensions !== lastResize) {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        lastResize = dimensions;
      }
    };
    const sendResize = () => {
      if (!visibleRef.current || !hasRenderableSize()) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      sendDimensions();
    };
    const recoverRenderer = () => {
      if (!visibleRef.current || !hasRenderableSize()) return;
      try {
        refreshTerminalRenderer(terminal, fit);
      } catch {
        return;
      }
      sendDimensions();
    };
    const scheduleResize = () => {
      if (disposed || !visibleRef.current || resizeFrame !== null) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        sendResize();
      });
    };
    activateRef.current = () => {
      recoverRenderer();
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
      terminalWriter.begin(generation);
      onPhaseChange(phaseKey, phase);
      const socket = new WebSocket(`${socketProtocol()}//${window.location.host}${terminalSocketPath(socketBase, session.id)}`);
      socketRef.current = socket;
      socket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== socket) return;
        try {
          const message = JSON.parse(String(event.data)) as {
            type: string;
            data?: string;
            upstreamSessionId?: string;
            cwd?: string;
            activity?: AgentActivity;
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
          if (message.type === "agentActivity" && message.activity) {
            onAgentActivityRef.current?.(session.id, message.activity);
          }
          if (message.type === "snapshot" && connection.snapshot(generation)) {
            const dimensions = snapshotDimensions;
            snapshotDimensions = null;
            if (dimensions) terminal.resize(dimensions.cols, dimensions.rows);
            terminalWriter.snapshot(generation, message.data ?? "", () => {
              if (
                disposed
                || socketRef.current !== socket
                || socket.readyState !== WebSocket.OPEN
                || !connection.isCurrent(generation)
              ) return;
              protocolReady = true;
              onPhaseChange(phaseKey, "connected");
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
                  if (!disposed && socketRef.current === socket && connection.isCurrent(generation)) terminal.focus();
                });
              }
            }, {
              onStart: () => snapshotReplayGuard.begin(generation),
              onSettled: () => snapshotReplayGuard.end(generation),
            });
          }
          if (message.type === "output" && message.data) {
            terminalWriter.write(generation, message.data, () => {
              if (connection.isCurrent(generation)) scheduleThumbnail();
            });
          }
          if (message.type === "exit" || message.type === "processExited") {
            onPhaseChange(phaseKey, "exited");
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
        if (action !== "ignored") onPhaseChange(phaseKey, "disconnected");
      });
    };
    const input = terminal.onData((data) => {
      if (snapshotReplayGuard.suppress(data)) return;
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
    void loadTerminalFonts(document.fonts).then(() => {
      if (disposed) return;
      terminal.options.fontFamily = terminalFontFamily;
      terminal.clearTextureAtlas();
      if (visibleRef.current) sendResize();
      terminal.refresh(0, terminal.rows - 1);
    }).catch(() => undefined);
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
      if (fontUpdateFrameRef.current !== null) cancelAnimationFrame(fontUpdateFrameRef.current);
      fontUpdateFrameRef.current = null;
      if (thumbnailTimer !== null) window.clearTimeout(thumbnailTimer);
      thumbnailCapture.reset();
      thumbnailGenerationRef.current += 1;
      observer.disconnect();
      container.removeEventListener("paste", paste, true);
      input.dispose();
      render.dispose();
      clipboardHandler?.dispose();
      snapshotReplayHandlers.dispose();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "surface closed");
      terminalWriter.dispose();
      terminal.dispose();
      terminalRef.current = null;
      activateRef.current = null;
      requestThumbnailRef.current = null;
      onTransitionPrepareAvailableRef.current?.(phaseKey, () => Promise.resolve(null));
    };
  }, [session.id, agentId, phaseKey, socketBase, onPhaseChange, onOpenLink, onError]);
  return (
    <div
      className={`terminal-surface ${rendered ? "active" : ""} ${className ?? ""}`}
      onFocusCapture={onFocus}
      onPointerDown={onFocus}
    >
      <div ref={containerRef} className="terminal-xterm-host" />
      {imagePastePhase && (
        <div className="terminal-image-paste-status tw:pointer-events-none tw:absolute tw:top-[12px] tw:right-[14px] tw:z-[4] tw:flex tw:items-center tw:gap-[7px] tw:rounded-[99px] tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface-raised)_92%,transparent)] tw:px-[10px] tw:py-[7px] tw:font-mono tw:text-[calc(10px*var(--app-font-scale))] tw:font-normal tw:leading-none tw:text-muted-foreground tw:shadow-[0_6px_18px_rgb(0_0_0/12%)] tw:backdrop-blur-[8px]" role="status" aria-live="polite">
          <LoaderCircle className="spin tw:size-[13px]" />
          {imagePastePhase === "preparing" ? "Preparing image…" : "Pasting image…"}
        </div>
      )}
    </div>
  );
}
