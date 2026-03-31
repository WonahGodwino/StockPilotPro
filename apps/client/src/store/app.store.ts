import { create } from 'zustand'
import type { Notification, Subsidiary } from '@/types'
import { DARK_MODE_KEY, getInitialDarkMode, applyDarkMode } from '@/lib/darkMode'

interface AppState {
  sidebarOpen: boolean
  selectedSubsidiaryId: string | null
  subsidiaries: Subsidiary[]
  notifications: Notification[]
  unreadNotificationCount: number
  darkMode: boolean

  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSelectedSubsidiaryId: (id: string | null) => void
  setSubsidiaries: (subs: Subsidiary[]) => void
  setNotifications: (notifications: Notification[]) => void
  setUnreadCount: (count: number) => void
  markNotificationRead: (id: string) => void
  toggleDarkMode: () => void
}

export const useAppStore = create<AppState>()((set) => ({
  sidebarOpen: true,
  selectedSubsidiaryId: null,
  subsidiaries: [],
  notifications: [],
  unreadNotificationCount: 0,
  darkMode: getInitialDarkMode(),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSelectedSubsidiaryId: (id) => set({ selectedSubsidiaryId: id }),
  setSubsidiaries: (subs) => set({ subsidiaries: subs }),
  setNotifications: (notifications) => set({ notifications }),
  setUnreadCount: (count) => set({ unreadNotificationCount: count }),
  markNotificationRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      unreadNotificationCount: Math.max(0, s.unreadNotificationCount - 1),
    })),
  toggleDarkMode: () =>
    set((s) => {
      const next = !s.darkMode
      localStorage.setItem(DARK_MODE_KEY, String(next))
      applyDarkMode(next)
      return { darkMode: next }
    }),
}))
