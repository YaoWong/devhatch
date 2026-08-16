import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import * as pty from 'node-pty'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

const port = 4173
const host = '127.0.0.1'
const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const defaultCwd = process.env.DEVHATCH_CWD ?? os.homedir()
const sessions = new Map<string, TerminalSession>()

type SessionStatus = 'running' | 'exited'

type TerminalSession = {
  id: string
  name: string
  cwd: string
  shell: string
  status: SessionStatus
  cols: number
  rows: number
  createdAt: number
  updatedAt: number
  exitCode: number | null
  process: pty.IPty
  clients: Set<WebSocket>
  output: string
}

type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }

function clampDimension(value: unknown, fallback: number) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), 1), 500)
}

function resolveShell() {
  return process.env.SHELL || '/bin/bash'
}

function sessionView(session: TerminalSession) {
  return {
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    shell: session.shell,
    status: session.status,
    cols: session.cols,
    rows: session.rows,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    exitCode: session.exitCode,
  }
}

function broadcast(session: TerminalSession, payload: object) {
  const encoded = JSON.stringify(payload)
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded)
  }
}

function createSession(options: { cwd?: unknown; cols?: unknown; rows?: unknown } = {}) {
  const requestedCwd = typeof options.cwd === 'string' ? path.resolve(options.cwd) : defaultCwd
  const cwd = existsSync(requestedCwd) ? requestedCwd : defaultCwd
  const cols = clampDimension(options.cols, 120)
  const rows = clampDimension(options.rows, 32)
  const shell = resolveShell()
  const child = pty.spawn(shell, ['-l'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>,
  })
  const now = Date.now()
  const id = randomUUID()
  const session: TerminalSession = {
    id,
    name: path.basename(cwd) || 'Terminal',
    cwd,
    shell,
    status: 'running',
    cols,
    rows,
    createdAt: now,
    updatedAt: now,
    exitCode: null,
    process: child,
    clients: new Set(),
    output: '',
  }

  child.onData((data) => {
    session.updatedAt = Date.now()
    session.output = (session.output + data).slice(-512 * 1024)
    broadcast(session, { type: 'output', data })
  })
  child.onExit(({ exitCode }) => {
    session.status = 'exited'
    session.exitCode = exitCode
    session.updatedAt = Date.now()
    broadcast(session, { type: 'exit', code: exitCode })
  })
  sessions.set(id, session)
  return session
}

const app = express()
app.use(express.json({ limit: '64kb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, sessions: sessions.size })
})

app.get('/api/filesystem/directories', async (request, response) => {
  const requestedPath = typeof request.query.path === 'string' ? request.query.path : defaultCwd
  try {
    const directory = path.resolve(requestedPath)
    const info = await stat(directory)
    if (!info.isDirectory()) {
      response.status(400).json({ error: 'NOT_A_DIRECTORY' })
      return
    }
    const entries = await readdir(directory, { withFileTypes: true })
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(directory, entry.name) }))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    response.json({
      path: directory,
      parent: directory === path.parse(directory).root ? null : path.dirname(directory),
      home: os.homedir(),
      resolvedHome: await realpath(os.homedir()),
      directories,
    })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'DIRECTORY_READ_FAILED'
    response.status(code === 'EACCES' || code === 'EPERM' ? 403 : 404).json({ error: code })
  }
})

app.get('/api/terminals', async (_request, response) => {
  response.json({ terminals: [...sessions.values()].map(sessionView), home: os.homedir(), resolvedHome: await realpath(os.homedir()) })
})

app.post('/api/terminals', (request, response) => {
  try {
    const session = createSession(request.body)
    response.status(201).json({ terminal: sessionView(session) })
  } catch (error) {
    response.status(500).json({
      error: 'TERMINAL_SPAWN_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

app.patch('/api/terminals/:id', (request, response) => {
  const session = sessions.get(request.params.id)
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
  if (!session) {
    response.status(404).json({ error: 'TERMINAL_NOT_FOUND' })
    return
  }
  if (!name || name.length > 120) {
    response.status(400).json({ error: 'INVALID_TERMINAL_NAME' })
    return
  }
  session.name = name
  session.updatedAt = Date.now()
  response.json({ terminal: sessionView(session) })
})

app.delete('/api/terminals/:id', (request, response) => {
  const session = sessions.get(request.params.id)
  if (!session) {
    response.status(404).json({ error: 'TERMINAL_NOT_FOUND' })
    return
  }
  if (session.status === 'running') session.process.kill('SIGTERM')
  for (const client of session.clients) client.close(1000, 'session terminated')
  sessions.delete(session.id)
  response.status(204).end()
})

if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get('/{*path}', (_request, response) => response.sendFile(path.join(dist, 'index.html')))
}

const server = createServer(app)
const sockets = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const match = url.pathname.match(/^\/api\/terminals\/([^/]+)\/socket$/)
  const origin = request.headers.origin
  const hostHeader = request.headers.host
  if (!match || (origin && hostHeader && new URL(origin).host !== hostHeader)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  const session = sessions.get(match[1])
  if (!session) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
    socket.destroy()
    return
  }
  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit('connection', webSocket, request, session)
  })
})

sockets.on('connection', (socket: WebSocket, _request: import('node:http').IncomingMessage, session: TerminalSession) => {
  session.clients.add(socket)
  socket.send(JSON.stringify({ type: 'ready', terminal: sessionView(session) }))
  if (session.output) socket.send(JSON.stringify({ type: 'snapshot', data: session.output }))
  if (session.status === 'exited') {
    socket.send(JSON.stringify({ type: 'exit', code: session.exitCode }))
  }

  socket.on('message', (raw: RawData) => {
    let message: ClientMessage
    try {
      message = JSON.parse(raw.toString()) as ClientMessage
    } catch {
      return
    }
    if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= 64 * 1024) {
      if (session.status === 'running') session.process.write(message.data)
      return
    }
    if (message.type === 'resize') {
      const cols = clampDimension(message.cols, session.cols)
      const rows = clampDimension(message.rows, session.rows)
      if (session.status === 'running') session.process.resize(cols, rows)
      session.cols = cols
      session.rows = rows
      session.updatedAt = Date.now()
      return
    }
    if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }))
  })

  socket.on('close', () => session.clients.delete(socket))
})

function shutdown() {
  for (const session of sessions.values()) {
    if (session.status === 'running') session.process.kill('SIGTERM')
  }
  sockets.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(port, host, () => {
  console.log(`DevHatch listening on http://${host}:${port}`)
})
