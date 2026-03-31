import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage, Server } from 'http'
import { verifyAccessToken } from './jwt'

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean
  tenantId: string
  userId: string
}

interface WsGlobal {
  server: WebSocketServer | null
  clients: Map<string, Set<AuthenticatedWebSocket>>
}

// Use globalThis so the singleton survives Next.js hot-reload and webpack bundling
const g = globalThis as unknown as { __ws?: WsGlobal }

if (!g.__ws) {
  g.__ws = { server: null, clients: new Map() }
}

const wsState = g.__ws

/**
 * Attach a WebSocket server to the given HTTP server.
 * Handles upgrades on the `/api/ws` path only.
 * Safe to call multiple times – subsequent calls are no-ops.
 */
export function initWebSocketServer(server: Server): void {
  if (wsState.server) return

  const wss = new WebSocketServer({ noServer: true })
  wsState.server = wss

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    if (url.pathname !== '/api/ws') {
      socket.destroy()
      return
    }

    const token = url.searchParams.get('token')
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    let user: ReturnType<typeof verifyAccessToken>
    try {
      user = verifyAccessToken(token)
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const authWs = ws as AuthenticatedWebSocket
      authWs.isAlive = true
    // Reject unauthenticated connections (SUPER_ADMINs have tenantId = null;
    // they are tracked under 'global' so broadcasts work correctly)
    authWs.tenantId = user.tenantId ?? 'global'
      authWs.userId = user.userId
      wss.emit('connection', authWs)
    })
  })

  wss.on('connection', (ws: AuthenticatedWebSocket) => {
    const { tenantId } = ws

    if (!wsState.clients.has(tenantId)) {
      wsState.clients.set(tenantId, new Set())
    }
    wsState.clients.get(tenantId)!.add(ws)

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('close', () => {
      const set = wsState.clients.get(tenantId)
      if (set) {
        set.delete(ws)
        if (set.size === 0) wsState.clients.delete(tenantId)
      }
    })

    ws.on('error', () => {
      ws.terminate()
    })
  })

  // Ping/pong keepalive – drop stale connections every 30 s
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const authWs = ws as AuthenticatedWebSocket
      if (!authWs.isAlive) {
        authWs.terminate()
        return
      }
      authWs.isAlive = false
      authWs.ping()
    })
  }, 30_000)

  wss.on('close', () => clearInterval(pingInterval))
}

/**
 * Broadcast a JSON message to all connected WebSocket clients for a given tenant.
 */
export function broadcastToTenant(tenantId: string, message: object): void {
  const tenantClients = wsState.clients.get(tenantId)
  if (!tenantClients || tenantClients.size === 0) return

  const payload = JSON.stringify(message)
  tenantClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload)
    }
  })
}
