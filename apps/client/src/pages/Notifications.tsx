import { useState, useEffect } from 'react'
import api from '@/lib/api'
import type { Notification } from '@/types'
import { useAppStore } from '@/store/app.store'
import toast from 'react-hot-toast'
import { Bell, CheckCheck, AlertTriangle, Info, Package, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const TYPE_ICONS: Record<string, React.ElementType> = { LOW_STOCK: Package, SUBSCRIPTION_EXPIRY: AlertTriangle, INFO: Info, SYSTEM: Bell }
const TYPE_COLORS: Record<string, string> = { LOW_STOCK: 'text-amber-500 bg-amber-50', SUBSCRIPTION_EXPIRY: 'text-red-500 bg-red-50', INFO: 'text-blue-500 bg-blue-50', SYSTEM: 'text-gray-500 bg-gray-100' }

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const setUnread = useAppStore((s) => s.setUnreadCount)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: Notification[]; unreadCount: number }>('/notifications')
      setItems(res.data.data)
      setUnread(res.data.unreadCount)
    }
    catch { toast.error('Failed to load notifications') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const markRead = async (id: string) => {
    try {
      await api.put(`/notifications/${id}/read`, {})
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)))
      setUnread(Math.max(0, items.filter((n) => !n.isRead).length - 1))
    } catch { toast.error('Failed to mark as read') }
  }

  const markAllRead = async () => {
    try {
      const unread = items.filter((n) => !n.isRead)
      await Promise.all(unread.map((n) => api.put(`/notifications/${n.id}/read`, {})))
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnread(0)
      toast.success('All marked as read')
    } catch { toast.error('Failed') }
  }

  const visible = filter === 'unread' ? items.filter((n) => !n.isRead) : items
  const unreadCount = items.filter((n) => !n.isRead).length

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500 mt-0.5">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
        </div>
        <div className="flex gap-2">
          {(['all','unread'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{f}</button>
          ))}
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50">
              <CheckCheck className="w-4 h-4" /> Mark all read
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400"><Bell className="w-12 h-12 mb-2 opacity-30" /><p>{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p></div>
      ) : (
        <div className="space-y-2">
          {visible.map((n) => {
            const Icon = TYPE_ICONS[n.type] || Bell
            const colors = TYPE_COLORS[n.type] || TYPE_COLORS.SYSTEM
            return (
              <div key={n.id} onClick={() => !n.isRead && markRead(n.id)} className={`card flex items-start gap-4 transition-all cursor-default ${!n.isRead ? 'border-l-4 border-l-indigo-500 cursor-pointer hover:shadow-md' : 'opacity-75'}`}>
                <div className={`p-2 rounded-xl flex-shrink-0 ${colors}`}><Icon className="w-5 h-5" /></div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${!n.isRead ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{n.message}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}</p>
                </div>
                {!n.isRead && <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0 mt-1.5" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
