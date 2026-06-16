import { useEffect, useState } from 'react'
import api from '@/lib/api'
import type { Product, ProductSalesUnit, SalesUnitLabel } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
import { getApiErrorMessage } from '@/lib/apiError'
import { makeCurrencyFormatter, SUPPORTED_CURRENCIES } from '@/lib/currency'
import { X, Loader2, Plus, Trash2, Tag, Package, Check } from 'lucide-react'

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
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])
  const [brand, setBrand] = useState('')

  const isConverting = priceCurrency !== baseCurrency

  // Load tenant categories on mount
  useEffect(() => {
    let cancelled = false
    api.get('/product-setup').then(({ data }) => {
      if (!cancelled) setCategories(data.data || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

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
        originalCostPrice: isConverting ? rawCostPrice : undefined,
        originalSellingPrice: isConverting ? rawSellingPrice : undefined,
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

  const [activeTab, setActiveTab] = useState<'details' | 'categories' | 'brands'>('details')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newBrandName, setNewBrandName] = useState('')
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([])
  const [setupSaving, setSetupSaving] = useState(false)

  const loadCategories = () => {
    let cancelled = false
    api.get('/product-setup').then(({ data }) => {
      if (!cancelled) setCategories(data.data || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }

  const loadBrands = () => {
    let cancelled = false
    api.get('/product-setup?type=brands').then(({ data }) => {
      if (!cancelled) setBrands(data.data || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }

  useEffect(() => {
    const cancelCategories = loadCategories()
    const cancelBrands = loadBrands()
    return () => { cancelCategories(); cancelBrands() }
  }, [])

  const addCategory = async () => {
    const name = newCategoryName.trim()
    if (!name) return
    setSetupSaving(true)
    try {
      await api.post('/product-setup', { name, type: 'category' })
      toast.success(`Category "${name}" added`)
      setNewCategoryName('')
      loadCategories()
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to add category'))
    } finally { setSetupSaving(false) }
  }

  const addBrand = async () => {
    const name = newBrandName.trim()
    if (!name) return
    setSetupSaving(true)
    try {
      await api.post('/product-setup', { name, type: 'brand' })
      toast.success(`Brand "${name}" added`)
      setNewBrandName('')
      loadBrands()
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to add brand'))
    } finally { setSetupSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-slate-50 via-gray-50 to-indigo-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 bg-white/95 backdrop-blur-sm border-b border-gray-200/80 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-200">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">{product ? 'Edit Product' : 'New Product'}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{product ? 'Update product details' : 'Add a new product to your inventory'} and manage categories & brands</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-sm">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} disabled={loading}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-xl hover:from-indigo-700 hover:to-indigo-800 transition-all duration-200 shadow-md shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {product ? 'Save Changes' : 'Create Product'}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-gray-200/80 bg-white/90 backdrop-blur-sm px-8 gap-0">
        {(['details', 'categories', 'brands'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`relative px-6 py-3.5 text-sm font-semibold transition-all duration-200 border-b-2 ${
              activeTab === tab
                ? 'border-indigo-600 text-indigo-700 bg-indigo-50/30'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 hover:bg-gray-50/50'
            }`}
          >
            <span className="flex items-center gap-2">
              {tab === 'details' && <Package className="w-4 h-4" />}
              {tab === 'categories' && <Tag className="w-4 h-4" />}
              {tab === 'brands' && '🏷'}
              {tab === 'details' && 'Product Details'}
              {tab === 'categories' && 'Categories'}
              {tab === 'brands' && 'Brands'}
              {(tab === 'categories' || tab === 'brands') && (
                <span className={`ml-1.5 inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-bold ${
                  activeTab === tab ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tab === 'categories' ? categories.length : brands.length}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {activeTab === 'details' && (
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-6">
            {/* Basic Info Section */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Package className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">Basic Information</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
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
                  <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    <option value="Uncategorized">Uncategorized</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                  <select className="input" value={brand} onChange={(e) => setBrand(e.target.value)}>
                    <option value="">No brand</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <input className="input" value={form.unit} placeholder="pcs, kg, hr..." onChange={(e) => setForm({ ...form, unit: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Pricing Section */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <Tag className="w-4 h-4 text-emerald-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">Pricing & Currency</h3>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Price Currency</label>
                  <select className="input" value={priceCurrency} onChange={(e) => handleCurrencyChange(e.target.value)}>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                    ))}
                  </select>
                  {isConverting && fxLoading && (
                    <p className="mt-1.5 text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading exchange rate…</p>
                  )}
                  {isConverting && fxError && !fxLoading && <p className="mt-1.5 text-xs text-rose-600 font-medium">{fxError}</p>}
                  {isConverting && !fxError && !fxLoading && resolvedFxRate > 0 && (
                    <p className="mt-1.5 text-xs text-gray-500 font-medium">1 {priceCurrency} = {fmt(1 / resolvedFxRate)}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Cost Price *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{priceCurrency === baseCurrency ? baseCurrency : priceCurrency}</span>
                      <input className="input pl-16" type="number" step="0.01" min="0" value={rawCostPrice}
                        onChange={(e) => { const v = parseFloat(e.target.value) || 0; setRawCostPrice(v); if (!isConverting) setForm({ ...form, costPrice: v }) }} required />
                    </div>
                    {isConverting && !fxError && rawCostPrice > 0 && <p className="mt-1.5 text-xs text-gray-500">≈ {fmt(baseCostPrice)}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Selling Price *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{priceCurrency === baseCurrency ? baseCurrency : priceCurrency}</span>
                      <input className="input pl-16" type="number" step="0.01" min="0" value={rawSellingPrice}
                        onChange={(e) => { const v = parseFloat(e.target.value) || 0; setRawSellingPrice(v); if (!isConverting) setForm({ ...form, sellingPrice: v }) }} required />
                    </div>
                    {isConverting && !fxError && rawSellingPrice > 0 && <p className="mt-1.5 text-xs text-gray-500">≈ {fmt(baseSellingPrice)}</p>}
                  </div>
                </div>
                {baseCostPrice > 0 && baseSellingPrice > 0 && (() => {
                  const marginPct = ((baseSellingPrice - baseCostPrice) / baseCostPrice) * 100
                  const bgColor = marginPct >= 30 ? 'bg-emerald-50 border-emerald-200' : marginPct >= 15 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'
                  const textColor = marginPct >= 30 ? 'text-emerald-700' : marginPct >= 15 ? 'text-amber-700' : 'text-rose-700'
                  const profit = baseSellingPrice - baseCostPrice
                  return (
                    <div className={`rounded-xl border ${bgColor} p-4`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Profit Margin</p>
                          <p className={`text-xl font-bold ${textColor}`}>{fmt(profit)}</p>
                        </div>
                        <div className={`text-3xl font-bold ${textColor} tabular-nums`}>{marginPct.toFixed(1)}%</div>
                      </div>
                      <div className="mt-2 h-2 bg-white/60 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${marginPct >= 30 ? 'bg-emerald-500' : marginPct >= 15 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, Math.max(0, marginPct))}%` }} />
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>

            {/* Inventory Section */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                <div className="w-8 h-8 rounded-lg bg-cyan-100 flex items-center justify-center">
                  <Package className="w-4 h-4 text-cyan-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">Inventory & Tracking</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Quantity</label>
                  <input className="input" type="number" step="0.001" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Low Stock Alert</label>
                  <input className="input" type="number" step="1" min="0" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Purchase Date</label>
                  <input className="input" type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Barcode</label>
                  <input className="input" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Optional" />
                </div>
                {form.type === 'GOODS' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Expiry Date</label>
                    <input className="input" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                  <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'ACTIVE' | 'DRAFT' | 'ARCHIVED' })}>
                    <option value="ACTIVE">Active</option>
                    <option value="DRAFT">Draft</option>
                    <option value="ARCHIVED">Archived</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Organization Section */}
            <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <span className="text-lg">🏢</span>
                </div>
                <h3 className="text-base font-semibold text-gray-900">Organization</h3>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Subsidiary *</label>
                  <select className="input" value={form.subsidiaryId} onChange={(e) => setForm({ ...form, subsidiaryId: e.target.value })} disabled={isSalesperson} required>
                    {!isSalesperson && <option value="">Select a subsidiary</option>}
                    {subsidiaries.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </select>
                  {isSalesperson && <p className="mt-1.5 text-xs text-gray-500">Products are created under your assigned subsidiary.</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
                  <textarea className="input resize-none" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Sales Units Section (GOODS only) */}
            {form.type === 'GOODS' && (
              <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                    <span className="text-lg">📐</span>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">Sales Units (Retail & Wholesale)</h3>
                </div>
                <SalesUnitsEditor value={salesUnits} baseUnit={form.unit} basePrice={baseSellingPrice} onChange={(units) => setSalesUnits(units)} />
              </div>
            )}

            {/* Hidden submit for the form */}
            <button type="submit" className="hidden" />
          </form>
        )}

        {activeTab === 'categories' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">📁 Product Categories</h3>
              <p className="text-xs text-gray-500 mb-4">Manage categories for organizing your products. Each business manages its own categories.</p>
              <div className="flex gap-2 mb-4">
                <input className="input flex-1" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Enter category name..." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory() } }} />
                <button type="button" className="btn-primary" onClick={() => { void addCategory() }} disabled={setupSaving || !newCategoryName.trim()}>
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {categories.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No categories yet. Add your first category above.</p>
                ) : (
                  categories.map((cat) => (
                    <div key={cat.id} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-2.5">
                      <span className="text-sm font-medium text-gray-700">{cat.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'brands' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">🏷 Product Brands</h3>
              <p className="text-xs text-gray-500 mb-4">Manage brands for your products. Each business manages its own brands independently.</p>
              <div className="flex gap-2 mb-4">
                <input className="input flex-1" value={newBrandName} onChange={(e) => setNewBrandName(e.target.value)}
                  placeholder="Enter brand name..." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addBrand() } }} />
                <button type="button" className="btn-primary" onClick={() => { void addBrand() }} disabled={setupSaving || !newBrandName.trim()}>
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {brands.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No brands yet. Add your first brand above.</p>
                ) : (
                  brands.map((b) => (
                    <div key={b.id} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-2.5">
                      <span className="text-sm font-medium text-gray-700">{b.name}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
