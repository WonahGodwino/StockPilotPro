import { Bell, LogOut, Moon, Sun, Wifi, WifiOff } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import toast from 'react-hot-toast'

export default function Header() {
  const user = useAuthStore((s) => s.user)
  const { logout, refreshToken } = useAuthStore()
  const { unreadNotificationCount, darkMode, toggleDarkMode } = useAppStore()
  const navigate = useNavigate()
  const [isOnline, setIsOnline] = useState(navigator.onLine)

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
    <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-6 gap-4 flex-shrink-0">
      <div className="flex-1">
        {user?.tenant && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-medium text-gray-900 dark:text-gray-100">{user.tenant.name}</span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Online status */}
        <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${isOnline ? 'bg-success-50 text-success-600' : 'bg-warning-50 text-warning-600'}`}>
          {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {isOnline ? 'Online' : 'Offline'}
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        {/* Notifications */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
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
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-sm font-semibold">
            {user?.firstName?.[0]}{user?.lastName?.[0]}
          </div>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-50/10"
            title="Logout"
          >
            <LogOut className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
