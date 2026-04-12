import { useEffect, useRef, useState } from 'react'
import api from '@/lib/api'
import type { Expense } from '@/types'
import toast from 'react-hot-toast'
import { X, Loader2, RefreshCw } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { getApiErrorMessage } from '@/lib/apiError'
import { addPendingExpense, updatePendingExpense } from '@/lib/db'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'

const CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Marketing', 'Transportation', 'Maintenance', 'Supplies', 'Other']

interface Props { expense: Expense | null; pendingLocalId?: string | null; onClose: () => void; onSaved: () => void }

export default function ExpenseModal({ expense, pendingLocalId = null, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user)
  const selectedSubsidiaryId = useAppStore((s) => s.selectedSubsidiaryId)
  const subsidiaries = useAppStore((s) => s.subsidiaries)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const isSalesperson = user?.role === 'SALESPERSON'
  const initialEditCurrencyRef = useRef(expense?.currency || baseCurrency)
  const [loading, setLoading] = useState(false)
  const [rateLoading, setRateLoading] = useState(false)
  const [rateSource, setRateSource] = useState<'live' | 'snapshot' | 'manual' | 'same-currency' | null>(null)
  const [fxRateEditedManually, setFxRateEditedManually] = useState(false)
  const [currencySearch, setCurrencySearch] = useState('')
  const [form, setForm] = useState({
    title: expense?.title || '',
    amount: Number(expense?.amount ?? 0),
    category: expense?.category || 'Other',
    date: expense?.date ? expense.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    currency: expense?.currency || baseCurrency,
    fxRate: Number(expense?.fxRate ?? 1),
    notes: expense?.notes || '',
    subsidiaryId: expense?.subsidiaryId ?? selectedSubsidiaryId ?? user?.subsidiaryId ?? '',
  })

  useEffect(() => {
    if (isSalesperson && user?.subsidiaryId && form.subsidiaryId !== user.subsidiaryId) {
      setForm((current) => ({ ...current, subsidiaryId: user.subsidiaryId || '' }))
    }
  }, [isSalesperson, user?.subsidiaryId, form.subsidiaryId])

  const showFxRate = form.currency !== baseCurrency
  const filteredCurrencies = SUPPORTED_CURRENCIES.filter((currency) => {
    const q = currencySearch.trim().toLowerCase()
    if (!q) return true
    return currency.code.toLowerCase().includes(q) || currency.name.toLowerCase().includes(q)
  })

  const loadLiveRate = async (currency: string) => {
    if (currency === baseCurrency) {
      setForm((current) => ({ ...current, fxRate: 1 }))
      setRateSource('same-currency')
      return
    }

    if (!navigator.onLine) {
      setRateSource('manual')
      return
    }

    setRateLoading(true)
    try {
      const { data } = await api.get(`/currency-rates?fromCurrency=${baseCurrency}&toCurrency=${currency}&live=true`)
      const rate = Number(data.data.rate)
      setForm((current) => ({ ...current, fxRate: rate }))
      setFxRateEditedManually(false)
      setRateSource(data.data.source === 'snapshot' ? 'snapshot' : 'live')
    } catch {
      setRateSource('manual')
      toast.error('Unable to load live FX rate. You can still enter it manually.')
    } finally {
      setRateLoading(false)
    }
  }

  useEffect(() => {
    if (!showFxRate) {
      setRateSource('same-currency')
      return
    }

    const isInitialEditCurrency = !!expense && form.currency === initialEditCurrencyRef.current
    if (isInitialEditCurrency) {
      // Existing legacy records might carry placeholder rate=1 for non-base currency.
      // Attempt auto-refresh once so editing can self-heal stale FX metadata.
      if (Number(form.fxRate) === 1) {
        void loadLiveRate(form.currency)
      } else {
        setRateSource('manual')
      }
      return
    }

    void loadLiveRate(form.currency)
  }, [baseCurrency, expense, form.currency, showFxRate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const resolvedSubsidiaryId = isSalesperson ? (user?.subsidiaryId || '') : form.subsidiaryId
    if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0) {
      toast.error('Expense amount must be greater than 0')
      return
    }
    if (showFxRate) {
      const normalizedFxRate = Number(form.fxRate)
      if (!Number.isFinite(normalizedFxRate) || normalizedFxRate <= 0) {
        toast.error('FX rate must be greater than 0 for non-base currency expenses')
        return
      }
      if (normalizedFxRate === 1 && rateSource === 'manual' && !fxRateEditedManually) {
        toast.error('No exchange rate loaded yet. Refresh live rate or enter FX rate manually before saving.')
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
      const normalizedFxRate = Number(form.fxRate)
      const payload = {
        ...form,
        amount: normalizedAmount,
        date: new Date(form.date).toISOString(),
        fxRate: normalizedFxRate,
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
                onChange={(e) => setForm({ ...form, currency: e.target.value, fxRate: e.target.value === baseCurrency ? 1 : form.fxRate })}
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
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    FX Rate <span className="text-gray-400 text-xs">({form.currency}/{baseCurrency})</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void loadLiveRate(form.currency)}
                    disabled={rateLoading}
                    className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${rateLoading ? 'animate-spin' : ''}`} />
                    Refresh live rate
                  </button>
                </div>
                <input
                  className="input"
                  type="number"
                  step="0.000001"
                  min="0.000001"
                  value={form.fxRate}
                  onChange={(e) => {
                    setFxRateEditedManually(true)
                    setForm({ ...form, fxRate: parseFloat(e.target.value) || 1 })
                  }}
                  required={showFxRate}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {rateSource === 'live' && 'Using live market rate.'}
                  {rateSource === 'snapshot' && 'Live rate unavailable. Using latest saved snapshot.'}
                  {rateSource === 'manual' && 'Enter the rate manually if needed.'}
                  {rateSource === 'same-currency' && 'No conversion needed.'}
                </p>
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
