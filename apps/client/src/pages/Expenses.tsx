import { useEffect, useState } from 'react'
import { Plus, Search, Edit2, Trash2, Receipt } from 'lucide-react'
import api from '@/lib/api'
import type { Expense } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import ExpenseModal from '@/components/expenses/ExpenseModal'
import Pagination from '@/components/Pagination'

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Marketing', 'Transportation', 'Maintenance', 'Supplies', 'Other']

export default function Expenses() {
  const user = useAuthStore((s) => s.user)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)

  const canDelete = user?.role === 'BUSINESS_ADMIN' || user?.role === 'SUPER_ADMIN'

  const LIMIT = 20
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', String(LIMIT))
      const { data } = await api.get(`/expenses?${params}`)
      setExpenses(data.data)
      setTotal(data.total)
    } catch { toast.error('Failed to load expenses') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [page, search, category])

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this expense?')) return
    try {
      await api.delete(`/expenses/${id}`)
      toast.success('Expense archived')
      load()
    } catch { toast.error('Failed to archive') }
  }

  const total_amount = expenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} records · Total:{' '}
            <span className="font-semibold text-danger-600">${total_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9" placeholder="Search expenses..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        </div>
        <select className="input w-44" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }}>
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

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
                    <td className="px-4 py-3 font-medium text-gray-900">{e.title}</td>
                    <td className="px-4 py-3">
                      <span className="badge bg-gray-100 text-gray-600">{e.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-danger-600">
                      ${Number(e.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {e.user ? `${e.user.firstName} ${e.user.lastName}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => { setEditing(e); setModalOpen(true) }} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary-600">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {canDelete && (
                          <button onClick={() => handleDelete(e.id)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-danger-600">
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

      {modalOpen && (
        <ExpenseModal expense={editing} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load() }} />
      )}
    </div>
  )
}
