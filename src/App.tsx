import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderOpen,
  Globe2,
  Grid2X2,
  HardDrive,
  Home,
  Menu,
  PanelLeftClose,
  Pencil,
  Pin,
  Play,
  Plus,
  Search,
  Settings,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import codexIcon from './assets/codex.svg'
import opencodeIcon from './assets/opencode.svg'
import './App.css'

type TerminalInfo = {
  id: string
  name: string
  cwd: string
  shell: string
  status: 'running' | 'exited'
  cols: number
  rows: number
  createdAt: number
  updatedAt: number
  exitCode: number | null
}

type AgentSession = TerminalInfo & {
  agentId: string
  agentName: string
  kind: string
  upstreamSessionId?: string
}

type Agent = {
  id: string
  name: string
  kind: string
  available: boolean
  enabled: boolean
  availability: 'available' | 'unavailable' | 'coming-soon'
  diagnostic?: string | null
  launchConfigCount: number
  defaultLaunchConfigId: string | null
}

type AgentLaunchPath = { id: string; agentId: string; path: string; alias: string | null; pinned: boolean; lastUsedAt: number; createdAt: number; updatedAt: number }
type HistorySession = { id: string; title: string; directory: string; projectId: string; projectName: string | null; projectWorktree: string | null; timeCreated: number; timeUpdated: number; presence: 'active-here' | 'possibly-active-elsewhere' | 'inactive' }
type HistoryResponse = { available: boolean; diagnostic: string | null; sessions: HistorySession[] }
type ConfirmAction = { title: string; description: string; confirmLabel: string; danger?: boolean; action: () => Promise<void> }

type ConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'exited'
type DetailMode = 'terminal' | 'agent' | 'settings'
type RailPage = 'modes' | DetailMode
type WorkspaceMode = DetailMode
type RailMotion = 'forward' | 'return' | null
type DirectoryListing = {
  path: string
  parent: string | null
  home: string
  resolvedHome: string
  directories: { name: string; path: string }[]
}

type DeleteTarget = {
  id: string
  name: string
  cwd: string
  kind: 'terminal' | 'agent session'
}

const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

async function requestJson<T>(url: string, options?: RequestInit, fallback = 'Request failed') {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
    throw new Error(body?.message || body?.error || fallback)
  }
  return response.json() as Promise<T>
}

async function listDirectories(directory?: string) {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : ''
  return requestJson<DirectoryListing>(`/api/filesystem/directories${query}`, undefined, 'Unable to open this folder')
}

async function createTerminal(cwd?: string) {
  return requestJson<{ terminal: TerminalInfo }>('/api/terminals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd }),
  }, 'Unable to create terminal session')
}

async function createAgentSession(options: { cwd?: string; upstreamSessionId?: string }) {
  return requestJson<{ agentSession: AgentSession }>('/api/agent-sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(options),
  }, 'Unable to launch agent session')
}

async function renameRemoteSession(route: string, id: string, name: string) {
  return requestJson<Record<string, TerminalInfo | AgentSession>>(`${route}/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }, 'Unable to rename session')
}

async function deleteRemoteSession(route: string, id: string) {
  const response = await fetch(`${route}/${id}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error('Unable to close session')
}

function formatUptime(createdAt: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

function logicalPath(value: string, home?: string, resolvedHome?: string) {
  if (!home || !resolvedHome) return value
  if (value === resolvedHome) return home
  if (value.startsWith(`${resolvedHome}/`)) return `${home}${value.slice(resolvedHome.length)}`
  return value
}

function displayPath(value: string, home?: string, resolvedHome?: string) {
  for (const root of [home, resolvedHome]) {
    if (!root) continue
    if (value === root) return '~'
    if (value.startsWith(`${root}/`)) return `~${value.slice(root.length)}`
  }
  return value
}

function workspaceName(workspace: string) {
  return workspace.split('/').filter(Boolean).pop() || workspace
}

function uniquePaths(sessions: TerminalInfo[]) {
  return [...new Set(sessions.map((session) => session.cwd))]
}

function AgentIcon({ id, className }: { id?: string; className?: string }) {
  const icon = id === 'codex' ? codexIcon : opencodeIcon
  return <img className={className} src={icon} alt="" aria-hidden="true" />
}

function DevHatchLogo() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="devhatch-ring" cx="20" cy="20" r="10.2" gradientUnits="userSpaceOnUse"><stop stopColor="#0e0e0e"/><stop offset=".65" stopColor="#1a1a1a"/><stop offset="1" stopColor="#323232"/></radialGradient>
        <radialGradient id="devhatch-yao" cx="20" cy="20" r="13.4" gradientUnits="userSpaceOnUse"><stop stopColor="#202020"/><stop offset="1" stopColor="#343431"/></radialGradient>
        <radialGradient id="devhatch-center" cx="20" cy="20" r="1.4" gradientUnits="userSpaceOnUse"><stop stopColor="white" stopOpacity=".2"/><stop offset="1" stopColor="white"/></radialGradient>
        <mask id="devhatch-soften"><rect width="40" height="40" fill="white"/><circle cx="20" cy="20" r="1.4" fill="url(#devhatch-center)"/></mask>
      </defs>
      <g mask="url(#devhatch-soften)"><path d="M20 23.05V20l2.57-1.48M22.57 18.52 20 20l-2.57-1.48M17.43 18.52 20 20v3.05" stroke="url(#devhatch-yao)" strokeWidth="2.65" strokeLinecap="round" strokeLinejoin="round"/><path d="M20.7 23.05 20.18 33.3a.22.22 0 0 1-.44 0l-.44-10.25Z" fill="url(#devhatch-yao)"/><path d="m22.18 17.84 9.45-4.78a.22.22 0 0 1 .22.38l-9.27 6.05Z" fill="url(#devhatch-yao)"/><path d="m17.42 19.49-9.27-6.05a.22.22 0 0 1 .22-.38l9.45 4.78Z" fill="url(#devhatch-yao)"/></g>
      <circle cx="20" cy="20" r="9.77" fill="none" stroke="url(#devhatch-ring)" strokeWidth="1.35" strokeLinecap="round" strokeDasharray="17.39 3.07" transform="rotate(-21 20 20)"/>
    </svg>
  )
}

function TerminalSurface({ session, active, focusVersion, socketBase, onPhaseChange, onRemoved, onError }: { session: TerminalInfo; active: boolean; focusVersion: number; socketBase: string; onPhaseChange: (id: string, phase: ConnectionPhase) => void; onRemoved?: (id: string) => void; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const activateRef = useRef<(() => void) | null>(null)
  const retryRef = useRef<number | null>(null)
  const activeRef = useRef(active)
  const onRemovedRef = useRef(onRemoved)

  useEffect(() => { onRemovedRef.current = onRemoved }, [onRemoved])
  useEffect(() => {
    activeRef.current = active
    if (active) requestAnimationFrame(() => activateRef.current?.())
    else terminalRef.current?.blur()
  }, [active, focusVersion])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let attempt = 0
    let protocolReady = false
    let inputBuffer = ''
    let resizeFrame: number | null = null
    let lastResize = ''
    let terminal: Terminal
    let fit: FitAddon
    try {
      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: '"JetBrainsMono Nerd Font Web", monospace',
        fontSize: 13,
        fontWeight: 'normal',
        fontWeightBold: 'bold',
        lineHeight: 1,
        scrollback: 5000,
        theme: {
          background: '#ffffff', foreground: '#1d1d1f', cursor: '#0071e3', selectionBackground: '#cce4ff',
          black: '#1d1d1f', red: '#d70015', green: '#16803c', yellow: '#9a6700', blue: '#0066cc', magenta: '#8944ab', cyan: '#007c91', white: '#f5f5f7',
          brightBlack: '#6e6e73', brightRed: '#ff3b30', brightGreen: '#34c759', brightYellow: '#ffcc00', brightBlue: '#0a84ff', brightMagenta: '#bf5af2', brightCyan: '#64d2ff', brightWhite: '#ffffff',
        },
      })
      fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(container)
      try { terminal.loadAddon(new WebglAddon()) } catch { terminal.refresh(0, terminal.rows - 1) }
    } catch (reason) {
      onPhaseChange(session.id, 'disconnected')
      onError(reason instanceof Error ? reason.message : String(reason))
      return
    }
    terminalRef.current = terminal

    const sendResize = () => {
      if (!activeRef.current) return
      try { fit.fit() } catch { return }
      const socket = socketRef.current
      const dimensions = `${terminal.cols}x${terminal.rows}`
      if (protocolReady && socket?.readyState === WebSocket.OPEN && dimensions !== lastResize) {
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
        lastResize = dimensions
      }
    }
    const scheduleResize = () => {
      if (resizeFrame !== null) return
      resizeFrame = requestAnimationFrame(() => { resizeFrame = null; sendResize() })
    }
    activateRef.current = () => { sendResize(); terminal.focus() }
    const connect = () => {
      if (disposed) return
      protocolReady = false
      lastResize = ''
      onPhaseChange(session.id, attempt ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(`${socketProtocol}//${window.location.host}${socketBase}/${session.id}/socket`)
      socketRef.current = socket
      socket.addEventListener('open', () => { if (!disposed && socketRef.current === socket) attempt = 0 })
      socket.addEventListener('message', (event) => {
        if (disposed || socketRef.current !== socket) return
        try {
          const message = JSON.parse(String(event.data)) as { type: string; data?: string }
          if (message.type === 'ready') sendResize()
          if (message.type === 'snapshot') {
            terminal.reset()
            if (message.data) terminal.write(message.data)
            protocolReady = true
            onPhaseChange(session.id, 'connected')
            sendResize()
            if (inputBuffer) { socket.send(JSON.stringify({ type: 'input', data: inputBuffer })); inputBuffer = '' }
            if (activeRef.current) requestAnimationFrame(() => terminal.focus())
          }
           if (message.type === 'output' && message.data) terminal.write(message.data)
            if (message.type === 'exit' || message.type === 'processExited') {
              onPhaseChange(session.id, 'exited')
              if (!onRemovedRef.current) { disposed = true; socket.close(1000, 'process exited') }
            }
            if (message.type === 'removed') { disposed = true; if (retryRef.current) window.clearTimeout(retryRef.current); onRemovedRef.current?.(session.id); socket.close(1000, 'removed') }
        } catch { return }
      })
      socket.addEventListener('close', (event) => {
        if (disposed || socketRef.current !== socket) return
        protocolReady = false
        socketRef.current = null
        if (event.code === 1000) return
        onPhaseChange(session.id, 'disconnected')
        retryRef.current = window.setTimeout(connect, Math.min(500 * 2 ** attempt++, 5000))
      })
    }
    const input = terminal.onData((data) => {
      const socket = socketRef.current
      if (protocolReady && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
      else inputBuffer = (inputBuffer + data).slice(-64 * 1024)
    })
    const observer = new ResizeObserver(scheduleResize)
    observer.observe(container)
    void document.fonts.ready.then(() => { if (!disposed && activeRef.current) scheduleResize() })
    connect()
    if (activeRef.current) requestAnimationFrame(() => activateRef.current?.())
    return () => {
      disposed = true
      if (retryRef.current) window.clearTimeout(retryRef.current)
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      input.dispose()
      const socket = socketRef.current
      socketRef.current = null
      socket?.close(1000, 'surface closed')
      terminal.dispose()
      terminalRef.current = null
      activateRef.current = null
    }
  }, [session.id, socketBase, onPhaseChange, onError])

  return <div ref={containerRef} className={`terminal-surface ${active ? 'active' : ''}`} />
}

function WorkspacePicker({ initialPath, purpose, onClose, onSelect }: { initialPath?: string; purpose: 'workspace' | 'agent'; onClose: () => void; onSelect: (path: string) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const launch = purpose === 'agent'
  const openDirectory = useCallback(async (directory?: string) => {
    setLoading(true)
    setPickerError(null)
    try { setListing(await listDirectories(directory)) }
    catch (reason) { setPickerError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void openDirectory(initialPath) }, [initialPath, openDirectory])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const breadcrumbs = useMemo(() => {
    if (!listing) return []
    const homeRoot = [listing.home, listing.resolvedHome].find((root) => listing.path === root || listing.path.startsWith(`${root}/`))
    if (homeRoot) {
      const parts = listing.path.slice(homeRoot.length).split('/').filter(Boolean)
      return [{ name: '~', path: homeRoot }, ...parts.map((name, index) => ({ name, path: `${homeRoot}/${parts.slice(0, index + 1).join('/')}` }))]
    }
    const parts = listing.path.split('/').filter(Boolean)
    return [{ name: '/', path: '/' }, ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))]
  }, [listing])

  return (
    <div className="picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="folder-picker" role="dialog" aria-modal="true" aria-labelledby="folder-picker-title" tabIndex={-1}>
        <header className="picker-header"><div className="picker-title-icon"><FolderOpen/></div><div><h2 id="folder-picker-title">{launch ? 'Launch Agent' : 'Add Workspace'}</h2><p>Choose a folder on this machine</p></div><button className="picker-close" aria-label="Close" onClick={onClose}><X/></button></header>
        <div className="picker-toolbar"><button className="picker-location" disabled={!listing?.parent} onClick={() => void openDirectory(listing?.parent ?? undefined)}><ArrowLeft/><span>Up</span></button><button className="picker-location" onClick={() => void openDirectory(listing?.home)}><Home/><span>Home</span></button><button className="picker-location" onClick={() => void openDirectory('/')}><HardDrive/><span>Root</span></button></div>
        <nav className="picker-breadcrumbs" aria-label="Current folder">{breadcrumbs.map((crumb, index) => <span key={crumb.path}><button onClick={() => void openDirectory(crumb.path)}>{crumb.name}</button>{index < breadcrumbs.length - 1 && <ChevronRight/>}</span>)}</nav>
        <div className="picker-browser">
          {loading && <div className="picker-message"><span className="picker-spinner"/>Loading folders…</div>}
          {!loading && pickerError && <div className="picker-message error"><strong>{pickerError}</strong><button onClick={() => void openDirectory(listing?.path ?? initialPath)}>Try again</button></div>}
          {!loading && !pickerError && listing?.directories.length === 0 && <div className="picker-message"><FolderOpen/><strong>This folder has no subfolders</strong><span>You can still select the current folder.</span></div>}
          {!loading && !pickerError && listing?.directories.map((directory) => <button key={directory.path} className="folder-row" onClick={() => void openDirectory(directory.path)}><span className="folder-icon"><Folder/></span><span><strong>{directory.name}</strong><small>{displayPath(directory.path, listing.home, listing.resolvedHome)}</small></span><ChevronRight/></button>)}
        </div>
        <footer className="picker-footer"><div className="picker-selection"><span>Selected folder</span><strong>{listing ? displayPath(listing.path, listing.home, listing.resolvedHome) : 'No folder selected'}</strong></div><button className="picker-cancel" onClick={onClose}>Cancel</button><button className="picker-confirm" disabled={!listing || loading || !!pickerError} onClick={() => listing && onSelect(listing.path)}>{launch ? 'Launch Session' : 'Add Workspace'}</button></footer>
      </div>
    </div>
  )
}

function DeleteSessionDialog({ target, deleting, onCancel, onConfirm }: { target: DeleteTarget; deleting: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !deleting) onCancel() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleting, onCancel])
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) onCancel() }}>
      <div className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title"><div className="delete-dialog-icon"><X/></div><div className="delete-dialog-copy"><h2 id="delete-dialog-title">Close {target.kind}?</h2><p>This will stop the running process and close <strong>{target.name}</strong>. OpenCode history will be preserved.</p><span>{target.cwd}</span></div><div className="delete-dialog-actions"><button ref={cancelRef} className="dialog-cancel" disabled={deleting} onClick={onCancel}>Cancel</button><button className="dialog-delete" disabled={deleting} onClick={onConfirm}>{deleting ? 'Closing…' : `Close ${target.kind}`}</button></div></div>
    </div>
  )
}

function SessionTabs({ sessions, activeId, phases, label, onActivate, onRename, onClose }: { sessions: TerminalInfo[]; activeId: string | null; phases: Record<string, ConnectionPhase>; label: string; onActivate: (id: string) => void; onRename: (session: TerminalInfo) => void; onClose: (session: TerminalInfo) => void }) {
  return <div className="tabbar"><div className="tabs">{sessions.map((session, index) => <button key={session.id} className={`tab ${session.id === activeId ? 'active' : ''}`} onClick={() => onActivate(session.id)}><span className={`tab-dot ${phases[session.id] ?? 'connecting'}`}/><span className="tab-name">{session.name || `${label} ${index + 1}`}</span><span className="tab-actions"><span className="tab-action" role="button" tabIndex={0} aria-label={`Rename ${session.name}`} onClick={(event) => { event.stopPropagation(); onRename(session) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onRename(session) } }}><Pencil/></span><span className="tab-action" role="button" tabIndex={0} aria-label={`Close ${session.name}`} onClick={(event) => { event.stopPropagation(); onClose(session) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onClose(session) } }}><X/></span></span></button>)}</div></div>
}

function Statusbar({ session, phase }: { session: TerminalInfo | null; phase?: ConnectionPhase }) {
  return <footer className="statusbar"><span className={`status-light ${session ? phase ?? 'connecting' : 'disconnected'}`}/><span>{session ? phase ?? 'connecting' : 'No session'}</span><span className="status-path">{session?.shell ?? ''}</span>{session && <><span>{session.cols} × {session.rows}</span><span>uptime {formatUptime(session.createdAt)}</span></>}</footer>
}

function CustomSelect<T extends { id: string }>({ label, value, options, disabled, compact, renderTrigger, renderOption, isOptionDisabled, onChange }: { label: string; value: string | null; options: T[]; disabled?: boolean; compact?: boolean; renderTrigger: (option: T | undefined) => ReactNode; renderOption: (option: T) => ReactNode; isOptionDisabled?: (option: T) => boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const selected = options.find((option) => option.id === value)
  const enabledIndexes = options.map((option, index) => isOptionDisabled?.(option) ? -1 : index).filter((index) => index >= 0)
  const openMenu = () => { if (!disabled) { const index = options.findIndex((option) => option.id === value && !isOptionDisabled?.(option)); setHighlighted(index >= 0 ? index : enabledIndexes[0] ?? 0); setOpen(true) } }
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!hostRef.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const move = (direction: 1 | -1) => {
    if (!enabledIndexes.length) return
    const current = enabledIndexes.indexOf(highlighted)
    setHighlighted(enabledIndexes[(current + direction + enabledIndexes.length) % enabledIndexes.length])
  }
  const keyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) openMenu(); else move(event.key === 'ArrowDown' ? 1 : -1); return }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); if (!open) openMenu(); setHighlighted(event.key === 'Home' ? enabledIndexes[0] ?? 0 : enabledIndexes.at(-1) ?? 0); return }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!open) openMenu(); else { const option = options[highlighted]; if (option && !isOptionDisabled?.(option)) { onChange(option.id); setOpen(false); triggerRef.current?.focus() } } }
  }
  return <div ref={hostRef} className={`custom-select ${compact ? 'compact' : ''} ${open ? 'open' : ''}`} onKeyDown={keyDown}><button ref={triggerRef} type="button" className="custom-select-trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${label.replace(/\s/g, '-')}-listbox`} disabled={disabled} onClick={() => open ? setOpen(false) : openMenu()}>{renderTrigger(selected)}<ChevronDown/></button>{open && <div id={`${label.replace(/\s/g, '-')}-listbox`} className="custom-select-menu" role="listbox" aria-label={label}>{options.map((option, index) => <button type="button" key={option.id} role="option" aria-selected={option.id === value} aria-disabled={isOptionDisabled?.(option) || undefined} disabled={isOptionDisabled?.(option)} className={`custom-select-option ${index === highlighted ? 'highlighted' : ''} ${option.id === value ? 'selected' : ''}`} onMouseEnter={() => !isOptionDisabled?.(option) && setHighlighted(index)} onClick={() => { onChange(option.id); setOpen(false); triggerRef.current?.focus() }}>{renderOption(option)}<Check className="option-check"/></button>)}</div>}</div>
}

function ActionDialog({ action, busy, onClose }: { action: ConfirmAction; busy: boolean; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => { cancelRef.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key) }, [busy, onClose])
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><div className="action-dialog" role="alertdialog" aria-modal="true" aria-labelledby="action-title"><h2 id="action-title">{action.title}</h2><p>{action.description}</p><div className="dialog-buttons"><button ref={cancelRef} disabled={busy} onClick={onClose}>Cancel</button><button className={action.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => void action.action()}>{busy ? 'Working…' : action.confirmLabel}</button></div></div></div>
}

function App() {
  const [sessions, setSessions] = useState<TerminalInfo[]>([])
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [focusVersion, setFocusVersion] = useState(0)
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [agentPaths, setAgentPaths] = useState<AgentLaunchPath[]>([])
  const [history, setHistory] = useState<HistoryResponse>({ available: false, diagnostic: null, sessions: [] })
  const [pathDisplay, setPathDisplay] = useState<'folder' | 'full'>(() => localStorage.getItem('devhatch-agent-path-display') === 'full' ? 'full' : 'folder')
  const [pathPage, setPathPage] = useState(1)
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessionListScrolling, setSessionListScrolling] = useState(false)
  const [renamePath, setRenamePath] = useState<AgentLaunchPath | null>(null)
  const [renameAlias, setRenameAlias] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [homePaths, setHomePaths] = useState<{ home: string; resolvedHome: string } | null>(null)
  const [phases, setPhases] = useState<Record<string, ConnectionPhase>>({})
  const [railPage, setRailPage] = useState<RailPage>('modes')
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('terminal')
  const [railMotion, setRailMotion] = useState<RailMotion>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('devhatch-sidebar-hidden') === '1')
  const [confirmDelete, setConfirmDelete] = useState(() => localStorage.getItem('devhatch-confirm-terminal-delete') !== '0')
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteTarget | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pickerPurpose, setPickerPurpose] = useState<'workspace' | 'agent' | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const motionTimer = useRef<number | null>(null)
  const sessionScrollTimer = useRef<number | null>(null)
  const sessionsRef = useRef<TerminalInfo[]>([])
  const agentSessionsRef = useRef<AgentSession[]>([])
  const agentMutationVersion = useRef(0)
  const agentPollSequence = useRef(0)
  const modesPageRef = useRef<HTMLElement | null>(null)
  const pageRefs = useRef<Record<DetailMode, HTMLElement | null>>({ terminal: null, agent: null, settings: null })
  const modeRefs = useRef<Record<DetailMode, HTMLButtonElement | null>>({ terminal: null, agent: null, settings: null })
  const titleRefs = useRef<Record<DetailMode, HTMLSpanElement | null>>({ terminal: null, agent: null, settings: null })

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null
  const visibleSessions = sessions.filter((session) => session.cwd === selectedWorkspace)
  const activeSession = visibleSessions.find((session) => session.id === activeId) ?? null
  const activeAgentSession = agentSessions.find((session) => session.id === activeAgentId) ?? null
  const selectedAgentPaths = agentPaths.filter((path) => path.agentId === selectedAgent?.id)
  const pageCount = Math.max(1, Math.ceil(selectedAgentPaths.length / 10))
  const visiblePaths = selectedAgentPaths.length > 24 ? selectedAgentPaths.slice((pathPage - 1) * 10, pathPage * 10) : selectedAgentPaths
  const displayAgentSessions = useMemo(() => {
    const historyTitles = new Map(history.sessions.map((session) => [session.id, session.title]))
    return agentSessions.map((session) => ({ ...session, name: session.name === session.agentName && session.upstreamSessionId ? historyTitles.get(session.upstreamSessionId) ?? session.name : session.name }))
  }, [agentSessions, history.sessions])
  const mergedSessions = useMemo(() => {
    const liveByUpstream = new Map(displayAgentSessions.filter((session) => session.upstreamSessionId).map((session) => [session.upstreamSessionId, session]))
    const rows = history.sessions.map((item) => ({ history: item, live: liveByUpstream.get(item.id) }))
    const historyIds = new Set(history.sessions.map((item) => item.id))
    return [...displayAgentSessions.filter((session) => !session.upstreamSessionId || !historyIds.has(session.upstreamSessionId)).map((live) => ({ live, history: undefined })), ...rows].filter(({ live, history: item }) => `${live?.name ?? ''} ${live?.cwd ?? ''} ${item?.title ?? ''} ${item?.directory ?? ''}`.toLowerCase().includes(sessionSearch.toLowerCase())).slice(0, 30)
  }, [displayAgentSessions, history.sessions, sessionSearch])
  const modeMeta = useMemo(() => ({
    terminal: { label: 'Terminal', icon: SquareTerminal },
    agent: { label: 'Agent CLI', icon: Bot },
    settings: { label: 'Settings', icon: Settings },
  }), [])

  const setPhase = useCallback((id: string, phase: ConnectionPhase) => setPhases((current) => current[id] === phase ? current : { ...current, [id]: phase }), [])
  const refreshAgentData = useCallback(async () => {
    const [agentData, pathData] = await Promise.all([
      requestJson<{ agents: Agent[] }>('/api/agents'),
      requestJson<{ agentLaunchPaths: AgentLaunchPath[] }>('/api/agent-launch-paths'),
    ])
    setAgents(agentData.agents); setAgentPaths(pathData.agentLaunchPaths)
  }, [])
  const refreshHistory = useCallback(async () => {
    try { setHistory(await requestJson<HistoryResponse>('/api/agents/opencode/history')) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [])
  const removeAgentSessionLocally = useCallback((id: string) => {
    agentMutationVersion.current += 1
    const next = agentSessionsRef.current.filter((item) => item.id !== id)
    agentSessionsRef.current = next
    setAgentSessions(next)
    setPhases((current) => { const updated = { ...current }; delete updated[id]; return updated })
    setActiveAgentId((current) => current === id ? next[0]?.id ?? null : current)
    window.setTimeout(() => void refreshHistory(), 500)
  }, [refreshHistory])
  const refreshLiveAgentSessions = useCallback(async () => {
    const version = agentMutationVersion.current
    const sequence = ++agentPollSequence.current
    try {
      const { agentSessions: remote } = await requestJson<{ agentSessions: AgentSession[] }>('/api/agent-sessions')
      if (version !== agentMutationVersion.current || sequence !== agentPollSequence.current) return
      const normalized = remote.map((session) => ({ ...session, cwd: logicalPath(session.cwd, homePaths?.home, homePaths?.resolvedHome) }))
      agentSessionsRef.current = normalized
      setAgentSessions(normalized)
      setActiveAgentId((current) => current && normalized.some((session) => session.id === current) ? current : normalized[0]?.id ?? null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [homePaths])

  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { agentSessionsRef.current = agentSessions }, [agentSessions])
  useEffect(() => {
    void refreshHistory()
    const interval = agentSessions.some((session) => !session.upstreamSessionId) ? 1000 : 10000
    const timer = window.setInterval(() => {
      if (workspaceMode === 'agent') void Promise.all([refreshHistory(), refreshLiveAgentSessions()])
    }, interval)
    return () => window.clearInterval(timer)
  }, [agentSessions, refreshHistory, refreshLiveAgentSessions, workspaceMode])
  useEffect(() => { setPathPage((page) => Math.min(page, pageCount)) }, [pageCount])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      requestJson<{ terminals: TerminalInfo[]; home: string; resolvedHome: string }>('/api/terminals', undefined, 'Unable to load terminal sessions'),
      requestJson<{ agents: Agent[] }>('/api/agents', undefined, 'Unable to load agents'),
      requestJson<{ agentSessions: AgentSession[] }>('/api/agent-sessions', undefined, 'Unable to load agent sessions'),
      requestJson<{ agentLaunchPaths: AgentLaunchPath[] }>('/api/agent-launch-paths', undefined, 'Unable to load launch paths'),
    ]).then((results) => {
      if (cancelled) return
      const failures = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[]
      const terminalResult = results[0]
      let home: string | undefined
      let resolvedHome: string | undefined
      if (terminalResult.status === 'fulfilled') {
        home = terminalResult.value.home
        resolvedHome = terminalResult.value.resolvedHome
        const normalized = terminalResult.value.terminals.map((session) => ({ ...session, cwd: logicalPath(session.cwd, home, resolvedHome) }))
        const paths = uniquePaths(normalized)
        setHomePaths({ home, resolvedHome })
        setSessions(normalized)
        setWorkspaces(paths)
        setSelectedWorkspace(paths[0] ?? null)
        setActiveId(normalized[0]?.id ?? null)
      }
      const agentResult = results[1]
      if (agentResult.status === 'fulfilled') {
        setAgents(agentResult.value.agents)
        setSelectedAgentId(agentResult.value.agents[0]?.id ?? null)
      }
      const sessionResult = results[2]
      if (sessionResult.status === 'fulfilled') {
        const normalized = sessionResult.value.agentSessions.map((session) => ({ ...session, cwd: logicalPath(session.cwd, home, resolvedHome) }))
        setAgentSessions(normalized)
        setActiveAgentId(normalized[0]?.id ?? null)
      }
      if (failures.length) setError(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join(' · '))
      const pathResult = results[3]
      if (pathResult.status === 'fulfilled') setAgentPaths(pathResult.value.agentLaunchPaths)
      setBusy(false)
    })
    return () => { cancelled = true }
  }, [])

  const animateRail = useCallback((page: RailPage, motion: Exclude<RailMotion, null>) => {
    const detailMode: DetailMode = page === 'modes' ? (railPage === 'modes' ? workspaceMode : railPage) : page
    const source = modeRefs.current[detailMode]
    const detail = titleRefs.current[detailMode]
    const modesPage = modesPageRef.current
    const targetPage = pageRefs.current[detailMode]
    if (!source || !detail || !modesPage || !targetPage) return
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
    const measuring = motion === 'forward' ? targetPage : modesPage
    measuring.classList.add('is-measuring')
    const sourceRect = source.getBoundingClientRect()
    const detailRect = detail.getBoundingClientRect()
    measuring.classList.remove('is-measuring')
    const sourceStyle = getComputedStyle(source)
    const sourceState = { left: sourceRect.left, top: sourceRect.top, width: sourceRect.width, height: sourceRect.height, paddingLeft: Number.parseFloat(sourceStyle.paddingLeft), paddingRight: Number.parseFloat(sourceStyle.paddingRight), borderRadius: Number.parseFloat(sourceStyle.borderRadius) }
    const detailState = { left: detailRect.left, top: detailRect.top, width: detailRect.width, height: detailRect.height, paddingLeft: 0, paddingRight: 0, borderRadius: 0 }
    const from = motion === 'return' ? detailState : sourceState
    const to = motion === 'return' ? sourceState : detailState
    setRailMotion(motion)
    setRailPage(page)
    if (motion === 'forward' && page !== 'modes') {
      setWorkspaceMode(page)
      if (page !== 'settings') setFocusVersion((value) => value + 1)
    }
    requestAnimationFrame(() => {
      const flight = document.createElement('span')
      flight.className = 'shared-title-flight'
      const icon = source.querySelector('svg')?.cloneNode(true)
      if (icon) flight.appendChild(icon)
      const label = document.createElement('span')
      label.textContent = modeMeta[detailMode].label
      flight.appendChild(label)
      Object.assign(flight.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, paddingLeft: `${from.paddingLeft}px`, paddingRight: `${from.paddingRight}px`, borderRadius: `${from.borderRadius}px`, color: motion === 'forward' ? '#fff' : '#1d1d1f' })
      source.classList.add('shared-title-hidden')
      detail.classList.add('shared-title-hidden')
      document.body.appendChild(flight)
      let finished: Promise<unknown>
      if (motion === 'forward') {
        const backdrop = document.createElement('span')
        backdrop.className = 'shared-title-backdrop'
        Object.assign(backdrop.style, { left: `${sourceState.left}px`, top: `${sourceState.top}px`, width: `${sourceState.width}px`, height: `${sourceState.height}px`, borderRadius: `${sourceState.borderRadius}px` })
        document.body.appendChild(backdrop)
        const phaseX = from.left + (to.left - from.left) * .08
        const phaseY = from.top + (to.top - from.top) * .08
        const titlePhase = flight.animate([{ left: `${from.left}px`, top: `${from.top}px`, color: '#fff' }, { left: `${phaseX}px`, top: `${phaseY}px`, color: '#1d1d1f' }], { duration: 240, easing: 'cubic-bezier(.32, 0, .67, 0)', fill: 'forwards' })
        const backdropPhase = backdrop.animate([{ transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 }, { transform: `translate3d(${(to.left - from.left) * .08}px, ${(to.top - from.top) * .08}px, 0) scale(.9)`, opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.32, 0, .67, 0)', fill: 'forwards' })
        finished = Promise.all([titlePhase.finished, backdropPhase.finished]).then(() => { backdrop.remove(); return flight.animate([{ left: `${phaseX}px`, top: `${phaseY}px`, width: `${from.width}px`, height: `${from.height}px`, paddingLeft: `${from.paddingLeft}px`, paddingRight: `${from.paddingRight}px`, borderRadius: `${from.borderRadius}px` }, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, paddingLeft: `${to.paddingLeft}px`, paddingRight: `${to.paddingRight}px`, borderRadius: `${to.borderRadius}px` }], { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }).finished })
      } else {
        finished = flight.animate([{ left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, paddingLeft: `${from.paddingLeft}px`, paddingRight: `${from.paddingRight}px`, borderRadius: `${from.borderRadius}px`, background: 'transparent' }, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, paddingLeft: `${to.paddingLeft}px`, paddingRight: `${to.paddingRight}px`, borderRadius: `${to.borderRadius}px`, background: '#1d1d1f', color: '#fff' }], { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }).finished
      }
      finished.finally(() => { flight.remove(); source.classList.remove('shared-title-hidden'); detail.classList.remove('shared-title-hidden') })
    })
    motionTimer.current = window.setTimeout(() => setRailMotion(null), motion === 'forward' ? 640 : 540)
  }, [modeMeta, railPage, workspaceMode])

  useEffect(() => () => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
    if (sessionScrollTimer.current) window.clearTimeout(sessionScrollTimer.current)
  }, [])

  const toggleSidebar = useCallback(() => {
    if (window.innerWidth <= 920) { setSidebarOpen((value) => !value); return }
    setSidebarHidden((value) => { localStorage.setItem('devhatch-sidebar-hidden', value ? '0' : '1'); return !value })
  }, [])

  const launchAgent = useCallback(async ({ cwd, upstreamSessionId, pathId }: { cwd?: string; upstreamSessionId?: string; pathId?: string }) => {
    if (!selectedAgent?.available) { setError(`${selectedAgent?.name ?? 'Agent'} is unavailable`); return }
    setError(null)
    try {
      if (pathId) await requestJson(`/api/agent-launch-paths/${pathId}/touch`, { method: 'POST' })
      const { agentSession } = await createAgentSession(upstreamSessionId ? { upstreamSessionId } : { cwd })
      const normalized = { ...agentSession, cwd: logicalPath(agentSession.cwd, homePaths?.home, homePaths?.resolvedHome) }
      agentMutationVersion.current += 1
      if (!agentSessionsRef.current.some((item) => item.id === normalized.id)) agentSessionsRef.current = [...agentSessionsRef.current, normalized]
      setAgentSessions(agentSessionsRef.current)
      setActiveAgentId(normalized.id)
      setPickerPurpose(null)
      setSidebarOpen(false)
      setFocusVersion((value) => value + 1)
      await Promise.all([refreshHistory(), refreshAgentData()])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [homePaths, refreshAgentData, refreshHistory, selectedAgent])

  const chooseAgentPath = useCallback(async (path: string) => {
    try {
      let item = agentPaths.find((entry) => entry.agentId === selectedAgent?.id && entry.path === path)
      if (!item) {
        const result = await requestJson<{ agentLaunchPath: AgentLaunchPath }>('/api/agent-launch-paths', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: selectedAgent?.id, path, alias: null, pinned: false }) })
        item = result.agentLaunchPath
      }
      await launchAgent({ cwd: item.path, pathId: item.id })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [agentPaths, launchAgent, selectedAgent])

  const addTerminal = useCallback(async (cwd?: string) => {
    setError(null)
    try {
      const { terminal } = await createTerminal(cwd)
      const normalized = { ...terminal, cwd: logicalPath(terminal.cwd, homePaths?.home, homePaths?.resolvedHome) }
      setSessions((current) => [...current, normalized])
      setWorkspaces((current) => current.includes(normalized.cwd) ? current : [normalized.cwd, ...current])
      setSelectedWorkspace(normalized.cwd)
      setActiveId(normalized.id)
      setSidebarOpen(false)
      setFocusVersion((value) => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [homePaths])

  const renameSession = useCallback(async (session: TerminalInfo, agent: boolean) => {
    const name = window.prompt('Session name', session.name)?.trim()
    if (!name || name === session.name) return
    try {
      const result = await renameRemoteSession(agent ? '/api/agent-sessions' : '/api/terminals', session.id, name)
      const updated = Object.values(result)[0]
      const normalized = { ...updated, cwd: logicalPath(updated.cwd, homePaths?.home, homePaths?.resolvedHome) }
      if (agent) setAgentSessions((current) => current.map((item) => item.id === normalized.id ? normalized as AgentSession : item))
      else setSessions((current) => current.map((item) => item.id === normalized.id ? normalized : item))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }, [homePaths])

  const deleteSession = useCallback(async (target: DeleteTarget) => {
    setDeleting(true)
    const agent = target.kind === 'agent session'
    try {
      await deleteRemoteSession(agent ? '/api/agent-sessions' : '/api/terminals', target.id)
      if (agent) {
        removeAgentSessionLocally(target.id)
      } else {
        const next = sessionsRef.current.filter((item) => item.id !== target.id)
        sessionsRef.current = next
        setSessions(next)
        setActiveId((active) => active === target.id ? next.find((item) => item.cwd === selectedWorkspace)?.id ?? null : active)
      }
      setPhases((current) => { const next = { ...current }; delete next[target.id]; return next })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setDeleting(false); setDeleteCandidate(null) }
  }, [removeAgentSessionLocally, selectedWorkspace])

  const requestClose = useCallback((session: TerminalInfo, agent: boolean) => {
    const target: DeleteTarget = { id: session.id, name: session.name, cwd: session.cwd, kind: agent ? 'agent session' : 'terminal' }
    if (confirmDelete) setDeleteCandidate(target)
    else void deleteSession(target)
  }, [confirmDelete, deleteSession])

  const chooseWorkspace = useCallback((path: string) => {
    const normalized = logicalPath(path, homePaths?.home, homePaths?.resolvedHome)
    setWorkspaces((current) => current.includes(normalized) ? current : [normalized, ...current])
    setSelectedWorkspace(normalized)
    setActiveId(sessions.find((session) => session.cwd === normalized)?.id ?? null)
    setPickerPurpose(null)
  }, [homePaths, sessions])

  const modeSubtitle = workspaceMode === 'settings'
    ? 'Preferences for your DevHatch workspace'
    : workspaceMode === 'agent'
      ? activeAgentSession ? `${displayPath(activeAgentSession.cwd, homePaths?.home, homePaths?.resolvedHome)} · ${activeAgentSession.agentName}` : selectedAgent?.name ?? 'No agent selected'
      : selectedWorkspace ? displayPath(selectedWorkspace, homePaths?.home, homePaths?.resolvedHome) : 'No workspace selected'

  return (
    <main className={`app ${sidebarOpen ? 'drawer-open' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      {pickerPurpose && <WorkspacePicker purpose={pickerPurpose} initialPath={pickerPurpose === 'agent' ? activeAgentSession?.cwd ?? selectedWorkspace ?? undefined : selectedWorkspace ?? undefined} onClose={() => setPickerPurpose(null)} onSelect={(path) => pickerPurpose === 'agent' ? void chooseAgentPath(path) : chooseWorkspace(path)} />}

      {renamePath && <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRenamePath(null)}><div className="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title"><h2 id="rename-title">Rename launch path</h2><p>{renamePath.path}</p><label>Alias<input autoFocus value={renameAlias} maxLength={120} placeholder={workspaceName(renamePath.path)} onChange={(event) => setRenameAlias(event.target.value)}/></label><div className="dialog-buttons"><button onClick={() => setRenamePath(null)}>Cancel</button><button className="primary" onClick={() => void requestJson(`/api/agent-launch-paths/${renamePath.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alias: renameAlias.trim() || null }) }).then(refreshAgentData).then(() => setRenamePath(null)).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))}>Save</button></div></div></div>}
      {confirmAction && <ActionDialog action={{ ...confirmAction, action: async () => { setActionBusy(true); try { await confirmAction.action(); setConfirmAction(null) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setActionBusy(false) } } }} busy={actionBusy} onClose={() => setConfirmAction(null)}/>}
      {deleteCandidate && <DeleteSessionDialog target={deleteCandidate} deleting={deleting} onCancel={() => setDeleteCandidate(null)} onConfirm={() => void deleteSession(deleteCandidate)} />}
      <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
      <aside className="rail">
        <div className="brand"><div className="brand-mark"><DevHatchLogo /></div><div><strong>DevHatch</strong><small>Developer Workspace</small></div></div>
        <div className="rail-pages">
          <section ref={modesPageRef} className={`rail-page ${railPage === 'modes' ? 'active' : ''} ${railMotion === 'forward' ? 'forward-exit' : ''} ${railMotion === 'return' ? 'return-enter' : ''}`}>
            <nav className="primary-nav" aria-label="Workspace modes">
              <button ref={(node) => { modeRefs.current.terminal = node }} className={`nav-item ${workspaceMode === 'terminal' ? 'active' : ''}`} onClick={() => animateRail('terminal', 'forward')}><SquareTerminal/><span>Terminal</span><b>{sessions.length}</b></button>
              <button ref={(node) => { modeRefs.current.agent = node }} className={`nav-item ${workspaceMode === 'agent' ? 'active' : ''}`} onClick={() => animateRail('agent', 'forward')}><Bot/><span>Agent CLI</span><b>{agentSessions.length}</b></button>
              <button className="nav-item disabled" title="Coming next"><Globe2/><span>Web Apps</span></button>
              <button ref={(node) => { modeRefs.current.settings = node }} className={`nav-item ${workspaceMode === 'settings' ? 'active' : ''}`} onClick={() => animateRail('settings', 'forward')}><Settings/><span>Settings</span></button>
            </nav>
            <div className="mode-footer">⌘ 1–4</div>
          </section>

          <section ref={(node) => { pageRefs.current.terminal = node }} className={`rail-page ${railPage === 'terminal' ? 'active' : ''} ${railMotion === 'forward' ? 'forward-enter' : ''} ${railMotion === 'return' ? 'return-exit' : ''}`}>
            <div className="rail-page-title"><button className="rail-back" aria-label="Back to modes" onClick={() => animateRail('modes', 'return')}><ArrowLeft/></button><span ref={(node) => { titleRefs.current.terminal = node }} className="mode-title"><SquareTerminal/><strong>Terminal</strong></span></div>
            <div className={`rail-detail ${railMotion === 'forward' ? 'awaiting-title' : ''}`}><div className="menu-section"><p className="menu-label">Workspace</p><div className="workspace-list">{workspaces.map((workspace) => <button key={workspace} className={`workspace-item ${workspace === selectedWorkspace ? 'active' : ''}`} onClick={() => { setSelectedWorkspace(workspace); setActiveId(sessions.find((session) => session.cwd === workspace)?.id ?? null); setSidebarOpen(false) }}><Grid2X2/><span><strong>{workspaceName(workspace)}</strong><small>{displayPath(workspace, homePaths?.home, homePaths?.resolvedHome)}</small></span></button>)}</div></div><button className="path-add" onClick={() => setPickerPurpose('workspace')}><Plus/>Add Workspace</button></div>
          </section>

          <section ref={(node) => { pageRefs.current.agent = node }} className={`rail-page ${railPage === 'agent' ? 'active' : ''} ${railMotion === 'forward' ? 'forward-enter' : ''} ${railMotion === 'return' ? 'return-exit' : ''}`}>
            <div className="rail-page-title"><button className="rail-back" aria-label="Back to modes" onClick={() => animateRail('modes', 'return')}><ArrowLeft/></button><span ref={(node) => { titleRefs.current.agent = node }} className="mode-title"><Bot/><strong>Agent CLI</strong></span></div>
            <div className={`rail-detail agent-detail ${railMotion === 'forward' ? 'awaiting-title' : ''}`}>
              <div className="menu-section"><p className="menu-label">Agent CLI</p>{busy ? <div className="quiet-message">Loading agents…</div> : agents.length ? <><CustomSelect label="Select Agent CLI" value={selectedAgentId} options={agents} isOptionDisabled={(agent) => !agent.enabled || agent.availability === 'coming-soon'} onChange={setSelectedAgentId} renderTrigger={(agent) => <><span className="agent-brand"><AgentIcon id={agent?.id}/></span><span className="select-copy"><strong>{agent?.name ?? 'Select agent'}</strong><small>{agent?.id === 'opencode' ? 'Agentic coding CLI' : 'OpenAI coding agent'} · {agent?.availability === 'coming-soon' ? 'Coming soon' : agent?.available ? 'Available' : 'Unavailable'}</small></span></>} renderOption={(agent) => <><span className="agent-brand"><AgentIcon id={agent.id}/></span><span className="select-copy"><strong>{agent.name}</strong><small>{agent.id === 'opencode' ? 'Agentic coding CLI' : 'OpenAI coding agent'} · {agent.availability === 'coming-soon' ? 'Coming soon' : agent.available ? 'Available' : 'Unavailable'}</small></span></>}/><button className="config-default" type="button"><span><strong>Config</strong><small>OpenCode configuration</small></span><b>Default</b><ChevronRight/></button></> : <div className="quiet-message">No Agent CLI integrations found.</div>}</div>
              <div className="menu-section"><div className="path-section-head"><p className="menu-label">Launch Path</p><div className="path-head-actions"><button className={`path-mode-toggle ${pathDisplay}`} type="button" role="switch" aria-label={`Switch to ${pathDisplay === 'folder' ? 'full path' : 'folder name'}`} aria-checked={pathDisplay === 'full'} onClick={() => { const next = pathDisplay === 'folder' ? 'full' : 'folder'; setPathDisplay(next); localStorage.setItem('devhatch-agent-path-display', next) }}><span className="path-mode-label">{pathDisplay === 'folder' ? 'Full path' : 'Folder'}</span><span className="path-mode-knob"/></button><button className="mini-action" disabled={!selectedAgent?.available} onClick={() => setPickerPurpose('agent')}><Plus/>Launch</button></div></div><div className={`agent-path-list ${selectedAgentPaths.length > 8 && selectedAgentPaths.length <= 24 ? 'scrollable' : ''}`}>{visiblePaths.length ? visiblePaths.map((item) => <div key={item.id} className={`agent-path-row ${activeAgentSession?.cwd === logicalPath(item.path, homePaths?.home, homePaths?.resolvedHome) ? 'active' : ''}`}><Folder/><button className="path-main" title={item.path} disabled={!selectedAgent?.available} onClick={() => void launchAgent({ cwd: item.path, pathId: item.id })}><strong>{pathDisplay === 'folder' ? item.alias || workspaceName(item.path) : item.path}</strong>{pathDisplay === 'folder' && <small>{displayPath(item.path, homePaths?.home, homePaths?.resolvedHome)}</small>}</button><span className="path-actions"><button className={item.pinned ? 'pinned' : ''} aria-label={item.pinned ? 'Unpin path' : 'Pin path'} aria-pressed={item.pinned} title={item.pinned ? 'Pinned' : 'Pin path'} onClick={() => void requestJson(`/api/agent-launch-paths/${item.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: !item.pinned }) }).then(refreshAgentData)}><Pin/></button><button aria-label="Launch path" onClick={() => void launchAgent({ cwd: item.path, pathId: item.id })}><Play/></button><button aria-label="Rename alias" onClick={() => { setRenamePath(item); setRenameAlias(item.alias ?? '') }}><Pencil/></button><button aria-label="Delete path" onClick={() => setConfirmAction({ title: 'Delete launch path?', description: `${item.path} will be removed from the Agent CLI library.`, confirmLabel: 'Delete path', danger: true, action: async () => { const response = await fetch(`/api/agent-launch-paths/${item.id}`, { method: 'DELETE' }); if (!response.ok) throw new Error('Unable to delete path'); await refreshAgentData() } })}><Trash2/></button></span></div>) : <div className="quiet-message">Choose a directory to launch your first session.</div>}</div>{selectedAgentPaths.length > 24 && <div className="path-pagination"><button aria-label="Previous page" disabled={pathPage === 1} onClick={() => setPathPage((page) => page - 1)}><ChevronLeft/></button><span>{pathPage} / {pageCount}</span><button aria-label="Next page" disabled={pathPage === pageCount} onClick={() => setPathPage((page) => page + 1)}><ChevronRight/></button></div>}</div>
              <div className="menu-section sessions-section"><div className="sessions-heading"><p className="menu-label">Sessions</p>{agentSessions.length + history.sessions.length > 7 && <label className="session-search"><Search/><input aria-label="Search sessions" placeholder="Search" value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)}/></label>}</div><div className={`agent-session-list ${sessionListScrolling ? 'is-scrolling' : ''}`} onScroll={() => { setSessionListScrolling(true); if (sessionScrollTimer.current) window.clearTimeout(sessionScrollTimer.current); sessionScrollTimer.current = window.setTimeout(() => setSessionListScrolling(false), 700) }}>{mergedSessions.length ? mergedSessions.map(({ live, history: item }) => { const presence = live ? 'active-here' : item?.presence ?? 'active-here'; const label = live ? 'Current app' : presence === 'possibly-active-elsewhere' ? 'Possibly active elsewhere' : 'Inactive'; return <div key={live?.id ?? item!.id} className={`agent-session-row ${live?.id === activeAgentId ? 'active' : ''}`}><button className="session-main" onClick={() => live && (setActiveAgentId(live.id), setSidebarOpen(false), setFocusVersion((value) => value + 1))}><span className={`presence-dot ${presence}`}/><span><strong>{live?.name ?? item?.title}</strong><small>{displayPath(live?.cwd ?? item?.directory ?? '', homePaths?.home, homePaths?.resolvedHome)} · {item ? new Date(item.timeUpdated).toLocaleString() : 'Default'}</small><em>{label}</em></span></button><span className="session-actions">{!live && item && <button className="resume-button" onClick={() => { const resume = () => launchAgent({ upstreamSessionId: item.id }); if (presence === 'possibly-active-elsewhere') setConfirmAction({ title: 'Resume possibly active session?', description: 'OpenCode may be using this session elsewhere. Resuming concurrently could cause conflicting changes.', confirmLabel: 'Resume anyway', action: resume }); else void resume() }}>Resume</button>}<button className="session-delete" aria-label={`Delete ${live?.name ?? item?.title ?? 'session'}`} title="Delete session" onClick={() => { if (live) { const target: DeleteTarget = { id: live.id, name: live.name, cwd: live.cwd, kind: 'agent session' }; if (confirmDelete) setDeleteCandidate(target); else void deleteSession(target); return } if (item) setConfirmAction({ title: 'Delete OpenCode session?', description: `“${item.title}” and its OpenCode history will be permanently deleted.`, confirmLabel: 'Delete session', danger: true, action: async () => { const response = await fetch(`/api/agents/opencode/history/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); if (!response.ok) { const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null; throw new Error(payload?.message || payload?.error || 'Unable to delete OpenCode session') } await refreshHistory() } }) }}><Trash2/></button></span></div> }) : <div className="quiet-message">No sessions found.</div>}</div></div>
            </div>
          </section>

          <section ref={(node) => { pageRefs.current.settings = node }} className={`rail-page ${railPage === 'settings' ? 'active' : ''} ${railMotion === 'forward' ? 'forward-enter' : ''} ${railMotion === 'return' ? 'return-exit' : ''}`}>
            <div className="rail-page-title"><button className="rail-back" aria-label="Back to modes" onClick={() => animateRail('modes', 'return')}><ArrowLeft/></button><span ref={(node) => { titleRefs.current.settings = node }} className="mode-title"><Settings/><strong>Settings</strong></span></div>
            <div className={`rail-detail ${railMotion === 'forward' ? 'awaiting-title' : ''}`}><div className="menu-section"><p className="menu-label">Sections</p><div className="settings-nav-item active"><SquareTerminal/><span>Sessions</span></div><div className="settings-nav-item"><Bot/><span>Agent CLI</span></div></div></div>
          </section>
        </div>
      </aside>

      <section className="shell">
        <header className="topbar"><button className="icon-button menu-button" aria-label="Toggle navigation" onClick={toggleSidebar}><Menu className="menu-icon-open"/><PanelLeftClose className="menu-icon-hide"/></button><div className="breadcrumb"><strong>{modeMeta[workspaceMode].label}</strong><span>{modeSubtitle}</span></div>{workspaceMode === 'terminal' && <div className="top-actions"><button className="secondary-button" onClick={() => void addTerminal(activeSession?.cwd ?? selectedWorkspace ?? undefined)}><Plus/><span>New terminal</span></button></div>}</header>

        <div className={`terminal-workspace ${workspaceMode === 'terminal' ? '' : 'workspace-hidden'}`}>
          <SessionTabs sessions={visibleSessions} activeId={activeId} phases={phases} label="Terminal" onActivate={(id) => { setActiveId(id); setFocusVersion((value) => value + 1) }} onRename={(session) => void renameSession(session, false)} onClose={(session) => requestClose(session, false)} />
          <div className="stage">{busy && <div className="empty-state">Starting DevHatch…</div>}{!busy && !visibleSessions.length && <div className="empty-state"><strong>No terminal sessions are running</strong><button onClick={() => void addTerminal(selectedWorkspace ?? undefined)}>Create terminal</button></div>}{sessions.map((session) => <TerminalSurface key={session.id} session={session} socketBase="/api/terminals" active={workspaceMode === 'terminal' && session.id === activeId && session.cwd === selectedWorkspace} focusVersion={focusVersion} onPhaseChange={setPhase} onError={setError} />)}{error && <div className="error-banner">{error}<button aria-label="Dismiss" onClick={() => setError(null)}><X/></button></div>}</div>
          <Statusbar session={activeSession} phase={activeId ? phases[activeId] : undefined}/><div className="mobile-keys">{['Esc', 'Tab', 'Ctrl', 'Alt', '↑', '↓', '←', '→'].map((key) => <button key={key}>{key}</button>)}</div>
        </div>

        <div className={`terminal-workspace agent-workspace ${workspaceMode === 'agent' ? '' : 'workspace-hidden'}`}>
          <SessionTabs sessions={displayAgentSessions} activeId={activeAgentId} phases={phases} label="Agent" onActivate={(id) => { setActiveAgentId(id); setFocusVersion((value) => value + 1) }} onRename={(session) => void renameSession(session, true)} onClose={(session) => requestClose(session, true)} />
          <div className="stage">{busy && <div className="empty-state">Loading Agent CLI…</div>}{!busy && !agentSessions.length && <div className="empty-state"><Bot/><strong>No agent sessions are running</strong><span>{!selectedAgent?.available ? `${selectedAgent?.name ?? 'Agent CLI'} is unavailable` : 'Choose a launch path from the sidebar'}</span>{selectedAgent?.available && <button onClick={() => setPickerPurpose('agent')}>Choose launch path</button>}</div>}{agentSessions.map((session) => <TerminalSurface key={session.id} session={session} socketBase="/api/agent-sessions" active={workspaceMode === 'agent' && session.id === activeAgentId} focusVersion={focusVersion} onPhaseChange={setPhase} onRemoved={removeAgentSessionLocally} onError={setError} />)}{error && workspaceMode === 'agent' && <div className="error-banner">{error}<button aria-label="Dismiss" onClick={() => setError(null)}><X/></button></div>}</div>
          <Statusbar session={activeAgentSession} phase={activeAgentId ? phases[activeAgentId] : undefined}/><div className="mobile-keys">{['Esc', 'Tab', 'Ctrl', 'Alt', '@', '/', '↑', '↓'].map((key) => <button key={key}>{key}</button>)}</div>
        </div>

        {workspaceMode === 'settings' && <div className="settings-workspace"><div className="settings-content"><section className="settings-section"><div className="settings-section-title"><h2>Sessions</h2><p>Control terminal and agent session behavior.</p></div><div className="settings-group"><label className="settings-row"><span><strong>Confirm before closing live sessions</strong><small>Ask before stopping a process and closing its live tab. OpenCode history is preserved.</small></span><input type="checkbox" role="switch" checked={confirmDelete} onChange={(event) => { setConfirmDelete(event.target.checked); localStorage.setItem('devhatch-confirm-terminal-delete', event.target.checked ? '1' : '0') }} /></label></div></section></div></div>}
      </section>
    </main>
  )
}

export default App
