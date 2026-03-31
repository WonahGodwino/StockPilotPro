import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Legend } from 'recharts'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { TrendingUp, TrendingDown, DollarSign, Package, Download } from 'lucide-react'
import toast from 'react-hot-toast'

type Period = 'daily' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
const EXPENSE_COLORS = ['#6366f1','#f59e0b','#10b981','#ef4444','#3b82f6','#8b5cf6','#ec4899','#14b8a6']

interface ReportsResponse {
  data: {
    summary: {
      totalSales: number
      totalExpenses: number
      cogs: number
      grossProfit: number
      netProfit: number
      totalProductWorth: number
      salesCount: number
    }
    topProducts: Array<{ name: string; totalRevenue: number }>
    expenseByCategory: Array<{ category: string; total: number }>
  }
}

const fmt = (n: number) => n.toLocaleString('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })

export default function Reports() {
  const user = useAuthStore((s) => s.user)
  const [period, setPeriod] = useState<Period>('monthly')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [report, setReport] = useState<ReportsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(false)

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
    } catch { toast.error('Failed to load report') } finally { setLoading(false) }
  }, [period, customFrom, customTo])

  useEffect(() => { if (period !== 'custom') fetchReport() }, [period, fetchReport])

  if (!user || user.role === 'SALESPERSON') return <Navigate to="/dashboard" replace />

  const expenseByCat = report?.expenseByCategory
    ? report.expenseByCategory.map((e) => ({ name: e.category, value: e.total }))
    : []
  const summary = report?.summary

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Reports</h1><p className="text-sm text-gray-500 mt-0.5">Profit & Loss Overview</p></div>
        <div className="flex gap-2 flex-wrap justify-end">
          {(['daily','monthly','quarterly','yearly','custom'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${period === p ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{p}</button>
          ))}
        </div>
      </div>

      {period === 'custom' && (
        <div className="flex gap-3 items-end">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">From</label><input type="date" className="input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">To</label><input type="date" className="input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></div>
          <button onClick={fetchReport} disabled={!customFrom || !customTo || loading} className="btn-primary">Generate</button>
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

          {/* COGS & Inventory */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card"><p className="text-sm text-gray-500">Cost of Goods Sold</p><p className="text-xl font-bold text-gray-800 mt-1">{fmt(summary.cogs)}</p></div>
            <div className="card"><p className="text-sm text-gray-500">Total Product Worth</p><p className="text-xl font-bold text-gray-800 mt-1">{fmt(summary.totalProductWorth)}</p></div>
            <div className="card flex items-center gap-3">
              <Package className="w-8 h-8 text-indigo-400" />
              <div><p className="text-sm text-gray-500">Profit Margin</p><p className="text-xl font-bold text-indigo-600 mt-1">{summary.totalSales > 0 ? ((summary.netProfit / summary.totalSales) * 100).toFixed(1) : 0}%</p></div>
            </div>
          </div>

          {/* Charts */}
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
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v/1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="revenue" fill="#6366f1" radius={[0, 4, 4, 0]} />
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
        </>
      )}
    </div>
  )
}
