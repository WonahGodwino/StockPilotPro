import { Bell, LogOut, Moon, Sun, Wifi, WifiOff, RefreshCw, Database, History, X } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { getPendingRecordCount } from '@/lib/db'
import { getSyncHistorySnapshot, getSyncStatusSnapshot, syncPendingRecords } from '@/lib/sync'

const SYSTEM_NAME = 'StockPilotPro'

export default function Header() {
  const user = useAuthStore((s) => s.user)
  const { logout, refreshToken } = useAuthStore()
  const { unreadNotificationCount, darkMode, toggleDarkMode, subsidiaries } = useAppStore()
  const navigate = useNavigate()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState(getSyncStatusSnapshot())
  const [syncHistory, setSyncHistory] = useState(getSyncHistorySnapshot())
  const [showSyncHistory, setShowSyncHistory] = useState(false)

  const organizationLabel = useMemo(() => {
    if (!user) return ''

    if (user.role === 'SUPER_ADMIN') {
      return SYSTEM_NAME
    }

    if (user.role === 'SALESPERSON') {
      if (user.subsidiaryId) {
        const matchedSubsidiary = subsidiaries.find((s) => s.id === user.subsidiaryId)
        if (matchedSubsidiary?.name) return matchedSubsidiary.name
      }
      return user.tenant?.name || ''
    }

    return user.tenant?.name || ''
  }, [user, subsidiaries])

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [])

  useEffect(() => {
    const refreshPending = async () => {
      try {
        const count = await getPendingRecordCount()
        setPendingCount(count)
      } catch {
        setPendingCount(0)
      }
    }

    const onSyncStatus = () => {
      setSyncStatus(getSyncStatusSnapshot())
      setSyncHistory(getSyncHistorySnapshot())
      void refreshPending()
    }

    void refreshPending()
    const intervalId = setInterval(() => { void refreshPending() }, 10_000)
    window.addEventListener('stockpilot:sync-status', onSyncStatus as EventListener)

    return () => {
      clearInterval(intervalId)
      window.removeEventListener('stockpilot:sync-status', onSyncStatus as EventListener)
    }
  }, [])

  const lastSyncText = useMemo(() => {
    if (!syncStatus.lastSyncAt) return 'No sync yet'
    return `Last sync ${new Date(syncStatus.lastSyncAt).toLocaleTimeString()}`
  }, [syncStatus.lastSyncAt])

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', { refreshToken })
    } catch { /* ignore */ }
    logout()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  return (
    <>
    <header className="h-16 bg-gradient-to-r from-primary-700 via-primary-800 to-gray-900 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 border-b border-primary-900/50 dark:border-gray-700 flex items-center px-6 gap-4 flex-shrink-0 shadow-sm">
      <div className="flex-1">
        {organizationLabel && (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/20 dark:border-gray-500 bg-white/10 dark:bg-gray-800/70 backdrop-blur-sm">
            <span className="text-xs md:text-sm font-semibold uppercase tracking-[0.12em] text-primary-100 dark:text-gray-300">
              Welcome :
            </span>
            <p className="text-lg md:text-2xl font-extrabold leading-none tracking-tight text-white dark:text-gray-100 truncate max-w-[52vw]">
              {organizationLabel}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Online status */}
        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${isOnline ? 'bg-success-500/20 text-white border-success-500/50' : 'bg-warning-500/20 text-white border-warning-500/50'}`}>
          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {isOnline ? 'Online' : 'Offline'}
        </div>

        {/* Sync status */}
        <button
          onClick={() => { void syncPendingRecords() }}
          disabled={!isOnline || syncStatus.isSyncing}
          className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${pendingCount > 0 ? 'bg-warning-500/20 text-white border-warning-500/60' : 'bg-primary-500/20 text-white border-primary-500/50'} disabled:opacity-60`}
          title={`${lastSyncText}${syncStatus.lastError ? ` | ${syncStatus.lastError}` : ''}`}
        >
          {syncStatus.isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
          {syncStatus.isSyncing ? 'Syncing...' : `Sync Queue: ${pendingCount}`}
        </button>

        <button
          onClick={() => setShowSyncHistory(true)}
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors bg-white/10 text-white border-white/30 hover:bg-white/20"
          title="View sync history"
        >
          <History className="w-3.5 h-3.5" />
          Sync History
        </button>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg text-gray-200 dark:text-gray-300 hover:text-white dark:hover:text-white hover:bg-white/15 dark:hover:bg-gray-700/70"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative p-2 rounded-lg text-gray-200 dark:text-gray-300 hover:text-white dark:hover:text-white hover:bg-white/15 dark:hover:bg-gray-700/70"
        >
          <Bell className="w-5 h-5" />
          {unreadNotificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-danger-500 text-white text-xs rounded-full w-4.5 h-4.5 flex items-center justify-center min-w-[18px] min-h-[18px] text-[10px]">
              {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
            </span>
          )}
        </button>

        {/* User + Logout */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/15 text-white border border-white/20 flex items-center justify-center text-sm font-semibold">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-gray-200 dark:text-gray-300 hover:text-danger-100 hover:bg-danger-500/30"
            title="Logout"
          >
            <LogOut className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>
    </header>
    {showSyncHistory && (
      <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl bg-white rounded-xl shadow-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Sync History</h3>
              <p className="text-xs text-gray-500">Recent offline sync runs (last 20)</p>
            </div>
            <button onClick={() => setShowSyncHistory(false)} className="p-2 rounded hover:bg-gray-100 text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Pending</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Synced</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Failed</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {syncHistory.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No sync history yet.</td>
                  </tr>
                ) : syncHistory.map((entry, idx) => (
                  <tr key={`${entry.at}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{new Date(entry.at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{entry.pendingBefore}</td>
                    <td className="px-4 py-2 text-right text-success-700 font-medium">{entry.syncedCount}</td>
                    <td className="px-4 py-2 text-right text-danger-700 font-medium">{entry.failedCount}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.status === 'success' ? 'bg-success-50 text-success-700' :
                        entry.status === 'partial' ? 'bg-warning-50 text-warning-700' :
                        entry.status === 'failed' ? 'bg-danger-50 text-danger-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {entry.status.toUpperCase()}
                      </span>
                      {entry.error ? <p className="text-xs text-gray-500 mt-1">{entry.error}</p> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
