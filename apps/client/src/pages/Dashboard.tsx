import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts'
import { TrendingUp, TrendingDown, Package, ShoppingCart, Building2, Bell, AlertTriangle, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
import type { DashboardData, ReportSummary, Product } from '@/types'
import { useAuthStore } from '@/store/auth.store'
import { makeCurrencyFormatter } from '@/lib/currency'
import SuperAdminDashboard from '@/components/layout/SuperAdminDashboard'

interface ExpiringProductsData {
  expiring: Product[]
  expired: Product[]
  expiringCount: number
  expiredCount: number
}

function StatCard({
  label, value, icon: Icon, color, subtext, subtextHref, trend,
}: {
  label: string; value: string; icon: React.ElementType
  color: string; subtext?: string; subtextHref?: string; trend?: 'up' | 'down'
}) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
          {subtext && subtextHref ? (
            <Link to={subtextHref} aria-label="View products with low stock" className="mt-1 text-xs text-primary-600 hover:underline">{subtext}</Link>
          ) : subtext ? (
            <p className="mt-1 text-xs text-gray-400">{subtext}</p>
          ) : null}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {trend && (
        <div className={`mt-3 flex items-center gap-1 text-xs ${trend === 'up' ? 'text-success-600' : 'text-danger-600'}`}>
          {trend === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
        </div>
      )}
    </div>
  )
}

function ExpiryStatusBadge({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return null
  
  const today = new Date()
  const expiry = new Date(expiryDate)
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  if (daysUntilExpiry < 0) {
    return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-danger-100 text-danger-700">Expired</span>
  }
  
  if (daysUntilExpiry <= 7) {
    return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-warning-100 text-warning-700">Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}</span>
  }
  
  return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}</span>
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-7 bg-gray-200 rounded w-36 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-56" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={`stat-skeleton-${i}`} className="card p-6">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
                <div className="h-7 bg-gray-300 rounded w-20 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-16" />
              </div>
              <div className="w-11 h-11 bg-gray-200 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={`metric-skeleton-${i}`} className="card p-5">
            <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
            <div className="h-6 bg-gray-300 rounded w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <div key={`chart-skeleton-${i}`} className="card p-6">
            <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
            <div className="h-[220px] bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)

  // Render SUPER_ADMIN dashboard for platform owner
  if (user?.role === 'SUPER_ADMIN') {
    return <SuperAdminDashboard />
  }

  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency, { minimumFractionDigits: 0 })
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [report, setReport] = useState<ReportSummary | null>(null)
  const [expiringProducts, setExpiringProducts] = useState<ExpiringProductsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/reports/dashboard'),
      api.get('/reports?period=monthly'),
      api.get('/products/expiring?daysAhead=30'),
    ])
      .then(([d, r, e]) => {
        setDashboard(d.data.data)
        setReport(r.data.data.summary)
        setExpiringProducts(e.data.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <DashboardSkeleton />
  }

  const canViewPL = user?.role !== 'SALESPERSON'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview for this month</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Sales This Month"
          value={fmt(dashboard?.salesThisMonth ?? 0)}
          icon={ShoppingCart}
          color="bg-primary-100 text-primary-600"
          subtext={`${dashboard?.salesCount ?? 0} transactions`}
        />
        <StatCard
          label="Total Products"
          value={(dashboard?.totalProducts ?? 0).toString()}
          icon={Package}
          color="bg-success-50 text-success-600"
          subtext={`${dashboard?.lowStockCount ?? 0} low stock`}
          subtextHref="/products?lowStock=true"
        />
        <StatCard
          label="Active Branches"
          value={(dashboard?.activeSubsidiaries ?? 0).toString()}
          icon={Building2}
          color="bg-warning-50 text-warning-600"
        />
        <StatCard
          label="Notifications"
          value={(dashboard?.unreadNotifications ?? 0).toString()}
          icon={Bell}
          color="bg-danger-50 text-danger-500"
          subtext="Unread"
        />
      </div>

      {/* Inventory Alerts */}
      {expiringProducts && (expiringProducts.expiredCount > 0 || expiringProducts.expiringCount > 0) && (
        <div className="space-y-3">
          {/* Expired Products Alert */}
          {expiringProducts.expiredCount > 0 && (
            <div className="card p-4 border-l-4 border-danger-500 bg-danger-50">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-danger-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-danger-900">Expired Products</h3>
                    <p className="text-sm text-danger-700 mt-1">{expiringProducts.expiredCount} product{expiringProducts.expiredCount !== 1 ? 's' : ''} have expired. Please remove or mark them as damaged.</p>
                    {expiringProducts.expired.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {expiringProducts.expired.slice(0, 3).map((p) => (
                          <p key={p.id} className="text-xs text-danger-700">• {p.name} ({p.subsidiary?.name})</p>
                        ))}
                        {expiringProducts.expired.length > 3 && (
                          <p className="text-xs text-danger-700 font-medium">+ {expiringProducts.expired.length - 3} more...</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Link to="/products?filter=expired" className="text-xs font-medium text-danger-600 hover:underline flex-shrink-0">View</Link>
              </div>
            </div>
          )}

          {/* Expiring Soon Alert */}
          {expiringProducts.expiringCount > 0 && (
            <div className="card p-4 border-l-4 border-warning-500 bg-warning-50">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-warning-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="font-semibold text-warning-900">Expiring Soon</h3>
                    <p className="text-sm text-warning-700 mt-1">{expiringProducts.expiringCount} product{expiringProducts.expiringCount !== 1 ? 's' : ''} expiring within 30 days.</p>
                    {expiringProducts.expiring.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {expiringProducts.expiring.slice(0, 3).map((p) => (
                          <p key={p.id} className="text-xs text-warning-700">• {p.name} ({p.subsidiary?.name}) – {new Date(p.expiryDate!).toLocaleDateString()}</p>
                        ))}
                        {expiringProducts.expiring.length > 3 && (
                          <p className="text-xs text-warning-700 font-medium">+ {expiringProducts.expiring.length - 3} more...</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Link to="/products?filter=expiring" className="text-xs font-medium text-warning-600 hover:underline flex-shrink-0">View</Link>
              </div>
            </div>
          )}
        </div>
      )}


      {canViewPL && report && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Sales</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmt(report.totalSales)}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Expenses</p>
            <p className="text-xl font-bold text-danger-600 mt-1">{fmt(report.totalExpenses)}</p>
          </div>
          <div className="card p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Gross Profit</p>
            <p className={`text-xl font-bold mt-1 ${report.grossProfit >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
              {fmt(report.grossProfit)}
            </p>
          </div>
          <div className="card p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Profit</p>
            <p className={`text-xl font-bold mt-1 ${report.netProfit >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
              {fmt(report.netProfit)}
            </p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Trend */}
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Sales Trend (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dashboard?.salesTrend ?? []}>
              <defs>
                <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Area isAnimationActive type="monotone" dataKey="total" stroke="#2563eb" fill="url(#salesGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Monthly Revenue vs Expenses */}
        {canViewPL && report && (
          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Monthly Revenue vs Expenses</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={[{ name: 'This Month', Revenue: report.totalSales, Expenses: report.totalExpenses }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
                <Bar isAnimationActive dataKey="Revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive dataKey="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
