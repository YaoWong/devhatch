import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import {
  ArrowLeft,
  ChevronRight,
  Bot,
  Folder,
  FolderOpen,
  Globe2,
  Grid2X2,
  HardDrive,
  Home,
  Menu,
  PanelLeftClose,
  Pencil,
  Plus,
  Settings,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
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

type ConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'exited'
type RailPage = 'modes' | 'terminal'
type RailMotion = 'forward' | 'return' | null
type DirectoryListing = {
  path: string
  parent: string | null
  home: string
  resolvedHome: string
  directories: { name: string; path: string }[]
}

const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

async function listDirectories(directory?: string) {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : ''
  const response = await fetch(`/api/filesystem/directories${query}`)
  if (!response.ok) throw new Error(response.status === 403 ? 'This folder cannot be opened' : 'Unable to open this folder')
  return (await response.json()) as DirectoryListing
}

async function listTerminals() {
  const response = await fetch('/api/terminals')
  if (!response.ok) throw new Error('Unable to load terminal sessions')
  return (await response.json()) as { terminals: TerminalInfo[]; home: string; resolvedHome: string }
}

async function createTerminal(cwd?: string) {
  const response = await fetch('/api/terminals', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd }),
  })
  if (!response.ok) throw new Error('Unable to create terminal session')
  return (await response.json()) as { terminal: TerminalInfo }
}

async function renameTerminal(id: string, name: string) {
  const response = await fetch(`/api/terminals/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) throw new Error('Unable to rename terminal session')
  return (await response.json()) as { terminal: TerminalInfo }
}

async function deleteTerminal(id: string) {
  const response = await fetch(`/api/terminals/${id}`, { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new Error('Unable to close terminal session')
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

function uniqueWorkspaces(sessions: TerminalInfo[]) {
  return [...new Set(sessions.map((session) => session.cwd))]
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

function TerminalSurface({ session, active, onPhaseChange, onError }: { session: TerminalInfo; active: boolean; onPhaseChange: (id: string, phase: ConnectionPhase) => void; onError: (message: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const retryRef = useRef<number | null>(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
    if (active) requestAnimationFrame(() => fitRef.current?.fit())
  }, [active])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let attempt = 0
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
        letterSpacing: 0,
        lineHeight: 1,
        scrollback: 5000,
        theme: {
          background: '#ffffff',
          foreground: '#1d1d1f',
          cursor: '#0071e3',
          selectionBackground: '#cce4ff',
          black: '#1d1d1f', red: '#d70015', green: '#16803c', yellow: '#9a6700', blue: '#0066cc', magenta: '#8944ab', cyan: '#007c91', white: '#f5f5f7',
          brightBlack: '#6e6e73', brightRed: '#ff3b30', brightGreen: '#34c759', brightYellow: '#ffcc00', brightBlue: '#0a84ff', brightMagenta: '#bf5af2', brightCyan: '#64d2ff', brightWhite: '#ffffff',
        },
      })
      fit = new FitAddon()
      terminal.loadAddon(fit)
      terminal.open(container)
      try {
        terminal.loadAddon(new WebglAddon())
      } catch {
        terminal.refresh(0, terminal.rows - 1)
      }
    } catch (reason) {
      onPhaseChange(session.id, 'disconnected')
      onError(reason instanceof Error ? reason.message : String(reason))
      return
    }
    fitRef.current = fit

    const sendResize = () => {
      if (!activeRef.current) return
      try { fit.fit() } catch { return }
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }

    const connect = () => {
      if (disposed) return
      onPhaseChange(session.id, attempt ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(`${socketProtocol}//${window.location.host}/api/terminals/${session.id}/socket`)
      socketRef.current = socket
      socket.addEventListener('open', () => {
        attempt = 0
        onPhaseChange(session.id, 'connected')
        sendResize()
      })
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type: string; data?: string }
          if ((message.type === 'output' || message.type === 'snapshot') && message.data) terminal.write(message.data)
          if (message.type === 'exit') onPhaseChange(session.id, 'exited')
        } catch { return }
      })
      socket.addEventListener('close', (event) => {
        if (disposed || event.code === 1000) return
        onPhaseChange(session.id, 'disconnected')
        const delay = Math.min(500 * 2 ** attempt, 5000)
        attempt += 1
        retryRef.current = window.setTimeout(connect, delay)
      })
    }

    const input = terminal.onData((data) => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    const observer = new ResizeObserver(sendResize)
    observer.observe(container)
    connect()

    return () => {
      disposed = true
      if (retryRef.current) window.clearTimeout(retryRef.current)
      observer.disconnect()
      input.dispose()
      socketRef.current?.close(1000, 'surface closed')
      terminal.dispose()
      fitRef.current = null
    }
  }, [session.id, onPhaseChange, onError])

  return <div ref={containerRef} className={`terminal-surface ${active ? 'active' : ''}`} />
}

function WorkspacePicker({ initialPath, onClose, onSelect }: { initialPath?: string; onClose: () => void; onSelect: (path: string) => void }) {
  const [listing, setListing] = useState<DirectoryListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const openDirectory = useCallback(async (directory?: string) => {
    setLoading(true)
    setPickerError(null)
    try {
      setListing(await listDirectories(directory))
    } catch (reason) {
      setPickerError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void openDirectory(initialPath)
  }, [initialPath, openDirectory])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    dialogRef.current?.focus()
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const breadcrumbs = useMemo(() => {
    if (!listing) return []
    const homeRoot = [listing.home, listing.resolvedHome].find((root) => listing.path === root || listing.path.startsWith(`${root}/`))
    if (homeRoot) {
      const relativeParts = listing.path.slice(homeRoot.length).split('/').filter(Boolean)
      return [{ name: '~', path: homeRoot }, ...relativeParts.map((name, index) => ({ name, path: `${homeRoot}/${relativeParts.slice(0, index + 1).join('/')}` }))]
    }
    const parts = listing.path.split('/').filter(Boolean)
    return [{ name: '/', path: '/' }, ...parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join('/')}` }))]
  }, [listing])

  const friendlyPath = useCallback((value: string) => displayPath(value, listing?.home, listing?.resolvedHome), [listing])

  return (
    <div className="picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="folder-picker" role="dialog" aria-modal="true" aria-labelledby="folder-picker-title" tabIndex={-1}>
        <header className="picker-header">
          <div className="picker-title-icon"><FolderOpen/></div>
          <div><h2 id="folder-picker-title">Add Workspace</h2><p>Choose a folder on this machine</p></div>
          <button className="picker-close" aria-label="Close" onClick={onClose}><X/></button>
        </header>
        <div className="picker-toolbar">
          <button className="picker-location" disabled={!listing?.parent} onClick={() => void openDirectory(listing?.parent ?? undefined)}><ArrowLeft/><span>Up</span></button>
          <button className="picker-location" onClick={() => void openDirectory(listing?.home)}><Home/><span>Home</span></button>
          <button className="picker-location" onClick={() => void openDirectory('/')}><HardDrive/><span>Root</span></button>
        </div>
        <nav className="picker-breadcrumbs" aria-label="Current folder">
          {breadcrumbs.map((crumb, index) => <span key={crumb.path}><button onClick={() => void openDirectory(crumb.path)}>{crumb.name}</button>{index < breadcrumbs.length - 1 && <ChevronRight/>}</span>)}
        </nav>
        <div className="picker-browser">
          {loading && <div className="picker-message"><span className="picker-spinner"/>Loading folders…</div>}
          {!loading && pickerError && <div className="picker-message error"><strong>{pickerError}</strong><button onClick={() => void openDirectory(listing?.path ?? initialPath)}>Try again</button></div>}
          {!loading && !pickerError && listing?.directories.length === 0 && <div className="picker-message"><FolderOpen/><strong>This folder has no subfolders</strong><span>You can still select the current folder.</span></div>}
          {!loading && !pickerError && listing?.directories.map((directory) => <button key={directory.path} className="folder-row" onClick={() => void openDirectory(directory.path)}><span className="folder-icon"><Folder/></span><span><strong>{directory.name}</strong><small>{friendlyPath(directory.path)}</small></span><ChevronRight/></button>)}
        </div>
        <footer className="picker-footer">
          <div className="picker-selection"><span>Selected folder</span><strong>{listing ? friendlyPath(listing.path) : 'No folder selected'}</strong></div>
          <button className="picker-cancel" onClick={onClose}>Cancel</button>
          <button className="picker-confirm" disabled={!listing || loading || !!pickerError} onClick={() => listing && onSelect(listing.path)}>Add Workspace</button>
        </footer>
      </div>
    </div>
  )
}

function App() {
  const [sessions, setSessions] = useState<TerminalInfo[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(null)
  const [homePaths, setHomePaths] = useState<{ home: string; resolvedHome: string } | null>(null)
  const [phases, setPhases] = useState<Record<string, ConnectionPhase>>({})
  const [railPage, setRailPage] = useState<RailPage>('modes')
  const [railMotion, setRailMotion] = useState<RailMotion>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('devhatch-sidebar-hidden') === '1')
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const motionTimer = useRef<number | null>(null)
  const modesPageRef = useRef<HTMLElement | null>(null)
  const terminalPageRef = useRef<HTMLElement | null>(null)
  const terminalModeRef = useRef<HTMLButtonElement | null>(null)
  const terminalTitleRef = useRef<HTMLSpanElement | null>(null)
  const visibleSessions = useMemo(() => sessions.filter((session) => session.cwd === selectedWorkspace), [sessions, selectedWorkspace])
  const activeSession = visibleSessions.find((session) => session.id === activeId) ?? null

  const setPhase = useCallback((id: string, phase: ConnectionPhase) => {
    setPhases((current) => current[id] === phase ? current : { ...current, [id]: phase })
  }, [])

  const animateRail = useCallback((page: RailPage, motion: Exclude<RailMotion, null>) => {
    const source = terminalModeRef.current
    const detail = terminalTitleRef.current
    const modesPage = modesPageRef.current
    const terminalPage = terminalPageRef.current
    if (!source || !detail || !modesPage || !terminalPage) return
    if (motionTimer.current) window.clearTimeout(motionTimer.current)

    const measuring = motion === 'forward' ? terminalPage : modesPage
    measuring.classList.add('is-measuring')
    const sourceRect = source.getBoundingClientRect()
    const detailRect = detail.getBoundingClientRect()
    measuring.classList.remove('is-measuring')
    const sourceStyle = getComputedStyle(source)
    const sourceState = {
      left: sourceRect.left,
      top: sourceRect.top,
      width: sourceRect.width,
      height: sourceRect.height,
      paddingLeft: Number.parseFloat(sourceStyle.paddingLeft),
      paddingRight: Number.parseFloat(sourceStyle.paddingRight),
      borderRadius: Number.parseFloat(sourceStyle.borderRadius),
    }
    const detailState = {
      left: detailRect.left,
      top: detailRect.top,
      width: detailRect.width,
      height: detailRect.height,
      paddingLeft: 0,
      paddingRight: 0,
      borderRadius: 0,
    }
    const from = motion === 'return' ? detailState : sourceState
    const to = motion === 'return' ? sourceState : detailState

    setRailMotion(motion)
    setRailPage(page)
    requestAnimationFrame(() => {
      const flight = document.createElement('span')
      flight.className = 'shared-title-flight'
      const icon = source.querySelector('svg')?.cloneNode(true)
      if (icon) flight.appendChild(icon)
      const label = document.createElement('span')
      label.textContent = 'Terminal'
      flight.appendChild(label)
      Object.assign(flight.style, {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
        paddingLeft: `${from.paddingLeft}px`,
        paddingRight: `${from.paddingRight}px`,
        borderRadius: `${from.borderRadius}px`,
        color: motion === 'forward' ? '#fff' : '#1d1d1f',
      })
      source.classList.add('shared-title-hidden')
      detail.classList.add('shared-title-hidden')
      document.body.appendChild(flight)

      let finished: Promise<unknown>
      if (motion === 'forward') {
        const backdrop = document.createElement('span')
        backdrop.className = 'shared-title-backdrop'
        Object.assign(backdrop.style, {
          left: `${sourceState.left}px`,
          top: `${sourceState.top}px`,
          width: `${sourceState.width}px`,
          height: `${sourceState.height}px`,
          borderRadius: `${sourceState.borderRadius}px`,
        })
        document.body.appendChild(backdrop)
        const phaseX = from.left + (to.left - from.left) * .08
        const phaseY = from.top + (to.top - from.top) * .08
        const titlePhase = flight.animate([
          { left: `${from.left}px`, top: `${from.top}px`, color: '#fff' },
          { left: `${phaseX}px`, top: `${phaseY}px`, color: '#1d1d1f' },
        ], { duration: 240, easing: 'cubic-bezier(.32, 0, .67, 0)', fill: 'forwards' })
        const backdropPhase = backdrop.animate([
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1 },
          { transform: `translate3d(${(to.left - from.left) * .08}px, ${(to.top - from.top) * .08}px, 0) scale(.9)`, opacity: 0 },
        ], { duration: 240, easing: 'cubic-bezier(.32, 0, .67, 0)', fill: 'forwards' })
        finished = Promise.all([titlePhase.finished, backdropPhase.finished]).then(() => {
          backdrop.remove()
          return flight.animate([
            { left: `${phaseX}px`, top: `${phaseY}px`, width: `${from.width}px`, height: `${from.height}px`, paddingLeft: `${from.paddingLeft}px`, paddingRight: `${from.paddingRight}px`, borderRadius: `${from.borderRadius}px` },
            { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, paddingLeft: `${to.paddingLeft}px`, paddingRight: `${to.paddingRight}px`, borderRadius: `${to.borderRadius}px` },
          ], { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }).finished
        })
      } else {
        finished = flight.animate([
          { offset: 0, left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, paddingLeft: `${from.paddingLeft}px`, paddingRight: `${from.paddingRight}px`, borderRadius: `${from.borderRadius}px`, background: 'rgba(29, 29, 31, 0)' },
          { offset: .75, left: `${from.left + (to.left - from.left) * .75}px`, top: `${from.top + (to.top - from.top) * .75}px`, width: `${from.width + (to.width - from.width) * .75}px`, height: `${from.height + (to.height - from.height) * .75}px`, paddingLeft: `${from.paddingLeft + (to.paddingLeft - from.paddingLeft) * .75}px`, paddingRight: `${from.paddingRight + (to.paddingRight - from.paddingRight) * .75}px`, borderRadius: `${to.borderRadius}px`, background: 'rgba(29, 29, 31, 0)' },
          { offset: 1, left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, paddingLeft: `${to.paddingLeft}px`, paddingRight: `${to.paddingRight}px`, borderRadius: `${to.borderRadius}px`, background: '#1d1d1f', color: '#fff' },
        ], { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' }).finished
      }
      finished.finally(() => {
        flight.remove()
        source.classList.remove('shared-title-hidden')
        detail.classList.remove('shared-title-hidden')
      })
    })
    motionTimer.current = window.setTimeout(() => setRailMotion(null), motion === 'forward' ? 640 : 540)
  }, [])

  useEffect(() => () => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current)
  }, [])

  const toggleSidebar = useCallback(() => {
    if (window.innerWidth <= 920) {
      setSidebarOpen((current) => !current)
      return
    }
    setSidebarHidden((current) => {
      const next = !current
      localStorage.setItem('devhatch-sidebar-hidden', next ? '1' : '0')
      return next
    })
  }, [])

  const selectWorkspace = useCallback((workspace: string) => {
    setSelectedWorkspace(workspace)
    setActiveId((current) => sessions.some((session) => session.id === current && session.cwd === workspace) ? current : sessions.find((session) => session.cwd === workspace)?.id ?? null)
    setSidebarOpen(false)
  }, [sessions])

  const addSession = useCallback(async (cwd?: string) => {
    setError(null)
    try {
      const { terminal } = await createTerminal(cwd)
      setSessions((current) => [...current, terminal])
      setWorkspaces((current) => current.includes(terminal.cwd) ? current : [terminal.cwd, ...current])
      setSelectedWorkspace(terminal.cwd)
      setActiveId(terminal.id)
      setSidebarOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    void listTerminals()
      .then(({ terminals, home, resolvedHome }) => {
        setHomePaths({ home, resolvedHome })
        if (terminals.length) {
          const normalized = terminals.map((terminal) => ({ ...terminal, cwd: logicalPath(terminal.cwd, home, resolvedHome) }))
          const paths = uniqueWorkspaces(normalized)
          setSessions(normalized)
          setWorkspaces(paths)
          setSelectedWorkspace(paths[0] ?? null)
          setActiveId(normalized[0].id)
        }
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false))
  }, [addSession])

  const renameSession = useCallback(async (session: TerminalInfo) => {
    const name = window.prompt('Session name', session.name)?.trim()
    if (!name || name === session.name) return
    setActiveId(session.id)
    try {
      const { terminal } = await renameTerminal(session.id, name)
      setSessions((current) => current.map((item) => item.id === terminal.id ? terminal : item))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  const closeSession = useCallback(async (id: string) => {
    try {
      await deleteTerminal(id)
      setSessions((current) => {
        const next = current.filter((session) => session.id !== id)
        setActiveId((selected) => selected === id ? next.find((session) => session.cwd === selectedWorkspace)?.id ?? null : selected)
        return next
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [selectedWorkspace])

  const addWorkspace = useCallback((directory: string) => {
    const normalized = logicalPath(directory, homePaths?.home, homePaths?.resolvedHome)
    setWorkspaces((current) => current.includes(normalized) ? current : [normalized, ...current])
    setSelectedWorkspace(normalized)
    setActiveId(sessions.find((session) => session.cwd === normalized)?.id ?? null)
    setWorkspacePickerOpen(false)
  }, [homePaths, sessions])

  const removeWorkspace = useCallback((workspace: string) => {
    if (!window.confirm(`${workspace} will be removed from the workspace list. Running sessions are not deleted.`)) return
    setWorkspaces((current) => {
      const next = current.filter((item) => item !== workspace)
      if (selectedWorkspace === workspace) {
        const replacement = next[0] ?? null
        setSelectedWorkspace(replacement)
        setActiveId(sessions.find((session) => session.cwd === replacement)?.id ?? null)
      }
      return next
    })
  }, [selectedWorkspace, sessions])

  return (
    <main className={`app ${sidebarOpen ? 'drawer-open' : ''} ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
      {workspacePickerOpen && <WorkspacePicker initialPath={selectedWorkspace ?? undefined} onClose={() => setWorkspacePickerOpen(false)} onSelect={addWorkspace} />}
      <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />
      <aside className="rail">
        <div className="brand"><div className="brand-mark"><DevHatchLogo /></div><div><strong>DevHatch</strong><small>Developer Workspace</small></div></div>
        <div className="rail-pages">
          <section ref={modesPageRef} className={`rail-page ${railPage === 'modes' ? 'active' : ''} ${railMotion === 'forward' ? 'forward-exit' : ''} ${railMotion === 'return' ? 'return-enter' : ''}`}>
            <nav className="primary-nav" aria-label="Workspace modes">
              <button ref={terminalModeRef} className="nav-item active" onClick={() => animateRail('terminal', 'forward')}><SquareTerminal/><span>Terminal</span><b>{sessions.length}</b></button>
              <button className="nav-item disabled" title="Coming next"><Bot/><span>Agent CLI</span></button>
              <button className="nav-item disabled" title="Coming next"><Globe2/><span>Web Apps</span></button>
              <button className="nav-item disabled" title="Coming next"><Settings/><span>Settings</span></button>
            </nav>
            <div className="mode-footer">⌘ 1–4</div>
          </section>
          <section ref={terminalPageRef} className={`rail-page ${railPage === 'terminal' ? 'active' : ''} ${railMotion === 'forward' ? 'forward-enter' : ''} ${railMotion === 'return' ? 'return-exit' : ''}`}>
            <div className="rail-page-title">
              <button className="rail-back" aria-label="Back to modes" onClick={() => animateRail('modes', 'return')}><ArrowLeft/></button>
              <span ref={terminalTitleRef} className="mode-title"><SquareTerminal/><strong>Terminal</strong></span>
            </div>
            <div className={`rail-detail ${railMotion === 'forward' ? 'awaiting-title' : ''}`}>
              <div className="menu-section">
                <p className="menu-label">Workspace</p>
                <div className="workspace-list">
                  {workspaces.map((workspace) => (
                    <button key={workspace} className={`workspace-item ${workspace === selectedWorkspace ? 'active' : ''}`} onClick={() => selectWorkspace(workspace)}>
                      <Grid2X2/>
                      <span><strong>{workspaceName(workspace)}</strong><small>{displayPath(workspace, homePaths?.home, homePaths?.resolvedHome)}</small></span>
                      <span className="workspace-remove" role="button" tabIndex={0} aria-label={`Remove ${workspaceName(workspace)}`} onClick={(event) => { event.stopPropagation(); removeWorkspace(workspace) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); removeWorkspace(workspace) } }}><Trash2/></span>
                    </button>
                  ))}
                </div>
              </div>
              <button className="path-add" onClick={() => setWorkspacePickerOpen(true)}><Plus/>Add Workspace</button>
            </div>
          </section>
        </div>
      </aside>

      <section className="shell">
        <header className="topbar">
          <button className="icon-button menu-button" aria-label={window.innerWidth <= 920 ? sidebarOpen ? 'Close navigation' : 'Open navigation' : sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} aria-expanded={window.innerWidth <= 920 ? sidebarOpen : !sidebarHidden} onClick={toggleSidebar}><Menu className="menu-icon-open"/><PanelLeftClose className="menu-icon-hide"/></button>
          <div className="breadcrumb"><strong>Terminal</strong><span>{selectedWorkspace ? displayPath(selectedWorkspace, homePaths?.home, homePaths?.resolvedHome) : 'No workspace selected'}</span></div>
          <div className="top-actions"><button className="secondary-button" onClick={() => void addSession(activeSession?.cwd ?? selectedWorkspace ?? undefined)}><Plus/><span>New terminal</span></button></div>
        </header>

        <div className="terminal-workspace">
          <div className="tabbar">
            <div className="tabs">
              {visibleSessions.map((session, index) => <button key={session.id} className={`tab ${session.id === activeId ? 'active' : ''}`} onClick={() => setActiveId(session.id)}><span className={`tab-dot ${phases[session.id] ?? 'connecting'}`}/><span className="tab-name">{session.name || `Terminal ${index + 1}`}</span><span className="tab-actions"><span className="tab-action tab-rename" role="button" tabIndex={0} aria-label={`Rename ${session.name}`} onClick={(event) => { event.stopPropagation(); void renameSession(session) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void renameSession(session) } }}><Pencil/></span><span className="tab-action tab-close" role="button" tabIndex={0} aria-label={`Close ${session.name}`} onClick={(event) => { event.stopPropagation(); void closeSession(session.id) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); void closeSession(session.id) } }}><X/></span></span></button>)}
            </div>
          </div>

          <div className="stage">
            {busy && <div className="empty-state">Starting DevHatch…</div>}
            {!busy && !visibleSessions.length && <div className="empty-state"><strong>No terminal sessions are running</strong><button onClick={() => void addSession(selectedWorkspace ?? undefined)}>Create terminal</button></div>}
            {sessions.map((session) => <TerminalSurface key={session.id} session={session} active={session.id === activeId && session.cwd === selectedWorkspace} onPhaseChange={setPhase} onError={setError} />)}
            {error && <div className="error-banner">{error}<button onClick={() => setError(null)}><X/></button></div>}
          </div>

          <footer className="statusbar">
            <span className={`status-light ${activeId ? phases[activeId] ?? 'connecting' : 'disconnected'}`}/>
            <span>{activeId ? phases[activeId] ?? 'connecting' : 'No session'}</span>
            <span className="status-path">{activeSession?.shell ?? ''}</span>
            {activeSession && <><span>{activeSession.cols} × {activeSession.rows}</span><span>uptime {formatUptime(activeSession.createdAt)}</span></>}
          </footer>
          <div className="mobile-keys">{['Esc', 'Tab', 'Ctrl', 'Alt', '↑', '↓', '←', '→'].map((key) => <button key={key}>{key}</button>)}</div>
        </div>
      </section>
    </main>
  )
}

export default App
