import { type ComponentType, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import type { UserRole } from '@/types'
import {
  LayoutDashboard, Package, ShoppingCart, Receipt, BarChart2,
  Building2, Users, Bell, ChevronLeft, ChevronRight,
  TrendingUp, Shield, ChevronDown, Settings, ClipboardList, BadgeCheck, Bot,
} from 'lucide-react'
import clsx from 'clsx'

type NavItem = {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  roles: UserRole[]
}

type NavSection = {
  key: string
  label: string
  onlyRole?: UserRole
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    key: 'general',
    label: 'General',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['SUPER_ADMIN', 'AGENT', 'BUSINESS_ADMIN', 'SALESPERSON'] },
      { label: 'Notifications', href: '/notifications', icon: Bell, roles: ['BUSINESS_ADMIN', 'SALESPERSON'] },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    items: [
      { label: 'Products', href: '/products', icon: Package, roles: ['BUSINESS_ADMIN', 'SALESPERSON'] },
      { label: 'Sales / POS', href: '/sales', icon: ShoppingCart, roles: ['BUSINESS_ADMIN', 'SALESPERSON'] },
      { label: 'Expenses', href: '/expenses', icon: Receipt, roles: ['SUPER_ADMIN', 'BUSINESS_ADMIN', 'SALESPERSON'] },
    ],
  },
  {
    key: 'management',
    label: 'Management',
    items: [
      { label: 'Reports', href: '/reports', icon: BarChart2, roles: ['SUPER_ADMIN', 'BUSINESS_ADMIN'] },
      { label: 'Enterprise AI', href: '/enterprise-ai', icon: Bot, roles: ['SUPER_ADMIN', 'BUSINESS_ADMIN'] },
      { label: 'Subsidiaries', href: '/subsidiaries', icon: Building2, roles: ['SUPER_ADMIN', 'BUSINESS_ADMIN'] },
      { label: 'Users', href: '/users', icon: Users, roles: ['SUPER_ADMIN', 'AGENT', 'BUSINESS_ADMIN'] },
      { label: 'Settings', href: '/settings', icon: Settings, roles: ['SUPER_ADMIN', 'AGENT', 'BUSINESS_ADMIN', 'SALESPERSON'] },
    ],
  },
  {
    key: 'superAdmin',
    label: 'Super Admin',
    onlyRole: 'SUPER_ADMIN',
    items: [
      { label: 'Tenants', href: '/admin/tenants', icon: Shield, roles: ['SUPER_ADMIN'] },
      { label: 'Plans', href: '/admin/plans', icon: TrendingUp, roles: ['SUPER_ADMIN'] },
      { label: 'Trusted Customers', href: '/admin/trusted-customers', icon: BadgeCheck, roles: ['SUPER_ADMIN'] },
      { label: 'Subscription Reminders', href: '/admin/subscription-reminders', icon: Bell, roles: ['SUPER_ADMIN'] },
      { label: 'Subscription Ledger', href: '/admin/subscription-transactions', icon: ClipboardList, roles: ['SUPER_ADMIN'] },
    ],
  },
  {
    key: 'agentOps',
    label: 'Agent Ops',
    onlyRole: 'AGENT',
    items: [
      { label: 'Tenants', href: '/admin/tenants', icon: Shield, roles: ['AGENT'] },
      { label: 'Subscription Ledger', href: '/admin/subscription-transactions', icon: ClipboardList, roles: ['AGENT'] },
    ],
  },
]

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar, unreadNotificationCount } = useAppStore()
  const user = useAuthStore((s) => s.user)

  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    general: true,
    operations: true,
    management: true,
    superAdmin: true,
    agentOps: true,
  })

  const visibleSections = useMemo(
    () =>
      navSections
        .filter((section) => !section.onlyRole || user?.role === section.onlyRole)
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => user && item.roles.includes(user.role)),
        }))
        .filter((section) => section.items.length > 0),
    [user]
  )

  const flatVisibleItems = useMemo(
    () => visibleSections.flatMap((section) => section.items),
    [visibleSections]
  )

  useEffect(() => {
    if (!sidebarOpen) return
    setOpenSections((prev) => {
      const next = { ...prev }
      visibleSections.forEach((section) => {
        if (!(section.key in next)) {
          next[section.key] = true
        }
      })
      return next
    })
  }, [sidebarOpen, visibleSections])

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <aside
      className={clsx(
        'fixed inset-y-0 left-0 z-40 bg-gray-900 text-white flex flex-col transition-all duration-300 shadow-2xl',
        sidebarOpen ? 'w-64' : 'w-16'
      )}
    >
      <div className="flex items-center h-16 px-4 border-b border-gray-700 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900">
        {sidebarOpen && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              SP
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">StockPilot Pro</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-gray-400 truncate">Business Suite</p>
            </div>
          </div>
        )}
        {!sidebarOpen && (
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center text-white font-bold text-sm mx-auto">
            SP
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={clsx(
            'ml-auto p-1 rounded-md hover:bg-gray-700 text-gray-400 hover:text-white transition-colors',
            !sidebarOpen && 'hidden'
          )}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {!sidebarOpen && (
        <button
          onClick={toggleSidebar}
          className="mx-auto mt-2 p-1 rounded-md hover:bg-gray-700 text-gray-400 hover:text-white"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      <nav className="flex-1 py-4 overflow-y-auto">
        {sidebarOpen ? (
          <div className="space-y-4 px-2">
            {visibleSections.map((section) => {
              const sectionOpen = openSections[section.key] ?? true
              return (
                <div key={section.key}>
                  <button
                    onClick={() => toggleSection(section.key)}
                    className="w-full flex items-center px-3 py-2 text-xs font-semibold tracking-[0.12em] uppercase text-gray-400 hover:text-gray-200"
                  >
                    <span className="truncate">{section.label}</span>
                    <ChevronDown className={clsx('ml-auto h-4 w-4 transition-transform', sectionOpen && 'rotate-180')} />
                  </button>
                  {sectionOpen && (
                    <ul className="space-y-1">
                      {section.items.map((item) => (
                        <li key={item.href}>
                          <NavLink
                            to={item.href}
                            className={({ isActive }) =>
                              clsx(
                                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                                isActive
                                  ? 'bg-primary-600 text-white'
                                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                              )
                            }
                          >
                            <item.icon className="w-5 h-5 flex-shrink-0" />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.href === '/notifications' && unreadNotificationCount > 0 && (
                              <span className="ml-auto bg-danger-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                                {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                              </span>
                            )}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <ul className="space-y-1 px-2">
            {flatVisibleItems.map((item) => (
              <li key={item.href}>
                <NavLink
                  to={item.href}
                  className={({ isActive }) =>
                    clsx(
                      'relative flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    )
                  }
                  title={item.label}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  {item.href === '/notifications' && unreadNotificationCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-danger-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center">
                      {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                    </span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </nav>

      {sidebarOpen && user && (
        <div className="p-4 border-t border-gray-700 bg-gray-900/80">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              {user.firstName[0]}{user.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user.firstName} {user.lastName}</p>
              <p className="text-xs text-gray-400 truncate">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}
