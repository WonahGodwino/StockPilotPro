import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useEffect, lazy, Suspense } from 'react'
import { useAuthStore } from '@/store/auth.store'
import { initSyncListener } from '@/lib/sync'
import api from '@/lib/api'
import AppLayout from '@/components/layout/AppLayout'

const Login = lazy(() => import('@/pages/Login'))
const SsoCallback = lazy(() => import('@/pages/SsoCallback'))
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Products = lazy(() => import('@/pages/Products'))
const SalesPage = lazy(() => import('@/pages/Sales'))
const Expenses = lazy(() => import('@/pages/Expenses'))
const Reports = lazy(() => import('@/pages/Reports'))
const Subsidiaries = lazy(() => import('@/pages/Subsidiaries'))
const Users = lazy(() => import('@/pages/Users'))
const Notifications = lazy(() => import('@/pages/Notifications'))
const TenantsPage = lazy(() => import('@/pages/superadmin/Tenants'))
const PlansPage = lazy(() => import('@/pages/superadmin/Plans'))
const SubscriptionRemindersPage = lazy(() => import('@/pages/superadmin/SubscriptionReminders'))
const SubscriptionTransactionsPage = lazy(() => import('@/pages/superadmin/SubscriptionTransactions'))
const SettingsPage = lazy(() => import('@/pages/Settings'))

function PageLoader() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="h-8 w-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
    </div>
  )
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

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    const cleanup = initSyncListener()
    return cleanup
  }, [])

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
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { fontFamily: 'Inter, sans-serif', fontSize: '14px' },
        }}
      />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/sso-callback" element={<SsoCallback />} />
          <Route
            path="/"
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
            <Route path="expenses" element={<Expenses />} />
            <Route path="reports" element={<Reports />} />
            <Route path="subsidiaries" element={<Subsidiaries />} />
            <Route path="users" element={<Users />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<SettingsPage />} />
            {/* Super Admin routes */}
            <Route
              path="admin/tenants"
              element={
                <RequireSuperAdmin>
                  <TenantsPage />
                </RequireSuperAdmin>
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
                <RequireSuperAdmin>
                  <SubscriptionTransactionsPage />
                </RequireSuperAdmin>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
