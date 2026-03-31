import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAppStore } from '@/store/app.store'
import { useEffect } from 'react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore as useApp } from '@/store/app.store'
import { connect as connectWs, disconnect as disconnectWs } from '@/lib/websocket'

export default function AppLayout() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const user = useAuthStore((s) => s.user)
  const { setSubsidiaries, setNotifications, setUnreadCount } = useApp()

  useEffect(() => {
    if (!user) return
    // Load subsidiaries
    api.get('/subsidiaries').then((r) => setSubsidiaries(r.data.data)).catch(() => {})
    // Load notifications
    api.get('/notifications?limit=10').then((r) => {
      setNotifications(r.data.data)
      setUnreadCount(r.data.unreadCount)
    }).catch(() => {})
    // Connect WebSocket for real-time notifications
    connectWs()
    return () => disconnectWs()
  }, [user])

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div
        className={`flex-1 flex flex-col transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-16'} overflow-hidden`}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
