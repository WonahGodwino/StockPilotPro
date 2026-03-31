import { Bell, LogOut, Moon, Sun, Wifi, WifiOff } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import toast from 'react-hot-toast'

const SYSTEM_NAME = 'StockPilotPro'

export default function Header() {
  const user = useAuthStore((s) => s.user)
  const { logout, refreshToken } = useAuthStore()
  const { unreadNotificationCount, darkMode, toggleDarkMode, subsidiaries } = useAppStore()
  const navigate = useNavigate()
  const [isOnline, setIsOnline] = useState(navigator.onLine)

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

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', { refreshToken })
    } catch { /* ignore */ }
    logout()
    navigate('/login')
    toast.success('Logged out successfully')
  }

  return (
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
        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${isOnline ? 'bg-success-500/20 text-success-100 border-success-300/40' : 'bg-warning-500/20 text-warning-100 border-warning-300/40'}`}>
          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {isOnline ? 'Online' : 'Offline'}
        </div>

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
  )
}
