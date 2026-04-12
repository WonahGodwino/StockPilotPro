import { useEffect, useState } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts'
import { Building2, Users, TrendingUp, Zap } from 'lucide-react'
import api from '@/lib/api'
import { makeCurrencyFormatter } from '@/lib/currency'

interface PlanBreakdown {
  planId: string
  planName: string
  priceCurrency: string
  count: number
  revenue: number
}

interface PlatformStats {
  totalCompanies: number
  totalSubsidiaries: number
  activeSubscriptions: number
  expiredSubscriptions: number
  suspendedSubscriptions: number
  totalRevenue: number
  financials: {
    lifetime: {
      revenue: number
      expenses: number
      profit: number
    }
    period: {
      key: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
      startDate: string
      endDate: string
      revenue: number
      expenses: number
      profit: number
    }
  }
  baseCurrency: string
  planBreakdown: PlanBreakdown[]
  subscriptionTrend: Array<{ date: string; active: number; expired: number; suspended: number }>
  companyGrowth: Array<{ date: string; count: number }>
}

interface BackupDrillRow {
  id: string
  status: 'SUCCESS' | 'FAILED' | string
  triggerType: string
  dbConnectivityOk: boolean
  backupVerificationOk: boolean
  restoreDrillOk: boolean
  backupArtifactAgeHours: number | null
  startedAt: string
  completedAt: string | null
  errorMessage: string | null
}

interface BackupDrillSummary {
  totalRuns: number
  successRate30Days: number
  lastRun: BackupDrillRow | null
  lastSuccessfulRun: BackupDrillRow | null
  nextRecommendedRunAt: string
  recommendedCadenceHours: number
  isOverdue: boolean
}

function StatCard({
  label, value, icon: Icon, color, subtext,
}: {
  label: string; value: string | number; icon: React.ElementType; color: string; subtext?: string
}) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-3xl font-bold text-gray-900">{value}</p>
          {subtext && <p className="mt-1 text-xs text-gray-400">{subtext}</p>}
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  )
}

const PLAN_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#e11d48', '#0891b2']

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null)
  const [backupSummary, setBackupSummary] = useState<BackupDrillSummary | null>(null)
  const [backupRows, setBackupRows] = useState<BackupDrillRow[]>([])
  const [runningBackupDrill, setRunningBackupDrill] = useState(false)
  const [loading, setLoading] = useState(true)
  const [backupWarning, setBackupWarning] = useState<string | null>(null)
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'>('monthly')

  const fmt = makeCurrencyFormatter(stats?.baseCurrency || 'USD', { minimumFractionDigits: 0 })
  const formatPeriodWindow = (startIso: string, endIso: string) => {
    const start = new Date(startIso)
    const end = new Date(endIso)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Selected period'
    return `${start.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} - ${end.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}`
  }
  const formatTrendDate = (value: string) => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return period === 'yearly'
      ? parsed.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      : parsed.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })
  }

  const fetchStats = (selectedPeriod: string) => {
    setLoading(true)
    Promise.allSettled([
      api.get(`/reports/platform-stats?period=${selectedPeriod}`),
      api.get('/ops/backup-drills?limit=10'),
    ])
      .then(([platformResult, backupResult]) => {
        if (platformResult.status === 'fulfilled') {
          setStats(platformResult.value.data.data)
        } else {
          console.error('Failed to load platform stats', platformResult.reason)
          setStats(null)
        }

        if (backupResult.status === 'fulfilled') {
          setBackupSummary(backupResult.value.data?.data?.summary || null)
          setBackupRows(backupResult.value.data?.data?.rows || [])
          setBackupWarning(null)
        } else {
          console.error('Failed to load backup drill operations', backupResult.reason)
          setBackupSummary(null)
          setBackupRows([])
          setBackupWarning('Backup drill data unavailable')
        }
      })
      .finally(() => setLoading(false))
  }

  const runBackupDrill = async () => {
    setRunningBackupDrill(true)
    try {
      await api.post('/ops/backup-drills/run')
      fetchStats(period)
    } catch (err) {
      console.error('Failed to run backup drill', err)
    } finally {
      setRunningBackupDrill(false)
    }
  }

  useEffect(() => {
    fetchStats(period)
  }, [period])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div>
          <div className="h-7 bg-gray-200 rounded w-48 mb-2" />
          <div className="h-4 bg-gray-100 rounded w-72" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-6 h-32 bg-gray-100 rounded" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="card p-6 h-80 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!stats) {
    return <div className="text-center py-12 text-gray-500">Failed to load platform statistics</div>
  }

  const topPlan = stats?.planBreakdown && stats.planBreakdown.length > 0 ? stats.planBreakdown[0] : null
  const totalSubscriptionStates = stats.activeSubscriptions + stats.expiredSubscriptions + stats.suspendedSubscriptions
  const activeShare = totalSubscriptionStates > 0
    ? ((stats.activeSubscriptions / totalSubscriptionStates) * 100).toFixed(1)
    : '0.0'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">StockPilot Pro system overview</p>
        </div>
        <div className="flex gap-2">
          {(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Top Plan Card */}
      {topPlan && (
        <div className="card p-6 bg-gradient-to-br from-primary-50 to-primary-100">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-primary-700 uppercase">Top Plan</p>
              <p className="mt-2 text-2xl font-bold text-primary-900">{topPlan.planName}</p>
              <p className="mt-1 text-sm text-primary-600">{topPlan.count} active subscribers</p>
              <p className="mt-1 text-xs text-primary-600">
                {stats.activeSubscriptions > 0 ? ((topPlan.count / stats.activeSubscriptions) * 100).toFixed(1) : 0}% market share
              </p>
              <p className="mt-2 text-lg font-semibold text-primary-900">
                {fmt(topPlan.revenue)}
              </p>
            </div>
            <div className="text-3xl font-bold text-primary-300">★</div>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Registered Companies"
          value={stats.totalCompanies}
          icon={Building2}
          color="bg-primary-100 text-primary-600"
          subtext="Active tenants"
        />
        <StatCard
          label="Total Subsidiaries"
          value={stats.totalSubsidiaries}
          icon={Users}
          color="bg-success-50 text-success-600"
          subtext="Branches & offices"
        />
        <StatCard
          label="Active Subscriptions"
          value={stats.activeSubscriptions}
          icon={Zap}
          color="bg-warning-50 text-warning-600"
          subtext="Current subscribers"
        />
        <StatCard
          label="Platform Revenue"
          value={fmt(stats.totalRevenue)}
          icon={TrendingUp}
          color="bg-danger-50 text-danger-600"
          subtext="Total billing"
        />
      </div>

      {/* Backup & Restore Drill Operations */}
      <div className="card p-6 border border-indigo-200 bg-indigo-50/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-indigo-700 uppercase">Backup & Restore Drills</h3>
            <p className="text-xs text-indigo-700 mt-1">Automated verification health for backup freshness and restore readiness</p>
          </div>
          <button
            type="button"
            onClick={() => { void runBackupDrill() }}
            disabled={runningBackupDrill}
            className={`px-3 py-1 rounded-lg text-sm font-medium ${runningBackupDrill ? 'bg-indigo-300 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
          >
            {runningBackupDrill ? 'Running...' : 'Run Drill'}
          </button>
        </div>

        {backupWarning && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {backupWarning}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-4">
          <div className="rounded-lg bg-white p-3 border border-indigo-100">
            <p className="text-xs text-gray-500">Runs Tracked</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{backupSummary?.totalRuns ?? 0}</p>
          </div>
          <div className="rounded-lg bg-white p-3 border border-indigo-100">
            <p className="text-xs text-gray-500">30-Day Success Rate</p>
            <p className="text-lg font-semibold text-gray-900 mt-1">{backupSummary?.successRate30Days ?? 0}%</p>
          </div>
          <div className="rounded-lg bg-white p-3 border border-indigo-100">
            <p className="text-xs text-gray-500">Last Run</p>
            <p className="text-sm font-semibold text-gray-900 mt-1">{backupSummary?.lastRun ? new Date(backupSummary.lastRun.startedAt).toLocaleString() : 'No run yet'}</p>
          </div>
          <div className="rounded-lg bg-white p-3 border border-indigo-100">
            <p className="text-xs text-gray-500">Next Recommended</p>
            <p className={`text-sm font-semibold mt-1 ${backupSummary?.isOverdue ? 'text-danger-700' : 'text-gray-900'}`}>
              {backupSummary?.nextRecommendedRunAt ? new Date(backupSummary.nextRecommendedRunAt).toLocaleString() : 'Run now'}
            </p>
          </div>
        </div>

        {backupRows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-indigo-100">
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Started</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Status</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">DB</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Backup</th>
                  <th className="text-left py-2 pr-3 font-medium text-gray-500">Restore</th>
                  <th className="text-left py-2 font-medium text-gray-500">Backup Age (h)</th>
                </tr>
              </thead>
              <tbody>
                {backupRows.slice(0, 5).map((row) => (
                  <tr key={row.id} className="border-b border-indigo-50">
                    <td className="py-2 pr-3 text-gray-700">{new Date(row.startedAt).toLocaleString()}</td>
                    <td className={`py-2 pr-3 font-semibold ${row.status === 'SUCCESS' ? 'text-success-700' : 'text-danger-700'}`}>{row.status}</td>
                    <td className={`py-2 pr-3 ${row.dbConnectivityOk ? 'text-success-700' : 'text-danger-700'}`}>{row.dbConnectivityOk ? 'OK' : 'Fail'}</td>
                    <td className={`py-2 pr-3 ${row.backupVerificationOk ? 'text-success-700' : 'text-danger-700'}`}>{row.backupVerificationOk ? 'OK' : 'Fail'}</td>
                    <td className={`py-2 pr-3 ${row.restoreDrillOk ? 'text-success-700' : 'text-danger-700'}`}>{row.restoreDrillOk ? 'OK' : 'Fail'}</td>
                    <td className="py-2 text-gray-700">{row.backupArtifactAgeHours ?? 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Financial KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6 border border-primary-200 bg-primary-50/40">
          <h3 className="text-sm font-semibold text-primary-700 uppercase">All-Time Financials</h3>
          <p className="text-xs text-primary-600 mt-1">Ever-generated across all tenant businesses</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg bg-white p-3 border border-primary-100">
              <p className="text-xs text-gray-500">Revenue</p>
              <p className="text-base font-semibold text-gray-900 mt-1">{fmt(stats.financials.lifetime.revenue)}</p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-primary-100">
              <p className="text-xs text-gray-500">Expenses</p>
              <p className="text-base font-semibold text-gray-900 mt-1">{fmt(stats.financials.lifetime.expenses)}</p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-primary-100">
              <p className="text-xs text-gray-500">Profit</p>
              <p className={`text-base font-semibold mt-1 ${stats.financials.lifetime.profit >= 0 ? 'text-success-700' : 'text-danger-700'}`}>
                {fmt(stats.financials.lifetime.profit)}
              </p>
            </div>
          </div>
        </div>

        <div className="card p-6 border border-warning-200 bg-warning-50/40">
          <h3 className="text-sm font-semibold text-warning-700 uppercase">{period.charAt(0).toUpperCase() + period.slice(1)} Financials</h3>
          <p className="text-xs text-warning-700 mt-1">{formatPeriodWindow(stats.financials.period.startDate, stats.financials.period.endDate)}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            <div className="rounded-lg bg-white p-3 border border-warning-100">
              <p className="text-xs text-gray-500">Revenue</p>
              <p className="text-base font-semibold text-gray-900 mt-1">{fmt(stats.financials.period.revenue)}</p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-warning-100">
              <p className="text-xs text-gray-500">Expenses</p>
              <p className="text-base font-semibold text-gray-900 mt-1">{fmt(stats.financials.period.expenses)}</p>
            </div>
            <div className="rounded-lg bg-white p-3 border border-warning-100">
              <p className={`text-xs ${stats.financials.period.profit >= 0 ? 'text-success-600' : 'text-danger-600'}`}>Profit</p>
              <p className={`text-base font-semibold mt-1 ${stats.financials.period.profit >= 0 ? 'text-success-700' : 'text-danger-700'}`}>
                {fmt(stats.financials.period.profit)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Subscription Status Summary */}
      {stats.totalCompanies > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4 border-l-4 border-success-500">
            <p className="text-xs font-semibold text-gray-500 uppercase">Active</p>
            <p className="text-2xl font-bold text-success-600 mt-1">{stats.activeSubscriptions}</p>
            <p className="text-xs text-gray-400 mt-1">{activeShare}% of subscriptions</p>
          </div>
          <div className="card p-4 border-l-4 border-warning-500">
            <p className="text-xs font-semibold text-gray-500 uppercase">Expired</p>
            <p className="text-2xl font-bold text-warning-600 mt-1">{stats.expiredSubscriptions}</p>
            <p className="text-xs text-gray-400 mt-1">Needs renewal</p>
          </div>
          <div className="card p-4 border-l-4 border-danger-500">
            <p className="text-xs font-semibold text-gray-500 uppercase">Conversion Rate</p>
            <p className="text-2xl font-bold text-danger-600 mt-1">{stats.totalCompanies > 0 ? ((stats.activeSubscriptions / stats.totalCompanies) * 100).toFixed(1) : 0}%</p>
            <p className="text-xs text-gray-400 mt-1">Company adoption</p>
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan Breakdown */}
        {stats.planBreakdown && stats.planBreakdown.length > 0 && (
          <div className="card p-6 lg:col-span-2">
            <h3 className="font-semibold text-gray-900 mb-4">Subscriptions by Plan</h3>
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-medium text-gray-500">Plan</th>
                    <th className="text-right py-2 pr-4 font-medium text-gray-500">Active Subscribers</th>
                    <th className="text-right py-2 pr-4 font-medium text-gray-500">% of Subscriptions</th>
                    <th className="text-right py-2 font-medium text-gray-500">Revenue ({stats.baseCurrency})</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.planBreakdown.map((p, i) => (
                    <tr key={p.planId} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: PLAN_COLORS[i % PLAN_COLORS.length] }} />
                          <span className="font-medium text-gray-900">{p.planName}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right font-semibold text-gray-900">{p.count}</td>
                      <td className="py-3 pr-4 text-right text-gray-500">
                        {stats.activeSubscriptions > 0 ? ((p.count / stats.activeSubscriptions) * 100).toFixed(1) : 0}%
                      </td>
                      <td className="py-3 text-right font-semibold text-gray-900">{fmt(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.planBreakdown} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="planName" tick={{ fontSize: 12 }} width={90} />
                <Tooltip formatter={(value: number) => [value, 'Subscribers']} />
                <Bar dataKey="count" name="Subscribers" radius={[0, 4, 4, 0]}>
                  {stats.planBreakdown.map((_, i) => (
                    <Cell key={i} fill={PLAN_COLORS[i % PLAN_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Company Growth Trend */}
        {stats.companyGrowth.length > 0 && (
          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Company Registration Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={stats.companyGrowth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatTrendDate} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={{ fill: '#2563eb', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Subscription Status Trend */}
        {stats.subscriptionTrend.length > 0 && (
          <div className="card p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Subscription Status Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={stats.subscriptionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={formatTrendDate} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="active" fill="#22c55e" name="Active" />
                <Bar dataKey="expired" fill="#f59e0b" name="Expired" />
                <Bar dataKey="suspended" fill="#ef4444" name="Suspended" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
