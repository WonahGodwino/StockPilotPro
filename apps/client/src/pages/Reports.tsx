import { useState, useEffect, useCallback } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { TrendingUp, TrendingDown, DollarSign, Package, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { makeCurrencyFormatter } from '@/lib/currency'

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
type AgentPerformanceView = 'summary' | 'detailed'
type PaymentStatusFilter = 'ALL' | 'PENDING' | 'PAID'
const EXPENSE_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6']

interface ReportSummary {
  totalSales: number
  operatingRevenue?: number
  subscriptionRevenue?: number
  subscriptionRevenueNative?: number
  subscriptionBillingCurrency?: string
  totalExpenses: number
  cogs: number
  grossProfit: number
  netProfit: number
  totalProductWorth: number
  salesCount: number
}

interface ReportsResponse {
  data: {
    summary: ReportSummary
    baseCurrency: string
    topProducts: Array<{ name: string; totalRevenue: number }>
    expenseByCategory: Array<{ category: string; total: number }>
  }
}

interface ReminderRow {
  id: string
  daysLeft: number
}

interface AgentPerformanceSummaryRow {
  agentId: string
  agentName: string
  agentEmail: string
  newSubscriptions: number
  renewals: number
  totalAmountGenerated: number
  pendingRecords: number
  paidRecords: number
  totalRecords: number
}

interface AgentPerformanceDetailedRow {
  transactionId: string
  initiatedAt: string
  transactionStatus: string
  paymentStatus: 'PENDING' | 'PAID'
  paidAt: string | null
  source: string | null
  reportFileName: string | null
  batchId: string | null
  cycleStartAt: string | null
  cycleEndAt: string | null
  agentId: string
  agentName: string
  agentEmail: string
  tenantId: string
  tenantName: string
  changeType: string
  amountGenerated: number
  amountOriginal: number
  currency: string
}

interface AgentPerformanceResponse {
  data: {
    period: string
    dateRange: {
      from: string | null
      to: string | null
    }
    baseCurrency: string
    summary: {
      totals: {
        agents: number
        newSubscriptions: number
        renewals: number
        totalAmountGenerated: number
      }
      rows: AgentPerformanceSummaryRow[]
    }
    details: {
      appliedFilters: {
        paymentStatus: PaymentStatusFilter
        batchId: string | null
        withoutBatch: boolean
      }
      availableBatchIds: string[]
      batchSummaries: Array<{
        batchId: string
        paidRecords: number
        paidAmountGenerated: number
        firstPaidAt: string | null
        lastPaidAt: string | null
        cycleStartAt: string | null
        cycleEndAt: string | null
      }>
      selectedBatchSummary: {
        batchId: string
        paidRecords: number
        paidAmountGenerated: number
        firstPaidAt: string | null
        lastPaidAt: string | null
        cycleStartAt: string | null
        cycleEndAt: string | null
      } | null
      totals: {
        records: number
        pending: number
        paid: number
        totalAmountGenerated: number
      }
      records: AgentPerformanceDetailedRow[]
    }
  }
}

interface AgentPerformanceUpdateResponse {
  data: {
    batchId: string
    updatedCount: number
    skipped: number
  }
}

interface AgentPerformanceUploadResponse {
  data: {
    fileName: string
    batchId: string
    parsedCount: number
    updatedCount: number
    skipped: number
  }
}

export default function Reports() {
  const user = useAuthStore((s) => s.user)
  const [period, setPeriod] = useState<Period>('weekly')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [report, setReport] = useState<ReportsResponse['data'] | null>(null)
  const [agentPerformance, setAgentPerformance] = useState<AgentPerformanceResponse['data'] | null>(null)
  const [agentView, setAgentView] = useState<AgentPerformanceView>('summary')
  const [remittanceFile, setRemittanceFile] = useState<File | null>(null)
  const [detailPaymentFilter, setDetailPaymentFilter] = useState<PaymentStatusFilter>('ALL')
  const [detailBatchId, setDetailBatchId] = useState('')
  const [withoutBatchOnly, setWithoutBatchOnly] = useState(false)
  const [manualBatchId, setManualBatchId] = useState('')
  const [expiringSummary, setExpiringSummary] = useState<{ within30: number; next30: number }>({ within30: 0, next30: 0 })
  const [loading, setLoading] = useState(false)
  const [agentLoading, setAgentLoading] = useState(false)
  const [updatingRemittance, setUpdatingRemittance] = useState(false)
  const [uploadingRemittance, setUploadingRemittance] = useState(false)
  const reportsCacheKey = `stockpilot:reports-snapshot:${user?.tenantId || 'none'}:${user?.role || 'none'}:${period}`
  const agentCacheKey = `stockpilot:agent-performance:${period}:${customFrom || 'none'}:${customTo || 'none'}:${detailPaymentFilter}:${detailBatchId || 'all'}:${withoutBatchOnly ? 'without-batch' : 'all-batch'}`

  const getCycleRange = useCallback(() => {
    const from = customFrom || agentPerformance?.dateRange.from || ''
    const to = customTo || agentPerformance?.dateRange.to || ''
    return { from, to }
  }, [customFrom, customTo, agentPerformance?.dateRange.from, agentPerformance?.dateRange.to])

  const fetchReport = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = { period }
      if (period === 'custom') {
        if (!customFrom || !customTo) return
        params.from = customFrom
        params.to = customTo
      }
      const res = await api.get<ReportsResponse>('/reports', { params })
      setReport(res.data.data)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(reportsCacheKey, JSON.stringify({ report: res.data.data, cachedAt: new Date().toISOString() }))
      }
    } catch {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(reportsCacheKey)
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { report: ReportsResponse['data'] }
            setReport(parsed.report)
            return
          } catch {
            // fall through to error toast
          }
        }
      }
      toast.error('Failed to load report')
    } finally {
      setLoading(false)
    }
  }, [period, customFrom, customTo, reportsCacheKey])

  const fetchAgentPerformance = useCallback(async () => {
    if (user?.role !== 'SUPER_ADMIN') return
    setAgentLoading(true)
    try {
      const params: Record<string, string> = { period }
      if (period === 'custom') {
        if (!customFrom || !customTo) return
        params.from = customFrom
        params.to = customTo
      }
      if (detailPaymentFilter !== 'ALL') params.paymentStatus = detailPaymentFilter
      if (detailBatchId.trim()) params.batchId = detailBatchId.trim()
      if (withoutBatchOnly) params.withoutBatch = '1'
      const res = await api.get<AgentPerformanceResponse>('/reports/agent-performance', { params })
      setAgentPerformance(res.data.data)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(agentCacheKey, JSON.stringify({ report: res.data.data, cachedAt: new Date().toISOString() }))
      }
    } catch {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(agentCacheKey)
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { report: AgentPerformanceResponse['data'] }
            setAgentPerformance(parsed.report)
            return
          } catch {
            // fall through to toast
          }
        }
      }
      toast.error('Failed to load agent performance report')
    } finally {
      setAgentLoading(false)
    }
  }, [user?.role, period, customFrom, customTo, detailPaymentFilter, detailBatchId, withoutBatchOnly, agentCacheKey])

  const markTransactionAsPaid = async (transactionId: string) => {
    setUpdatingRemittance(true)
    try {
      const cycle = getCycleRange()
      const res = await api.patch<AgentPerformanceUpdateResponse>('/reports/agent-performance', {
        transactionIds: [transactionId],
        batchId: manualBatchId.trim() || undefined,
        cycleFrom: cycle.from || undefined,
        cycleTo: cycle.to || undefined,
      })
      toast.success(`Updated ${res.data.data.updatedCount} record(s) as paid in batch ${res.data.data.batchId}`)
      await fetchAgentPerformance()
    } catch {
      toast.error('Failed to update remittance status')
    } finally {
      setUpdatingRemittance(false)
    }
  }

  const uploadRemittanceReport = async () => {
    if (!remittanceFile) {
      toast.error('Select a CSV report file first')
      return
    }

    setUploadingRemittance(true)
    try {
      const cycle = getCycleRange()
      const formData = new FormData()
      formData.append('file', remittanceFile)
      if (manualBatchId.trim()) formData.append('batchId', manualBatchId.trim())
      if (cycle.from) formData.append('cycleFrom', cycle.from)
      if (cycle.to) formData.append('cycleTo', cycle.to)
      const res = await api.post<AgentPerformanceUploadResponse>('/reports/agent-performance', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(`Processed ${res.data.data.updatedCount}/${res.data.data.parsedCount} records as paid in batch ${res.data.data.batchId}`)
      setRemittanceFile(null)
      await fetchAgentPerformance()
    } catch {
      toast.error('Failed to upload remittance report')
    } finally {
      setUploadingRemittance(false)
    }
  }

  const markVisiblePendingAsPaid = async () => {
    const pendingIds = (agentPerformance?.details.records || [])
      .filter((row) => row.paymentStatus === 'PENDING')
      .map((row) => row.transactionId)

    if (!pendingIds.length) {
      toast.error('No pending records available in current view')
      return
    }

    setUpdatingRemittance(true)
    try {
      const cycle = getCycleRange()
      const res = await api.patch<AgentPerformanceUpdateResponse>('/reports/agent-performance', {
        transactionIds: pendingIds,
        batchId: manualBatchId.trim() || undefined,
        cycleFrom: cycle.from || undefined,
        cycleTo: cycle.to || undefined,
      })
      toast.success(`Marked ${res.data.data.updatedCount} records as paid in batch ${res.data.data.batchId}`)
      await fetchAgentPerformance()
    } catch {
      toast.error('Failed to bulk update remittance status')
    } finally {
      setUpdatingRemittance(false)
    }
  }

  useEffect(() => {
    if (period !== 'custom') fetchReport()
  }, [period, fetchReport])

  useEffect(() => {
    if (period !== 'custom') fetchAgentPerformance()
  }, [period, fetchAgentPerformance])

  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return
    api.get('/subscriptions/reminders', { params: { window: 'two_months' } })
      .then((res) => {
        const rows: ReminderRow[] = res.data?.data || []
        const within30 = rows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 30).length
        const next30 = rows.filter((r) => r.daysLeft > 30 && r.daysLeft <= 60).length
        setExpiringSummary({ within30, next30 })
      })
      .catch(() => undefined)
  }, [user?.role])

  if (!user || user.role === 'SALESPERSON') return <Navigate to="/dashboard" replace />

  const baseCurrency = report?.baseCurrency || user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency, { maximumFractionDigits: 0 })
  const expenseByCat = report?.expenseByCategory
    ? report.expenseByCategory.map((e) => ({ name: e.category, value: e.total }))
    : []
  const summary = report?.summary
  const isPlatformView = user?.role === 'SUPER_ADMIN' && !!summary?.subscriptionRevenue

  const handleGenerate = async () => {
    await fetchReport()
    await fetchAgentPerformance()
  }

  const exportAgentPerformanceCsv = (paidOnly = false) => {
    const rows = (agentPerformance?.details.records || []).filter((row) => !paidOnly || row.paymentStatus === 'PAID')
    if (!rows.length) {
      toast.error(paidOnly ? 'No PAID records to export' : 'No agent performance data to export')
      return
    }

    const escapeCell = (value: unknown): string => {
      const text = String(value ?? '')
      if (text.includes('"') || text.includes(',') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`
      }
      return text
    }

    const header = [
      'Period',
      'From',
      'To',
      'Transaction ID',
      'Date',
      'Agent Name',
      'Agent ID',
      'Agent Email',
      'Tenant Name',
      'Tenant ID',
      'Change Type',
      'Amount (Base)',
      'Original Amount',
      'Original Currency',
      'Payment Status',
      'Batch ID',
      'Cycle From',
      'Cycle To',
      'Paid At',
      'Source',
      'Report File',
      'Transaction Status',
    ]

    const lines = rows.map((row) => [
      period,
      customFrom || agentPerformance?.dateRange.from || '',
      customTo || agentPerformance?.dateRange.to || '',
      row.transactionId,
      new Date(row.initiatedAt).toISOString(),
      row.agentName,
      row.agentId,
      row.agentEmail,
      row.tenantName,
      row.tenantId,
      row.changeType,
      row.amountGenerated,
      row.amountOriginal,
      row.currency,
      row.paymentStatus,
      row.batchId || '',
      row.cycleStartAt || customFrom || agentPerformance?.dateRange.from || '',
      row.cycleEndAt || customTo || agentPerformance?.dateRange.to || '',
      row.paidAt || '',
      row.source || '',
      row.reportFileName || '',
      row.transactionStatus,
    ])

    const csv = [header, ...lines].map((line) => line.map(escapeCell).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${paidOnly ? 'agent-remittance-receipt-paid' : 'agent-performance-detail'}-${period}-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadBatchReceipt = async (batchId: string) => {
    if (!batchId) {
      toast.error('Select a batch first')
      return
    }

    try {
      const res = await api.get(`/reports/agent-performance/batches/${encodeURIComponent(batchId)}`, {
        params: { format: 'csv' },
        responseType: 'blob',
      })

      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `agent-remittance-${batchId}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download batch receipt')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Profit &amp; Loss Overview
            {baseCurrency && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs font-medium">
                {baseCurrency}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {(['daily','weekly','monthly','quarterly','yearly','custom'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${period === p ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{p}</button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex gap-3 items-end">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">From</label><input type="date" className="input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">To</label><input type="date" className="input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>
          <button onClick={handleGenerate} disabled={!customFrom || !customTo || loading || agentLoading} className="btn-primary">Generate</button>
        </div>
      )}

      {loading && <div className="flex items-center justify-center h-48 text-indigo-600"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}

      {!loading && report && summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue', value: fmt(summary.totalSales), icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Gross Profit', value: fmt(summary.grossProfit), icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Total Expenses', value: fmt(summary.totalExpenses), icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-50' },
              { label: 'Net Profit', value: fmt(summary.netProfit), icon: TrendingUp, color: summary.netProfit >= 0 ? 'text-emerald-600' : 'text-red-500', bg: summary.netProfit >= 0 ? 'bg-emerald-50' : 'bg-red-50' },
            ].map((card) => (
              <div key={card.label} className="card">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${card.bg}`}><card.icon className={`w-5 h-5 ${card.color}`} /></div>
                  <div><p className="text-xs text-gray-500">{card.label}</p><p className={`text-lg font-bold ${card.color}`}>{card.value}</p></div>
                </div>
              </div>
            ))}
          </div>

          {/* Tenant-only inventory profitability cards */}
          {!isPlatformView && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="card"><p className="text-sm text-gray-500">Cost of Goods Sold</p><p className="text-xl font-bold text-gray-800 mt-1">{fmt(summary.cogs)}</p></div>
              <div className="card"><p className="text-sm text-gray-500">Total Product Worth</p><p className="text-xl font-bold text-gray-800 mt-1">{fmt(summary.totalProductWorth)}</p></div>
              <div className="card flex items-center gap-3">
                <Package className="w-8 h-8 text-indigo-400" />
                <div><p className="text-sm text-gray-500">Profit Margin</p><p className="text-xl font-bold text-indigo-600 mt-1">{summary.totalSales > 0 ? ((summary.netProfit / summary.totalSales) * 100).toFixed(1) : 0}%</p></div>
              </div>
            </div>
          )}

          {isPlatformView && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-2">Platform Subscription Revenue</h3>
              <p className="text-sm text-gray-500 mb-3">
                Tenant subscriptions are billed in each plan's configured currency and converted to {baseCurrency} for profit reporting.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Operating Revenue</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(summary.operatingRevenue || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Subscription Revenue ({baseCurrency})</p>
                  <p className="text-lg font-bold text-emerald-600">{fmt(summary.subscriptionRevenue || 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider">
                    {summary.subscriptionBillingCurrency === 'MIXED'
                      ? 'Billing Currency'
                      : `Subscription Revenue (${summary.subscriptionBillingCurrency || baseCurrency})`}
                  </p>
                  <p className="text-lg font-bold text-indigo-600">
                    {summary.subscriptionBillingCurrency === 'MIXED'
                      ? 'Mixed currencies'
                      : (summary.subscriptionRevenueNative || 0).toLocaleString(undefined, { style: 'currency', currency: summary.subscriptionBillingCurrency || baseCurrency })}
                  </p>
                </div>
              </div>
            </div>
          )}

          {isPlatformView && (
            <div className="card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-gray-800 mb-2">Expiring Subscription Alerts</h3>
                  <p className="text-sm text-gray-500">Tenants approaching renewal are tracked here for proactive outreach.</p>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <p className="text-warning-700 font-medium">This Month: {expiringSummary.within30}</p>
                    <p className="text-primary-700 font-medium">Upcoming Month: {expiringSummary.next30}</p>
                  </div>
                </div>
                <Link to="/admin/subscription-reminders" className="btn-primary">
                  Open Reminder Center
                </Link>
              </div>
            </div>
          )}

          {/* Tenant operational charts */}
          {!isPlatformView && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top Products */}
              {report.topProducts && report.topProducts.length > 0 && (
                <div className="card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-800">Top Products by Revenue</h3>
                    <Download className="w-4 h-4 text-gray-400" />
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={report.topProducts.map((p) => ({ name: p.name, revenue: p.totalRevenue }))} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                        {report.topProducts.map((_, i) => (
                          <Cell key={`product-bar-${i}`} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Expenses by Category */}
              {expenseByCat.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-gray-800 mb-4">Expenses by Category</h3>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={expenseByCat} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {expenseByCat.map((_, i) => <Cell key={i} fill={EXPENSE_COLORS[i % EXPENSE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {isPlatformView && (
            <div className="card">
              <h3 className="font-semibold text-gray-800 mb-2">Platform Analytics Scope</h3>
              <p className="text-sm text-gray-500">
                Product and expense charts are tenant-level operational metrics and are hidden for platform reports.
                Use the Platform Dashboard for plan adoption and subscription trend analytics.
              </p>
            </div>
          )}

          {user?.role === 'SUPER_ADMIN' && (
            <div className="card space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-gray-800">Agent Performance</h3>
                  <p className="text-sm text-gray-500">Summary and detailed remittance tracking for agent commission performance.</p>
                </div>
                <div className="text-right space-y-2">
                  <button className="btn-primary inline-flex items-center gap-2" onClick={() => exportAgentPerformanceCsv(false)}>
                    <Download className="w-4 h-4" /> Export CSV
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${agentView === 'summary' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
                  onClick={() => setAgentView('summary')}
                >
                  Summary
                </button>
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${agentView === 'detailed' ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}
                  onClick={() => setAgentView('detailed')}
                >
                  Detailed
                </button>
              </div>

              {agentLoading && <p className="text-sm text-gray-500">Loading agent performance report...</p>}

              {!agentLoading && agentPerformance && agentView === 'summary' && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Agents</p>
                      <p className="text-lg font-semibold text-gray-900">{agentPerformance.summary.totals.agents}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">New Subscriptions</p>
                      <p className="text-lg font-semibold text-gray-900">{agentPerformance.summary.totals.newSubscriptions}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Renewals</p>
                      <p className="text-lg font-semibold text-gray-900">{agentPerformance.summary.totals.renewals}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Total Amount</p>
                      <p className="text-lg font-semibold text-emerald-600">{fmt(agentPerformance.summary.totals.totalAmountGenerated)}</p>
                    </div>
                  </div>

                  {agentPerformance.summary.rows.length === 0 ? (
                    <p className="text-sm text-gray-500">No summary records found for the selected period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[900px] text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-gray-500">
                            <th className="py-2 text-left">Agent</th>
                            <th className="py-2 text-left">Agent ID</th>
                            <th className="py-2 text-right">New</th>
                            <th className="py-2 text-right">Renewals</th>
                            <th className="py-2 text-right">Pending</th>
                            <th className="py-2 text-right">Paid</th>
                            <th className="py-2 text-right">Total Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentPerformance.summary.rows.map((row) => (
                            <tr key={row.agentId} className="border-b border-gray-50">
                              <td className="py-3">
                                <p className="font-medium text-gray-900">{row.agentName}</p>
                                <p className="text-xs text-gray-500">{row.agentEmail}</p>
                              </td>
                              <td className="py-3 font-mono text-xs text-gray-600">{row.agentId}</td>
                              <td className="py-3 text-right">{row.newSubscriptions}</td>
                              <td className="py-3 text-right">{row.renewals}</td>
                              <td className="py-3 text-right text-amber-700">{row.pendingRecords}</td>
                              <td className="py-3 text-right text-emerald-700">{row.paidRecords}</td>
                              <td className="py-3 text-right font-semibold text-emerald-600">{fmt(row.totalAmountGenerated)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {!agentLoading && agentPerformance && agentView === 'detailed' && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Records</p>
                      <p className="text-lg font-semibold text-gray-900">{agentPerformance.details.totals.records}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Pending</p>
                      <p className="text-lg font-semibold text-amber-700">{agentPerformance.details.totals.pending}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Paid</p>
                      <p className="text-lg font-semibold text-emerald-700">{agentPerformance.details.totals.paid}</p>
                    </div>
                    <div className="rounded-lg border border-gray-100 p-3">
                      <p className="text-xs text-gray-500">Currency</p>
                      <p className="text-lg font-semibold text-gray-900">{agentPerformance.baseCurrency}</p>
                    </div>
                  </div>

                  {agentPerformance.details.selectedBatchSummary && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                        <p className="text-xs text-indigo-700">Selected Batch</p>
                        <p className="text-sm font-semibold text-indigo-900 mt-1 break-all">{agentPerformance.details.selectedBatchSummary.batchId}</p>
                      </div>
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                        <p className="text-xs text-emerald-700">Batch Paid Records</p>
                        <p className="text-lg font-semibold text-emerald-900">{agentPerformance.details.selectedBatchSummary.paidRecords}</p>
                      </div>
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                        <p className="text-xs text-emerald-700">Batch Paid Amount</p>
                        <p className="text-lg font-semibold text-emerald-900">{fmt(agentPerformance.details.selectedBatchSummary.paidAmountGenerated)}</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-3">
                        <p className="text-xs text-gray-500">Cycle</p>
                        <p className="text-sm font-semibold text-gray-900 mt-1">
                          {agentPerformance.details.selectedBatchSummary.cycleStartAt
                            ? new Date(agentPerformance.details.selectedBatchSummary.cycleStartAt).toLocaleDateString()
                            : '-'}
                          {' '}to{' '}
                          {agentPerformance.details.selectedBatchSummary.cycleEndAt
                            ? new Date(agentPerformance.details.selectedBatchSummary.cycleEndAt).toLocaleDateString()
                            : '-'}
                        </p>
                      </div>
                    </div>
                  )}

                  {agentPerformance.details.batchSummaries.length > 0 && (
                    <div className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-900">Batch History</h4>
                        <p className="text-xs text-gray-500">Top 5 recent batches</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 text-gray-500">
                              <th className="py-2 text-left">Batch ID</th>
                              <th className="py-2 text-right">Paid Records</th>
                              <th className="py-2 text-right">Paid Amount</th>
                              <th className="py-2 text-left">Cycle</th>
                              <th className="py-2 text-left">Last Paid</th>
                              <th className="py-2 text-left">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {agentPerformance.details.batchSummaries.slice(0, 5).map((batch) => (
                              <tr key={batch.batchId} className="border-b border-gray-50">
                                <td className="py-2 font-mono text-xs text-gray-700">{batch.batchId}</td>
                                <td className="py-2 text-right text-gray-800">{batch.paidRecords}</td>
                                <td className="py-2 text-right font-semibold text-emerald-600">{fmt(batch.paidAmountGenerated)}</td>
                                <td className="py-2 text-xs text-gray-700">
                                  {batch.cycleStartAt ? new Date(batch.cycleStartAt).toLocaleDateString() : '-'} to {batch.cycleEndAt ? new Date(batch.cycleEndAt).toLocaleDateString() : '-'}
                                </td>
                                <td className="py-2 text-xs text-gray-600">{batch.lastPaidAt ? new Date(batch.lastPaidAt).toLocaleDateString() : '-'}</td>
                                <td className="py-2">
                                  <div className="flex gap-2">
                                    <button
                                      className="px-2 py-1 rounded border border-gray-200 text-xs font-medium hover:bg-gray-50"
                                      onClick={() => {
                                        setDetailBatchId(batch.batchId)
                                        setDetailPaymentFilter('PAID')
                                        setWithoutBatchOnly(false)
                                      }}
                                    >
                                      View
                                    </button>
                                    <button
                                      className="px-2 py-1 rounded border border-gray-200 text-xs font-medium hover:bg-gray-50"
                                      onClick={() => downloadBatchReceipt(batch.batchId)}
                                    >
                                      Download
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex items-center gap-2">
                      <button
                        className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50"
                        onClick={() => {
                          setDetailPaymentFilter('PENDING')
                          setDetailBatchId('')
                          setWithoutBatchOnly(true)
                        }}
                      >
                        Unbatched Pending
                      </button>
                      <button
                        className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50"
                        onClick={() => {
                          const latestBatch = agentPerformance.details.availableBatchIds[0] || ''
                          setDetailPaymentFilter('PAID')
                          setDetailBatchId(latestBatch)
                          setWithoutBatchOnly(false)
                        }}
                      >
                        Current Batch
                      </button>
                      <button
                        className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50"
                        onClick={() => {
                          setDetailPaymentFilter('ALL')
                          setDetailBatchId('')
                          setWithoutBatchOnly(false)
                        }}
                      >
                        Reset
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Status</label>
                      <select className="input" value={detailPaymentFilter} onChange={(e) => setDetailPaymentFilter(e.target.value as PaymentStatusFilter)}>
                        <option value="ALL">All</option>
                        <option value="PENDING">Pending</option>
                        <option value="PAID">Paid</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Batch ID</label>
                      <select className="input" value={detailBatchId} onChange={(e) => setDetailBatchId(e.target.value)}>
                        <option value="">All batches</option>
                        {(agentPerformance.details.availableBatchIds || []).map((batchId) => (
                          <option key={batchId} value={batchId}>{batchId}</option>
                        ))}
                      </select>
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={withoutBatchOnly}
                        onChange={(e) => setWithoutBatchOnly(e.target.checked)}
                      />
                      Without batch only
                    </label>
                    <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50" onClick={fetchAgentPerformance}>
                      Apply Filters
                    </button>
                    <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50" onClick={() => exportAgentPerformanceCsv(true)}>
                      Export PAID Receipt CSV
                    </button>
                    <button
                      className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50"
                      onClick={() => downloadBatchReceipt(detailBatchId || agentPerformance.details.availableBatchIds[0] || '')}
                    >
                      Download Batch Receipt
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-3 items-end">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Batch ID (optional)</label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g. APR-2026-CYCLE-1"
                        value={manualBatchId}
                        onChange={(e) => setManualBatchId(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Upload Remittance Report (CSV)</label>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        className="input"
                        onChange={(e) => setRemittanceFile(e.target.files?.[0] || null)}
                      />
                      <p className="text-xs text-gray-500 mt-1">Use CSV with a column named transactionId (or id).</p>
                    </div>
                    <button className="btn-primary" disabled={!remittanceFile || uploadingRemittance} onClick={uploadRemittanceReport}>
                      {uploadingRemittance ? 'Uploading...' : 'Upload And Mark Paid'}
                    </button>
                    <button className="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-50" disabled={updatingRemittance} onClick={markVisiblePendingAsPaid}>
                      {updatingRemittance ? 'Updating...' : 'Mark Visible Pending As Paid'}
                    </button>
                  </div>

                  {agentPerformance.details.records.length === 0 ? (
                    <p className="text-sm text-gray-500">No detailed records found for the selected period.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[1200px] text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-gray-500">
                            <th className="py-2 text-left">Date</th>
                            <th className="py-2 text-left">Transaction ID</th>
                            <th className="py-2 text-left">Agent</th>
                            <th className="py-2 text-left">Tenant</th>
                            <th className="py-2 text-left">Type</th>
                            <th className="py-2 text-right">Amount</th>
                            <th className="py-2 text-left">Payment Status</th>
                            <th className="py-2 text-left">Batch ID</th>
                            <th className="py-2 text-left">Source</th>
                            <th className="py-2 text-left">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {agentPerformance.details.records.map((row) => (
                            <tr key={row.transactionId} className="border-b border-gray-50">
                              <td className="py-3 text-xs text-gray-600">{new Date(row.initiatedAt).toLocaleDateString()}</td>
                              <td className="py-3 font-mono text-xs text-gray-600">{row.transactionId}</td>
                              <td className="py-3">
                                <p className="font-medium text-gray-900">{row.agentName}</p>
                                <p className="text-xs text-gray-500">{row.agentEmail}</p>
                              </td>
                              <td className="py-3 text-gray-800">{row.tenantName}</td>
                              <td className="py-3 text-gray-700">{row.changeType}</td>
                              <td className="py-3 text-right font-semibold text-gray-900">{fmt(row.amountGenerated)}</td>
                              <td className="py-3">
                                {row.paymentStatus === 'PAID' ? (
                                  <span className="text-xs font-medium px-2 py-1 rounded bg-emerald-50 text-emerald-700">PAID</span>
                                ) : (
                                  <span className="text-xs font-medium px-2 py-1 rounded bg-amber-50 text-amber-700">PENDING</span>
                                )}
                              </td>
                              <td className="py-3 text-xs font-mono text-gray-600">{row.batchId || '-'}</td>
                              <td className="py-3 text-xs text-gray-600">{row.source || '-'}</td>
                              <td className="py-3">
                                {row.paymentStatus === 'PAID' ? (
                                  <span className="text-xs text-gray-500">Paid {row.paidAt ? new Date(row.paidAt).toLocaleDateString() : ''}</span>
                                ) : (
                                  <button
                                    className="px-2 py-1 rounded border border-gray-200 text-xs font-medium hover:bg-gray-50"
                                    disabled={updatingRemittance}
                                    onClick={() => markTransactionAsPaid(row.transactionId)}
                                  >
                                    Mark Paid
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
