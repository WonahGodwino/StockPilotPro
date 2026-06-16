import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { Expense } from '@/types'
import toast from 'react-hot-toast'
import { X, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { getApiErrorMessage } from '@/lib/apiError'
import { addPendingExpense, updatePendingExpense } from '@/lib/db'
import { SUPPORTED_CURRENCIES, makeCurrencyFormatter } from '@/lib/currency'

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Marketing', 'Transportation', 'Maintenance', 'Supplies', 'Other']

interface Props { expense: Expense | null; pendingLocalId?: string | null; onClose: () => void; onSaved: () => void }

export default function ExpenseModal({ expense, pendingLocalId = null, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user)
  const selectedSubsidiaryId = useAppStore((s) => s.selectedSubsidiaryId)
  const subsidiaries = useAppStore((s) => s.subsidiaries)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency)
  const isSalesperson = user?.role === 'SALESPERSON'
  const [loading, setLoading] = useState(false)
  const [rateLoading, setRateLoading] = useState(false)
  const [resolvedFxRate, setResolvedFxRate] = useState<number | null>(null)
  const [fxError, setFxError] = useState<string | null>(null)
  const [currencySearch, setCurrencySearch] = useState('')
  const [form, setForm] = useState({
    title: expense?.title || '',
    amount: Number(expense?.amount ?? 0),
    category: expense?.category || 'Other',
    date: expense?.date ? expense.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    currency: expense?.currency || baseCurrency,
    notes: expense?.notes || '',
    subsidiaryId: expense?.subsidiaryId ?? selectedSubsidiaryId ?? user?.subsidiaryId ?? '',
  })

  useEffect(() => {
    if (isSalesperson && user?.subsidiaryId && form.subsidiaryId !== user.subsidiaryId) {
      setForm((current) => ({ ...current, subsidiaryId: user.subsidiaryId || '' }))
    }
  }, [isSalesperson, user?.subsidiaryId, form.subsidiaryId])

  const showFxRate = form.currency !== baseCurrency
  const filteredCurrencies = SUPPORTED_CURRENCIES.filter((c) => {
    const q = currencySearch.trim().toLowerCase()
    if (!q) return true
    return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  })

  // Load saved-only rate whenever currency changes — same pattern as ProductModal.
  const loadSavedRate = async (currency: string) => {
    if (currency === baseCurrency) {
      setResolvedFxRate(1)
      setFxError(null)
      return
    }
    setRateLoading(true)
    setFxError(null)
    try {
      const { data } = await api.get(`/currency-rates?fromCurrency=${baseCurrency}&toCurrency=${currency}`)
      const rate = Number(data?.data?.rate)
      if (!Number.isFinite(rate) || rate <= 0) {
        setResolvedFxRate(null)
        setFxError(`No saved rate for ${currency}/${baseCurrency}. Go to Settings → Exchange Rates.`)
      } else {
        setResolvedFxRate(rate)
        setFxError(null)
      }
    } catch {
      setResolvedFxRate(null)
      setFxError(`No saved rate for ${currency}/${baseCurrency}. Go to Settings → Exchange Rates.`)
    } finally {
      setRateLoading(false)
    }
  }

  useEffect(() => {
    if (!showFxRate) {
      setResolvedFxRate(1)
      setFxError(null)
      return
    }
    void loadSavedRate(form.currency)
  }, [form.currency, baseCurrency, showFxRate])

  // Base-currency equivalent shown as a hint below the amount field.
  const baseAmount = showFxRate && resolvedFxRate && resolvedFxRate > 0 ? form.amount / resolvedFxRate : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const resolvedSubsidiaryId = isSalesperson ? (user?.subsidiaryId || '') : form.subsidiaryId
    if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0) {
      toast.error('Expense amount must be greater than 0')
      return
    }
    if (showFxRate) {
      if (fxError) {
        toast.error('Cannot save: no saved FX rate for the selected currency. Go to Settings → Exchange Rates.')
        return
      }
      if (!resolvedFxRate || !Number.isFinite(resolvedFxRate) || resolvedFxRate <= 0) {
        toast.error('Cannot save: FX rate is missing. Save the rate in Exchange Rate Settings first.')
        return
      }
    }
    if (isSalesperson && !resolvedSubsidiaryId) {
      toast.error('Your account is not linked to a subsidiary. Contact an admin.')
      return
    }
    setLoading(true)
    try {
      const normalizedAmount = Number(form.amount)
      const payload = {
        ...form,
        amount: normalizedAmount,
        date: new Date(form.date).toISOString(),
        fxRate: showFxRate && resolvedFxRate ? resolvedFxRate : 1,
        subsidiaryId: resolvedSubsidiaryId || null,
      }
      if (expense) {
        if (pendingLocalId) {
          const updated = await updatePendingExpense(pendingLocalId, payload)
          if (!updated) {
            toast.error('Pending expense record no longer exists. Please create a new expense entry.')
            return
          }
          toast.success('Pending expense updated. It will sync when online.')
        } else {
          await api.put(`/expenses/${expense.id}`, payload)
          toast.success('Expense updated')
        }
      } else if (!navigator.onLine) {
        await addPendingExpense(payload)
        toast.success('Expense saved offline. Will sync when reconnected.')
      } else {
        await api.post('/expenses', payload)
        toast.success('Expense recorded')
      }
      onSaved()
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed'))
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{expense ? 'Edit Expense' : 'Add Expense'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount *</label>
              <input className="input" type="number" step="0.01" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} required />
              {showFxRate && !fxError && baseAmount != null && baseAmount > 0 && (
                <p className="mt-1 text-xs text-gray-500">≈ {fmt(baseAmount)}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <input
                className="input mb-2"
                placeholder="Search by code or name"
                value={currencySearch}
                onChange={(e) => setCurrencySearch(e.target.value)}
                onBlur={() => setCurrencySearch('')}
              />
              <select
                className="input"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {filteredCurrencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
                {filteredCurrencies.length === 0 && (
                  <option value="" disabled>No currency matches search</option>
                )}
              </select>
            </div>
            {showFxRate && (
              <div className="flex flex-col justify-end">
                {rateLoading && (
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading saved rate…
                  </p>
                )}
                {fxError && !rateLoading && (
                  <p className="text-xs text-danger-600">{fxError}</p>
                )}
                {resolvedFxRate && !fxError && !rateLoading && (
                  <p className="text-xs text-gray-500">
                    1 {form.currency} = {fmt(1 / resolvedFxRate)}
                  </p>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expense Scope</label>
            <select
              className="input"
              value={form.subsidiaryId}
              onChange={(e) => setForm({ ...form, subsidiaryId: e.target.value })}
              disabled={isSalesperson}
            >
              <option value="">Main Company</option>
              {subsidiaries.map((subsidiary) => (
                <option key={subsidiary.id} value={subsidiary.id}>{subsidiary.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {isSalesperson
                ? 'Sales staff expenses are recorded under your assigned subsidiary.'
                : 'Choose Main Company for head-office expenses or pick a subsidiary.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {expense ? 'Save Changes' : 'Record Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
