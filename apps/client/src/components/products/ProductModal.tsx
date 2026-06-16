import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { Product } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { getApiErrorMessage } from '@/lib/apiError'
import { makeCurrencyFormatter, SUPPORTED_CURRENCIES } from '@/lib/currency'
import { X, Loader2 } from 'lucide-react'

interface Props {
  product: Product | null
  onClose: () => void
  onSaved: () => void
}

function toDateInputValue(value?: string | Date): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export default function ProductModal({ product, onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency)
  const selectedSubsidiaryId = useAppStore((s) => s.selectedSubsidiaryId)
  const subsidiaries = useAppStore((s) => s.subsidiaries)
  const isSalesperson = user?.role === 'SALESPERSON'
  const [loading, setLoading] = useState(false)

  // Currency conversion state
  const [priceCurrency, setPriceCurrency] = useState(
    product?.originalCurrency || baseCurrency
  )
  const [resolvedFxRate, setResolvedFxRate] = useState(1)
  const [fxLoading, setFxLoading] = useState(false)
  const [fxError, setFxError] = useState<string | null>(null)
  // Raw amounts as entered by the user in priceCurrency
  const [rawCostPrice, setRawCostPrice] = useState(
    product?.originalCostPrice != null ? Number(product.originalCostPrice) : Number(product?.costPrice ?? 0)
  )
  const [rawSellingPrice, setRawSellingPrice] = useState(
    product?.originalSellingPrice != null ? Number(product.originalSellingPrice) : Number(product?.sellingPrice ?? 0)
  )

  const isConverting = priceCurrency !== baseCurrency

  // Fetch saved FX rate whenever priceCurrency changes
  useEffect(() => {
    if (!isConverting) {
      setResolvedFxRate(1)
      setFxError(null)
      return
    }
    let cancelled = false
    setFxLoading(true)
    setFxError(null)
    api
      .get(`/currency-rates?fromCurrency=${baseCurrency}&toCurrency=${priceCurrency}`)
      .then(({ data }) => {
        if (cancelled) return
        const rate = Number(data?.data?.rate)
        if (!rate || !Number.isFinite(rate) || rate <= 0) {
          setFxError(`No saved rate for ${priceCurrency}/${baseCurrency}. Go to Settings → Exchange Rates.`)
          setResolvedFxRate(1)
        } else {
          // rate is baseCurrency→priceCurrency, so 1 priceCurrency = 1/rate baseCurrency
          setResolvedFxRate(rate)
          setFxError(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFxError(`Could not load rate for ${priceCurrency}/${baseCurrency}.`)
          setResolvedFxRate(1)
        }
      })
      .finally(() => { if (!cancelled) setFxLoading(false) })
    return () => { cancelled = true }
  }, [priceCurrency, baseCurrency, isConverting])

  // When switching currency back to base, reset raw values to current form values
  const handleCurrencyChange = (newCurrency: string) => {
    setPriceCurrency(newCurrency)
    if (newCurrency === baseCurrency) {
      // show stored base-currency values unchanged
      setRawCostPrice(form.costPrice)
      setRawSellingPrice(form.sellingPrice)
    }
  }

  // Derived base-currency prices (what gets saved)
  const baseCostPrice = isConverting ? rawCostPrice / resolvedFxRate : rawCostPrice
  const baseSellingPrice = isConverting ? rawSellingPrice / resolvedFxRate : rawSellingPrice

  const [form, setForm] = useState({
    name: product?.name || '',
    category: product?.category || 'Uncategorized',
    description: product?.description || '',
    type: product?.type || 'GOODS',
    unit: product?.unit || 'pcs',
    quantity: product?.quantity ?? 0,
    costPrice: product?.costPrice ?? 0,
    sellingPrice: product?.sellingPrice ?? 0,
    barcode: product?.barcode || '',
    lowStockThreshold: product?.lowStockThreshold ?? 10,
    purchaseDate: toDateInputValue(product?.purchaseDate as string | Date | undefined) || toDateInputValue(new Date()),
    expiryDate: toDateInputValue(product?.expiryDate as string | Date | undefined),
    status: product?.status || 'ACTIVE',
    subsidiaryId: product?.subsidiaryId || selectedSubsidiaryId || user?.subsidiaryId || '',
  })

  useEffect(() => {
    if (isSalesperson && user?.subsidiaryId && form.subsidiaryId !== user.subsidiaryId) {
      setForm((current) => ({ ...current, subsidiaryId: user.subsidiaryId || '' }))
      return
    }

    if (!isSalesperson && !form.subsidiaryId && subsidiaries.length > 0) {
      setForm((current) => ({ ...current, subsidiaryId: subsidiaries[0].id }))
    }
  }, [isSalesperson, user?.subsidiaryId, subsidiaries, form.subsidiaryId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const resolvedSubsidiaryId = isSalesperson ? (user?.subsidiaryId || '') : form.subsidiaryId

    if (!resolvedSubsidiaryId) {
      toast.error('Please select a subsidiary before creating a product')
      return
    }

    if (isConverting && fxError) {
      toast.error('Cannot save: FX rate for selected currency is unavailable.')
      return
    }

    setLoading(true)
    try {
      const payload = {
        ...form,
        costPrice: baseCostPrice,
        sellingPrice: baseSellingPrice,
        // Persist original-entry currency provenance so the list can always
        // show the entered price alongside the current base-currency equivalent.
        originalCurrency: isConverting ? priceCurrency : undefined,
        originalCostPrice: isConverting ? rawCostPrice : null,
        originalSellingPrice: isConverting ? rawSellingPrice : null,
        subsidiaryId: resolvedSubsidiaryId,
      }

      if (product) {
        await api.put(`/products/${product.id}`, payload)
        toast.success('Product updated')
      } else {
        await api.post('/products', payload)
        toast.success('Product created')
      }
      onSaved()
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Failed to save')
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">{product ? 'Edit Product' : 'Add Product'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'GOODS' | 'SERVICE' })}>
                <option value="GOODS">Goods</option>
                <option value="SERVICE">Service</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input className="input" value={form.category} placeholder="Uncategorized" onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
              <input className="input" value={form.unit} placeholder="pcs, kg, hr..." onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>

            {/* ── Price Currency Selector ── */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Price Currency</label>
              <select
                className="input"
                value={priceCurrency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                ))}
              </select>
              {isConverting && fxLoading && (
                <p className="mt-1 text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading exchange rate…</p>
              )}
              {isConverting && fxError && !fxLoading && (
                <p className="mt-1 text-xs text-danger-600">{fxError}</p>
              )}
              {isConverting && !fxError && !fxLoading && resolvedFxRate > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  1 {priceCurrency} = {fmt(1 / resolvedFxRate)}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price *</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={rawCostPrice}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0
                  setRawCostPrice(v)
                  if (!isConverting) setForm({ ...form, costPrice: v })
                }}
                required
              />
              {isConverting && !fxError && rawCostPrice > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  ≈ {fmt(baseCostPrice)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Selling Price *</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={rawSellingPrice}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0
                  setRawSellingPrice(v)
                  if (!isConverting) setForm({ ...form, sellingPrice: v })
                }}
                required
              />
              {isConverting && !fxError && rawSellingPrice > 0 && (
                <p className="mt-1 text-xs text-gray-500">
                  ≈ {fmt(baseSellingPrice)}
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input className="input" type="number" step="0.001" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
              <input className="input" type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Alert</label>
              <input className="input" type="number" step="1" min="0" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
              <input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Optional" />
            </div>
            {form.type === 'GOODS' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (Optional)</label>
                <input className="input" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'DRAFT' | 'ARCHIVED' })}>
                <option value="ACTIVE">Active</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Subsidiary *</label>
              <select
                className="input"
                value={form.subsidiaryId}
                onChange={(e) => setForm({ ...form, subsidiaryId: e.target.value })}
                disabled={isSalesperson}
                required
              >
                {!isSalesperson && <option value="">Select a subsidiary</option>}
                {subsidiaries.map((subsidiary) => (
                  <option key={subsidiary.id} value={subsidiary.id}>{subsidiary.name}</option>
                ))}
              </select>
              {isSalesperson && (
                <p className="mt-1 text-xs text-gray-500">Products are created under your assigned subsidiary.</p>
              )}
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea className="input resize-none" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>

          {/* Margin indicator */}
          {baseCostPrice > 0 && baseSellingPrice > 0 && (() => {
            const marginPct = ((baseSellingPrice - baseCostPrice) / baseCostPrice) * 100
            const color = marginPct >= 30 ? 'text-success-600' : marginPct >= 15 ? 'text-warning-600' : 'text-danger-600'
            const profit = baseSellingPrice - baseCostPrice
            return (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <span className="text-gray-500">Margin: </span>
                <span className={`font-semibold ${color}`}>
                  {fmt(profit)} ({marginPct.toFixed(1)}%)
                </span>
                {isConverting && rawCostPrice > 0 && rawSellingPrice > 0 && (
                  <span className="ml-2 text-gray-400 text-xs">
                    ({makeCurrencyFormatter(priceCurrency)(rawSellingPrice - rawCostPrice)})
                  </span>
                )}
              </div>
            )
          })()}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {product ? 'Save Changes' : 'Create Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
