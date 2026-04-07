import { useEffect, useState } from 'react'
import { Plus, Search, Edit2, Trash2, Receipt, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import type { Expense } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import ExpenseModal from '@/components/expenses/ExpenseModal'
import Pagination from '@/components/Pagination'
import { makeCurrencyFormatter, getCurrencySymbol } from '@/lib/currency'
import { getCachedExpensesForTenant, getPendingExpenseRecords, replaceCachedExpensesForTenant, subscribePendingRecordsChanged } from '@/lib/db'

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Marketing', 'Transportation', 'Maintenance', 'Supplies', 'Other']

function toLocalOfflineExpense(
  record: Awaited<ReturnType<typeof getPendingExpenseRecords>>[number],
  user: ReturnType<typeof useAuthStore.getState>['user']
): Expense {
  return {
    id: `offline-${record.localId}`,
    tenantId: user?.tenantId || '',
    subsidiaryId: record.data.subsidiaryId ?? null,
    userId: user?.id || 'offline-user',
    title: record.data.title,
    amount: Number(record.data.amount),
    category: record.data.category,
    date: record.data.date,
    currency: record.data.currency,
    fxRate: Number(record.data.fxRate) || 1,
    notes: record.data.notes,
    createdAt: record.createdAt,
    user: user ? { firstName: user.firstName, lastName: user.lastName } : { firstName: 'Offline', lastName: 'User' },
  }
}

function toBaseExpenseAmount(amountRaw: unknown, fxRateRaw: unknown, currency: string | undefined, baseCurrency: string): number {
  const amount = Number(amountRaw)
  if (!Number.isFinite(amount)) return 0
  if (!currency || currency === baseCurrency) return amount

  const rate = Number(fxRateRaw)
  if (!Number.isFinite(rate) || rate <= 0) return amount
  return amount / rate
}

export default function Expenses() {
  const user = useAuthStore((s) => s.user)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const canDelete = user?.role === 'BUSINESS_ADMIN' || user?.role === 'SUPER_ADMIN'

  const LIMIT = 20
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const applyRoleFilter = (records: Expense[]) => {
    if (!user) return []
    if (user.role === 'SALESPERSON') {
      if (!user.subsidiaryId) return []
      return records.filter((item) => item.subsidiaryId === user.subsidiaryId)
    }
    return records
  }

  const applyFilters = (records: Expense[]) => {
    const normalizedSearch = search.trim().toLowerCase()
    return records.filter((item) => {
      const matchesCategory = !category || item.category === category
      const matchesSearch = !normalizedSearch || item.title.toLowerCase().includes(normalizedSearch)
      const itemDate = new Date(item.date).getTime()
      const matchesFrom = !dateFrom || itemDate >= new Date(dateFrom).getTime()
      const matchesTo = !dateTo || itemDate <= new Date(`${dateTo}T23:59:59`).getTime()
      return matchesCategory && matchesSearch && matchesFrom && matchesTo
    })
  }

  const refreshOfflineExpenseCache = async () => {
    if (!navigator.onLine || !user?.tenantId) return

    const allAccessible: Expense[] = []
    let cursor = 1
    const pageSize = 200
    while (cursor <= 50) {
      const { data } = await api.get(`/expenses?page=${cursor}&limit=${pageSize}`)
      const rows = data.data as Expense[]
      allAccessible.push(...rows)
      if (rows.length < pageSize || allAccessible.length >= Number(data.total || 0)) break
      cursor += 1
    }

    await replaceCachedExpensesForTenant(user.tenantId, allAccessible)
  }

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      if (search) params.set('search', search)
      if (dateFrom) params.set('from', new Date(dateFrom).toISOString())
      if (dateTo) params.set('to', new Date(dateTo + 'T23:59:59').toISOString())
      params.set('page', String(page))
      params.set('limit', String(LIMIT))
      const pendingOffline = await getPendingExpenseRecords()
      const pendingAsExpenses = pendingOffline.map((record) => toLocalOfflineExpense(record, user))

      if (!navigator.onLine) {
        const cached = user?.tenantId ? await getCachedExpensesForTenant(user.tenantId) : []
        const cachedScoped = applyRoleFilter(cached)

        const existingSyncRefs = new Set<string>()
        for (const cachedExpense of cachedScoped) {
          const ref = (cachedExpense as Expense & { syncRef?: string; transactionRef?: string }).syncRef
            || (cachedExpense as Expense & { syncRef?: string; transactionRef?: string }).transactionRef
          if (ref) existingSyncRefs.add(ref)
        }

        const unresolvedPending = pendingOffline
          .filter((record) => {
            const dedupeRef = record.data.transactionRef || record.data.syncRef || record.localId
            return !existingSyncRefs.has(dedupeRef)
          })
          .map((record) => toLocalOfflineExpense(record, user))

        const mergedOffline = [...unresolvedPending, ...cachedScoped]
        const filteredOffline = applyFilters(mergedOffline)

        const start = (page - 1) * LIMIT
        const end = start + LIMIT
        setExpenses(filteredOffline.slice(start, end))
        setTotal(filteredOffline.length)
        return
      }

      const { data } = await api.get(`/expenses?${params}`)
      const existingSyncRefs = new Set<string>()
      for (const remoteExpense of data.data as Expense[]) {
        const ref = (remoteExpense as Expense & { syncRef?: string; transactionRef?: string }).syncRef
          || (remoteExpense as Expense & { syncRef?: string; transactionRef?: string }).transactionRef
        if (ref) existingSyncRefs.add(ref)
      }

      const unresolvedPending = pendingOffline
        .filter((record) => {
          const dedupeRef = record.data.transactionRef || record.data.syncRef || record.localId
          return !existingSyncRefs.has(dedupeRef)
        })
        .map((record) => toLocalOfflineExpense(record, user))

      const merged = page === 1
        ? [...unresolvedPending, ...(data.data as Expense[])]
        : (data.data as Expense[])
      setExpenses(applyRoleFilter(merged))
      setTotal(Number(data.total || 0) + unresolvedPending.length)

      void refreshOfflineExpenseCache()
    } catch { toast.error('Failed to load expenses') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [page, search, category, dateFrom, dateTo])

  useEffect(() => {
    const refresh = () => { void load() }
    const unsubscribePending = subscribePendingRecordsChanged(refresh as EventListener)
    window.addEventListener('stockpilot:sync-status', refresh as EventListener)
    window.addEventListener('online', refresh)
    return () => {
      unsubscribePending()
      window.removeEventListener('stockpilot:sync-status', refresh as EventListener)
      window.removeEventListener('online', refresh)
    }
  }, [page, search, category, dateFrom, dateTo, user])

  const confirmDelete = async () => {
    if (!confirmId) return
    try {
      await api.delete(`/expenses/${confirmId}`)
      toast.success('Expense archived')
      setConfirmId(null)
      load()
    } catch { toast.error('Failed to archive') }
  }

  const totalAmount = expenses.reduce(
    (sum, expense) => sum + toBaseExpenseAmount(expense.amount, expense.fxRate, expense.currency, baseCurrency),
    0
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      {/* Summary card */}
      <div className="card p-4 flex items-center gap-4">
        <div className="p-2.5 bg-danger-50 rounded-lg shrink-0">
          <Receipt className="w-5 h-5 text-danger-600" />
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total Expenses</p>
          <p className="text-2xl font-bold text-danger-600">
            {fmt(totalAmount)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{total} {total === 1 ? 'record' : 'records'}</p>
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategory('')}
          className={`badge px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
            category === '' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c === category ? '' : c)}
            className={`badge px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              category === c ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Search + date range filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Search expenses..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-36"
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            title="From date"
          />
          <span className="text-gray-400 text-sm">–</span>
          <input
            className="input w-36"
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            title="To date"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">By</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">Loading...</td></tr>
              ) : expenses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    <Receipt className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">No expenses found</p>
                  </td>
                </tr>
              ) : (
                expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        <span>{e.title}</span>
                        {e.id.startsWith('offline-') && (
                          <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            Pending Offline
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge bg-gray-100 text-gray-600">{e.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-danger-600">
                      {e.currency && e.currency !== baseCurrency
                        ? `${getCurrencySymbol(e.currency)}${Number(e.amount).toFixed(2)} (${fmt(toBaseExpenseAmount(e.amount, e.fxRate, e.currency, baseCurrency))})`
                        : fmt(Number(e.amount))
                      }
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {e.user ? `${e.user.firstName} ${e.user.lastName}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => { setEditing(e); setModalOpen(true) }}
                          title={e.id.startsWith('offline-') ? 'Edit pending offline record' : 'Edit expense'}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary-600"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setConfirmId(e.id)}
                            disabled={e.id.startsWith('offline-')}
                            title={e.id.startsWith('offline-') ? 'Archive will be available after sync completes' : 'Archive expense'}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-danger-600 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      </div>

      {/* Expense create/edit modal */}
      {modalOpen && (
        <ExpenseModal
          expense={editing}
          pendingLocalId={editing?.id.startsWith('offline-') ? editing.id.replace('offline-', '') : null}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load() }}
        />
      )}

      {/* Confirmation dialog */}
      {confirmId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-danger-50 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-danger-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900">Archive Expense?</h3>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              This expense will be archived and removed from the active list.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmId(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmDelete} className="btn-danger flex-1">Archive</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
