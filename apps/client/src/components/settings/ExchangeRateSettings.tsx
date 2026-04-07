import { useEffect, useMemo, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { ArrowRightLeft, Loader2, RefreshCw, Save } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'
import type { CurrencyRate } from '@/types'
import { getCachedCurrencyRatesForTenant, replaceCachedCurrencyRatesForTenant } from '@/lib/db'

export default function ExchangeRateSettings() {
  const user = useAuthStore((s) => s.user)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const [rates, setRates] = useState<CurrencyRate[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchingLive, setFetchingLive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedCurrency, setSelectedCurrency] = useState('EUR')
  const [rateValue, setRateValue] = useState('1')
  const [rateSource, setRateSource] = useState<'live' | 'snapshot' | 'manual' | null>(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  const quoteCurrencies = useMemo(
    () => SUPPORTED_CURRENCIES.filter((currency) => currency.code !== baseCurrency),
    [baseCurrency]
  )

  const loadRates = useCallback(async () => {
    setLoading(true)
    try {
      if (!navigator.onLine && user?.tenantId) {
        const cached = await getCachedCurrencyRatesForTenant(user.tenantId)
        const ordered = [...cached].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        setRates(ordered)
        return
      }

      const { data } = await api.get('/currency-rates')
      setRates(data.data)
      if (user?.tenantId) {
        await replaceCachedCurrencyRatesForTenant(user.tenantId, data.data)
      }
    } catch {
      toast.error('Failed to load saved exchange rates')
    } finally {
      setLoading(false)
    }
  }, [user?.tenantId])

  useEffect(() => {
    void loadRates()
  }, [loadRates])

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      void loadRates()
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [loadRates])

  useEffect(() => {
    if (selectedCurrency === baseCurrency && quoteCurrencies.length > 0) {
      setSelectedCurrency(quoteCurrencies[0].code)
    }
  }, [baseCurrency, quoteCurrencies, selectedCurrency])

  const fetchLiveRate = async () => {
    if (!navigator.onLine) {
      toast.error('Reconnect to fetch live exchange rate')
      return
    }

    setFetchingLive(true)
    try {
      const { data } = await api.get(`/currency-rates?fromCurrency=${baseCurrency}&toCurrency=${selectedCurrency}&live=true`)
      setRateValue(String(Number(data.data.rate)))
      setRateSource(data.data.source === 'snapshot' ? 'snapshot' : 'live')
      toast.success(`Loaded ${selectedCurrency}/${baseCurrency} live rate`)
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Unable to fetch live exchange rate'
      toast.error(message)
    } finally {
      setFetchingLive(false)
    }
  }

  const handleSave = async () => {
    const numericRate = Number(rateValue)
    if (!numericRate || numericRate <= 0) {
      toast.error('Enter a valid exchange rate')
      return
    }

    setSaving(true)
    try {
      await api.post('/currency-rates', {
        fromCurrency: baseCurrency,
        toCurrency: selectedCurrency,
        rate: numericRate,
        date: new Date().toISOString(),
      })
      setRateSource('manual')
      toast.success('Exchange rate saved')
      await loadRates()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save exchange rate'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const latestRates = useMemo(() => {
    const seen = new Set<string>()
    return rates.filter((rate) => {
      const key = `${rate.fromCurrency}-${rate.toCurrency}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [rates])

  if (!user || user.role === 'SALESPERSON') return null

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-50 rounded-lg">
          <ArrowRightLeft className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Exchange Rates</h3>
          <p className="text-xs text-gray-500">
            Save the exchange rates your company will use for sales and service charges. POS uses these saved rates, not live market quotes.
          </p>
        </div>
      </div>

      {!isOnline && (
        <p className="text-xs text-amber-600">Offline mode: showing cached exchange rates. Reconnect to fetch live or save changes.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto_auto] gap-3 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Base Currency</label>
          <div className="input bg-gray-50 text-gray-600">{baseCurrency}</div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Transaction Currency</label>
          <select className="input" value={selectedCurrency} onChange={(e) => setSelectedCurrency(e.target.value)}>
            {quoteCurrencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Rate <span className="text-gray-400 text-xs">({selectedCurrency}/{baseCurrency})</span>
          </label>
          <input
            className="input"
            type="number"
            min="0.000001"
            step="0.000001"
            value={rateValue}
            onChange={(e) => setRateValue(e.target.value)}
          />
        </div>
        <button type="button" className="btn-secondary" onClick={fetchLiveRate} disabled={fetchingLive}>
          {fetchingLive ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Fetch Live
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={saving || !isOnline}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Rate
        </button>
      </div>

      <p className="text-xs text-gray-500">
        {rateSource === 'live' && 'The current value came from the live provider. You can edit it before saving.'}
        {rateSource === 'snapshot' && 'Live provider was unavailable, so the last saved snapshot was loaded.'}
        {rateSource === 'manual' && 'You can type and save your own internal rate.'}
        {!rateSource && 'Tip: fetch a live rate, adjust it if needed, then save it for POS use.'}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Pair</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Saved Rate</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Updated</th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400">Loading exchange rates...</td>
              </tr>
            ) : latestRates.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400">No saved exchange rates yet</td>
              </tr>
            ) : (
              latestRates.map((rate) => (
                <tr key={rate.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{rate.toCurrency}/{rate.fromCurrency}</td>
                  <td className="px-4 py-3 text-gray-700">{Number(rate.rate).toFixed(6)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{new Date(rate.date).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-sm font-medium text-primary-600 hover:underline"
                      onClick={() => {
                        setSelectedCurrency(rate.toCurrency)
                        setRateValue(String(Number(rate.rate)))
                        setRateSource('manual')
                      }}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
