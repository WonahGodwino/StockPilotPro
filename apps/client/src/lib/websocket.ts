import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import type { Notification } from '@/types'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000/api/ws'

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let shouldReconnect = false

function scheduleReconnect(): void {
  if (!shouldReconnect) return
  reconnectTimer = setTimeout(connect, 5000)
}

/**
 * Open (or re-open) the authenticated WebSocket connection.
 * Passes the current access token as a query parameter since browsers
 * do not allow custom headers on native WebSocket connections.
 */
export function connect(): void {
  const token = useAuthStore.getState().accessToken
  if (!token) return

  shouldReconnect = true

  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`)

  socket.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as { type: string; data: unknown }
      if (msg.type === 'notification') {
        useAppStore.getState().addNotification(msg.data as Notification)
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[WebSocket] Failed to parse message:', err)
      }
    }
  }

  socket.onclose = () => {
    socket = null
    scheduleReconnect()
  }

  socket.onerror = () => {
    socket?.close()
  }
}

/**
 * Close the WebSocket connection and cancel any pending reconnect.
 */
export function disconnect(): void {
  shouldReconnect = false
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  socket?.close()
  socket = null
}
