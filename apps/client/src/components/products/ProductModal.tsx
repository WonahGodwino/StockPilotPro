import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { Product, ProductSalesUnit, SalesUnitLabel } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { getApiErrorMessage } from '@/lib/apiError'
import { makeCurrencyFormatter, SUPPORTED_CURRENCIES } from '@/lib/currency'
import { X, Loader2, Plus, Trash2 } from 'lucide-react'

interface Props {
  product: Product | null
  onClose: () => void
  onSaved: () => void
}

const SALES_UNIT_PRESETS: Array<{ label: SalesUnitLabel; abbreviation: string; description: string }> = [
  { label: 'pcs', abbreviation: 'pcs', description: 'Single piece / unit' },
  { label: 'carton', abbreviation: 'ctn', description: 'Carton (e.g. 12 pcs)' },
  { label: 'packet', abbreviation: 'pkt', description: 'Packet / sachet' },
  { label: 'bag', abbreviation: 'bag', description: 'Bag (e.g. 50 kg)' },
  { label: 'box', abbreviation: 'box', description: 'Box' },
  { label: 'dozen', abbreviation: 'doz', description: 'Dozen (12 pcs)' },
  { label: 'kg', abbreviation: 'kg', description: 'Kilogram' },
  { label: 'litre', abbreviation: 'L', description: 'Litre' },
  { label: 'custom', abbreviation: 'unit', description: 'Custom unit' },
]

function generateSalesUnitId(): string {
  return `su_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function SalesUnitsEditor({
  value,
  baseUnit,
  basePrice,
  onChange,
}: {
  value: ProductSalesUnit[]
  baseUnit: string
  basePrice: number
  onChange: (units: ProductSalesUnit[]) => void
}) {
  const retailUnit = value.find((u) => u.isRetail === true)
  const wholesaleUnits = value.filter((u) => u.isRetail !== true)
  const hasRetail = Boolean(retailUnit)

  const addRetailUnit = () => {
    if (hasRetail) return
    const newUnit: ProductSalesUnit = {
      id: generateSalesUnitId(),
      label: 'pcs',
      abbreviation: 'pcs',
      unitsPerBase: 1,
      sellingPrice: basePrice,
      isRetail: true,
    }
    onChange([newUnit, ...value])
  }

  const addWholesaleUnit = () => {
    const retailUnitsPerWholesale = 12
    const newUnit: ProductSalesUnit = {
      id: generateSalesUnitId(),
      label: 'carton',
      abbreviation: 'ctn',
      unitsPerBase: retailUnitsPerWholesale,
      sellingPrice: Number((basePrice * retailUnitsPerWholesale * 0.9).toFixed(2)),
      isRetail: false,
      retailUnitsPerWholesale,
    }
    onChange([...value, newUnit])
  }

  const removeUnit = (id: string) => {
    onChange(value.filter((unit) => unit.id !== id))
  }

  const updateUnit = (id: string, patch: Partial<ProductSalesUnit>) => {
    onChange(value.map((unit) => (unit.id === id ? { ...unit, ...patch } : unit)))
  }

  const handleLabelChange = (id: string, newLabel: SalesUnitLabel | string) => {
    const unit = value.find((u) => u.id === id)
    if (!unit) return
    const preset = SALES_UNIT_PRESETS.find((p) => p.label === newLabel)
    const patch: Partial<ProductSalesUnit> = {
      label: newLabel as SalesUnitLabel,
      abbreviation: preset?.abbreviation || unit.abbreviation,
    }
    if (newLabel !== 'custom' && unit.isRetail !== true) {
      const defaultMultipliers: Partial<Record<SalesUnitLabel, number>> = {
        carton: 12, packet: 1, bag: 50, box: 24, dozen: 12, kg: 1, litre: 1, pcs: 1,
      }
      const multiplier = defaultMultipliers[newLabel as SalesUnitLabel] || 1
      patch.unitsPerBase = multiplier
      patch.retailUnitsPerWholesale = multiplier
      patch.sellingPrice = Number((basePrice * multiplier * 0.9).toFixed(2))
    }
    onChange(value.map((u) => (u.id === id ? { ...u, ...patch } : u)))
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-xs text-gray-400 italic">No sales units defined. Add units below to enable selling in different bundle sizes.</p>
      )}
      {value.map((unit) => {
        const isCustom = unit.label === 'custom' || !SALES_UNIT_PRESETS.some((p) => p.label === unit.label)
        return (
          <div key={unit.id} className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-white p-3">
            <div className="min-w-[100px]">
              <label className="block text-[10px] font-semibold uppercase text-gray-500">Unit</label>
              <select
                className="input mt-0.5 text-xs"
                value={isCustom ? 'custom' : unit.label}
                onChange={(e) => handleLabelChange(unit.id, e.target.value)}
              >
                {SALES_UNIT_PRESETS.map((preset) => (
                  <option key={preset.label} value={preset.label}>
                    {preset.description}
                  </option>
                ))}
              </select>
            </div>
            {isCustom && (
              <div className="min-w-[80px]">
                <label className="block text-[10px] font-semibold uppercase text-gray-500">Name</label>
                <input
                  className="input mt-0.5 text-xs"
                  value={unit.customName || ''}
                  onChange={(e) => updateUnit(unit.id, { customName: e.target.value, abbreviation: e.target.value.slice(0, 4) || 'unit' })}
                  placeholder="Custom"
                />
              </div>
            )}
            <div className="min-w-[60px]">
              <label className="block text-[10px] font-semibold uppercase text-gray-500">Abbr</label>
              <input
                className="input mt-0.5 text-xs"
                value={unit.abbreviation}
                onChange={(e) => updateUnit(unit.id, { abbreviation: e.target.value })}
                maxLength={6}
              />
            </div>
            <div className="min-w-[70px]">
              <label className="block text-[10px] font-semibold uppercase text-gray-500">Qty={baseUnit}</label>
              <input
                className="input mt-0.5 text-xs"
                type="number"
                step="0.001"
                min="0.001"
                value={unit.unitsPerBase}
                onChange={(e) => {
                  const qty = parseFloat(e.target.value) || 1
                  updateUnit(unit.id, { unitsPerBase: qty, sellingPrice: Number((basePrice * qty).toFixed(2)) })
                }}
              />
            </div>
            <div className="min-w-[90px]">
              <label className="block text-[10px] font-semibold uppercase text-gray-500">Price</label>
              <input
                className="input mt-0.5 text-xs"
                type="number"
                step="0.01"
                min="0"
                value={unit.sellingPrice}
                onChange={(e) => updateUnit(unit.id, { sellingPrice: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <button
              type="button"
              className="mb-0.5 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors"
              onClick={() => removeUnit(unit.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-2">
        {!hasRetail && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
            onClick={addRetailUnit}
          >
            <Plus className="w-4 h-4" /> Add Retail Unit
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
          onClick={addWholesaleUnit}
        >
          <Plus className="w-4 h-4" /> Add Wholesale Unit
        </button>
      </div>

      {hasRetail && wholesaleUnits.length > 0 && (() => {
        const wholesaleDiscount = wholesaleUnits.map((wu) => {
          const expectedRetailTotal = basePrice * (wu.retailUnitsPerWholesale || wu.unitsPerBase)
          const actualWholesalePrice = wu.sellingPrice
          const discountPct = expectedRetailTotal > 0 ? ((expectedRetailTotal - actualWholesalePrice) / expectedRetailTotal) * 100 : 0
          return { id: wu.id, discountPct }
        })
        return (
          <div className="mt-2 rounded-md border border-sky-100 bg-sky-50 p-2 text-[10px]">
            <p className="font-semibold text-sky-700 mb-1">Wholesale Discount Summary</p>
            {wholesaleDiscount.map((wd) => (
              <p key={wd.id} className="text-sky-800">
                Wholesale discount: <strong>{wd.discountPct.toFixed(0)}%</strong> off equivalent retail price
              </p>
            ))}
          </div>
        )
      })()}

      {value.length > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">
          Base unit: <strong>{baseUnit}</strong>. Inventory tracked in base units. Retail is the smallest saleable unit; wholesale bundles multiple retail units with a volume discount.
        </p>
      )}
    </div>
  )
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

  const [salesUnits, setSalesUnits] = useState<ProductSalesUnit[]>(product?.salesUnits || [])

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
        originalCurrency: isConverting ? priceCurrency : undefined,
        originalCostPrice: isConverting ? rawCostPrice : null,
        originalSellingPrice: isConverting ? rawSellingPrice : null,
        salesUnits: salesUnits.length > 0 ? salesUnits : undefined,
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
      <div className={`bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto ${form.type === 'GOODS' ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{product ? 'Edit Product' : 'New Product'}</h2>
            <p className="text-xs text-gray-500 mt-0.5">Fill in the details below to {product ? 'update' : 'create'} a product record</p>
          </div>
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

            {/* ── Multi-Unit Sales Configuration ── */}
            {form.type === 'GOODS' && (
              <div className="col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Sales Units</p>
                    <p className="text-xs text-gray-500 mt-0.5">Define how this product is sold in different bundle sizes (e.g. carton, packet, bag)</p>
                  </div>
                </div>

                <SalesUnitsEditor
                  value={salesUnits}
                  baseUnit={form.unit}
                  basePrice={baseSellingPrice}
                  onChange={(units) => setSalesUnits(units)}
                />
              </div>
            )}
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
