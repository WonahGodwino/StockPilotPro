import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import { useEffect, lazy, Suspense } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { initSyncListener } from '@/lib/sync'
import api from '@/lib/api'
import AppLayout from '@/components/layout/AppLayout'
import { initAnalytics, trackPageView } from '@/lib/analytics'
import { getTokenExpiryMs } from '@/lib/authToken'

const Login = lazy(() => import('@/pages/Login'))
const Home = lazy(() => import('@/pages/Home'))
const SsoCallback = lazy(() => import('@/pages/SsoCallback'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Products = lazy(() => import('@/pages/Products'))
const SalesPage = lazy(() => import('@/pages/Sales'))
const CustomersPage = lazy(() => import('@/pages/Customers'))
const Expenses = lazy(() => import('@/pages/Expenses'))
const Reports = lazy(() => import('@/pages/Reports'))
const Subsidiaries = lazy(() => import('@/pages/Subsidiaries'))
const Users = lazy(() => import('@/pages/Users'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const TenantsPage = lazy(() => import('@/pages/superadmin/Tenants'))
const PlansPage = lazy(() => import('@/pages/superadmin/Plans'))
const TrustedCustomersPage = lazy(() => import('@/pages/superadmin/TrustedCustomers'))
const SubscriptionRemindersPage = lazy(() => import('@/pages/superadmin/SubscriptionReminders'))
const SubscriptionTransactionsPage = lazy(() => import('@/pages/superadmin/SubscriptionTransactions'))
const SystemMaintenancePage = lazy(() => import('@/pages/superadmin/SystemMaintenance'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const EnterpriseAIPage = lazy(() => import('@/pages/EnterpriseAI'))

function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
    </div>
  )
}

function RouteAnalyticsTracker() {
  const location = useLocation()

  useEffect(() => {
    const fullPath = `${location.pathname}${location.search}`
    trackPageView(fullPath, document.title)
  }, [location.pathname, location.search])

  return null
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  if (!hasHydrated) return <PageLoader />
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  if (!hasHydrated) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'SUPER_ADMIN') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function RequireSuperAdminOrAgent({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  if (!hasHydrated) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'SUPER_ADMIN' && user.role !== 'AGENT') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const accessToken = useAuthStore((s) => s.accessToken)
  const logout = useAuthStore((s) => s.logout)

  useEffect(() => {
    initAnalytics()
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    const cleanup = initSyncListener()
    return cleanup
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return

    const expiryMs = getTokenExpiryMs(accessToken)
    if (!expiryMs) return

    const msUntilExpiry = expiryMs - Date.now()
    if (msUntilExpiry <= 0) {
      toast.error('Session expired. Please sign in again.')
      logout()
      return
    }

    const timeoutId = setTimeout(() => {
      toast.error('Session expired. Please sign in again.')
      logout()
    }, msUntilExpiry)

    return () => clearTimeout(timeoutId)
  }, [isAuthenticated, accessToken, logout])

  useEffect(() => {
    if (!isAuthenticated) return

    let intervalId: ReturnType<typeof setInterval> | null = null

    const sendPresence = async () => {
      if (!navigator.onLine) return
      try {
        await api.post('/users/presence')
      } catch {
        // Presence heartbeat failures should never block app usage.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void sendPresence()
      }
    }

    void sendPresence()
    intervalId = setInterval(() => { void sendPresence() }, 60_000)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isAuthenticated])

  return (
    <BrowserRouter>
      <RouteAnalyticsTracker />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { fontFamily: 'Inter, sans-serif', fontSize: '14px' },
        }}
      />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/sso-callback" element={<SsoCallback />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="reports" element={<Reports />} />
            <Route path="subsidiaries" element={<Subsidiaries />} />
            <Route path="users" element={<Users />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="enterprise-ai" element={<EnterpriseAIPage />} />
            {/* Super Admin routes */}
            <Route
              path="admin/tenants"
              element={
                <RequireSuperAdminOrAgent>
                  <TenantsPage />
                </RequireSuperAdminOrAgent>
              }
            />
            <Route
              path="admin/plans"
              element={
                <RequireSuperAdmin>
                  <PlansPage />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="admin/trusted-customers"
              element={
                <RequireSuperAdmin>
                  <TrustedCustomersPage />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="admin/subscription-reminders"
              element={
                <RequireSuperAdmin>
                  <SubscriptionRemindersPage />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="admin/subscription-transactions"
              element={
                <RequireSuperAdminOrAgent>
                  <SubscriptionTransactionsPage />
                </RequireSuperAdminOrAgent>
              }
            />
            <Route
              path="admin/system-maintenance"
              element={
                <RequireSuperAdmin>
                  <SystemMaintenancePage />
                </RequireSuperAdmin>
              }
            />
          </Route>
          <Route
            path="/app"
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="products" element={<Products />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="expenses" element={<Expenses />} />
            <Route path="reports" element={<Reports />} />
            <Route path="subsidiaries" element={<Subsidiaries />} />
            <Route path="users" element={<Users />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="enterprise-ai" element={<EnterpriseAIPage />} />
            {/* Super Admin routes */}
            <Route
              path="admin/tenants"
              element={
                <RequireSuperAdminOrAgent>
                  <TenantsPage />
                </RequireSuperAdminOrAgent>
              }
            />
            <Route
              path="admin/plans"
              element={
                <RequireSuperAdmin>
                  <PlansPage />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="admin/trusted-customers"
              element={
                <RequireSuperAdmin>
                  <TrustedCustomersPage />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="admin/subscription-reminders"
              element={
                <RequireSuperAdmin>
                  <SubscriptionRemindersPage />
                </RequireSuperAdmin>
              }
            />
            <Route
              path="admin/subscription-transactions"
              element={
                <RequireSuperAdminOrAgent>
                  <SubscriptionTransactionsPage />
                </RequireSuperAdminOrAgent>
              }
            />
            <Route
              path="admin/system-maintenance"
              element={
                <RequireSuperAdmin>
                  <SystemMaintenancePage />
                </RequireSuperAdmin>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
