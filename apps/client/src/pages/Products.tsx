import { useEffect, useState } from 'react'
import { Plus, Search, Edit2, Archive, Package, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import type { Product } from '@/types'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import ProductModal from '@/components/products/ProductModal'
import DamageModal from '@/components/products/DamageModal'
import Pagination from '@/components/Pagination'
import { getCachedProductsForTenant, replaceCachedProductsForTenant } from '@/lib/db'
import { makeCurrencyFormatter } from '@/lib/currency'

const PAGE_SIZE = 20

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-success-50 text-success-600',
  DRAFT: 'bg-warning-50 text-warning-600',
  ARCHIVED: 'bg-gray-100 text-gray-500',
}

function marginColor(pct: number): string {
  if (pct >= 30) return 'text-success-600'
  if (pct >= 15) return 'text-warning-600'
  return 'text-danger-600'
}

function ExpiryStatusBadge({ expiryDate }: { expiryDate?: string }) {
  if (!expiryDate) return null
  
  const today = new Date()
  const expiry = new Date(expiryDate)
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  
  if (daysUntilExpiry < 0) {
    return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-danger-100 text-danger-700">Expired</span>
  }
  
  if (daysUntilExpiry <= 7) {
    return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-warning-100 text-warning-700">Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}</span>
  }
  
  return <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Expires in {daysUntilExpiry} day{daysUntilExpiry !== 1 ? 's' : ''}</span>
}

export default function Products() {
  const user = useAuthStore((s) => s.user)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [damageModalOpen, setDamageModalOpen] = useState(false)
  const [damagingProduct, setDamagingProduct] = useState<Product | null>(null)
  const [reloadError, setReloadError] = useState<string | null>(null)
  // Map of originalCurrency → base-currency rate (1 unit of original = rate units of base)
  const [fxRates, setFxRates] = useState<Record<string, number>>({})

  const canManage = user?.role !== 'SALESPERSON'
  const canDelete = user?.role === 'BUSINESS_ADMIN' || user?.role === 'SUPER_ADMIN'

  const applyRoleFilter = (records: Product[]) => {
    if (!user) return []
    const scoped = user.subsidiaryId
      ? records.filter((item) => item.subsidiaryId === user.subsidiaryId)
      : records

    if (user.role === 'SALESPERSON') {
      return scoped.filter((item) => item.status === 'ACTIVE' || item.status === 'DRAFT')
    }
    return scoped
  }

  const applyFilters = (records: Product[]) => {
    const normalizedSearch = search.trim().toLowerCase()
    return records.filter((item) => {
      const matchesSearch = !normalizedSearch
        || item.name.toLowerCase().includes(normalizedSearch)
        || (item.barcode || '').toLowerCase().includes(normalizedSearch)
      const matchesStatus = !statusFilter || item.status === statusFilter
      const matchesType = !typeFilter || item.type === typeFilter
      return matchesSearch && matchesStatus && matchesType
    })
  }

  const refreshOfflineProductCache = async () => {
    if (!navigator.onLine || !user?.tenantId) return

    const allAccessible: Product[] = []
    let cursor = 1
    const pageSize = 200
    while (cursor <= 50) {
      const params = new URLSearchParams()
      params.set('page', String(cursor))
      params.set('limit', String(pageSize))
      if (user.subsidiaryId) params.set('subsidiaryId', user.subsidiaryId)
      const { data } = await api.get(`/products?${params}`)
      const rows = data.data as Product[]
      allAccessible.push(...rows)
      if (rows.length < pageSize || allAccessible.length >= Number(data.total || 0)) break
      cursor += 1
    }

    await replaceCachedProductsForTenant(user.tenantId, allAccessible)
  }

  const load = async (p = page) => {
    setLoading(true)
    setReloadError(null)
    try {
      if (!navigator.onLine && user?.tenantId) {
        const cached = await getCachedProductsForTenant(user.tenantId, user.subsidiaryId || undefined)
        const visible = applyRoleFilter(cached)
        const filtered = applyFilters(visible)
        const start = (p - 1) * PAGE_SIZE
        const end = start + PAGE_SIZE
        const pageRows = filtered.slice(start, end)
        setProducts(pageRows)
        setTotal(filtered.length)
        void loadFxRates(pageRows)
        return
      }

      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('type', typeFilter)
      params.set('page', String(p))
      params.set('limit', String(PAGE_SIZE))
      const { data } = await api.get(`/products?${params}`)
      const pageRows = applyRoleFilter(data.data)
      setProducts(pageRows)
      setTotal(data.total ?? data.data.length)
      void loadFxRates(pageRows)
      // Keep UI responsive even if offline cache refresh is slow/fails.
      void refreshOfflineProductCache().catch(() => undefined)
    } catch {
      setReloadError('Could not refresh products. Please try again.')
      toast.error('Failed to load products')
    }
    finally { setLoading(false) }
  }

  // Fetch one FX rate per unique originalCurrency found on this page.
  // Rate = 1 originalCurrency → X baseCurrency (used to compute bracket values).
  const loadFxRates = async (rows: Product[]) => {
    const currencies = [...new Set(
      rows
        .map((r) => r.originalCurrency)
        .filter((c): c is string => !!c && c !== baseCurrency)
    )]
    if (currencies.length === 0) return
    const fetched: Record<string, number> = {}
    await Promise.all(currencies.map(async (orig) => {
      try {
        // Ask for fromCurrency=baseCurrency toCurrency=orig
        // rate = how many orig per 1 base, so 1 orig = 1/rate base
        const { data } = await api.get(`/currency-rates?fromCurrency=${baseCurrency}&toCurrency=${orig}`)
        const r = Number(data?.data?.rate)
        if (Number.isFinite(r) && r > 0) fetched[orig] = r
      } catch { /* no rate saved – bracket will be suppressed */ }
    }))
    setFxRates((prev) => ({ ...prev, ...fetched }))
  }

  useEffect(() => { setPage(1); load(1) }, [search, statusFilter, typeFilter])
  useEffect(() => { load(page) }, [page])

  const handleDelete = async (id: string) => {
    if (!confirm('Archive this product?')) return
    try {
      await api.delete(`/products/${id}`)
      toast.success('Product archived')
      load(page)
    } catch { toast.error('Failed to archive product') }
  }

  const totalWorth = products
    .filter((p) => p.status === 'ACTIVE')
    .reduce((s, p) => s + p.quantity * Number(p.costPrice), 0)

  return (
      <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage inventory, pricing, and stock levels across all branches
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                setDamagingProduct(null)
                setDamageModalOpen(true)
              }}
            >
              <AlertTriangle className="w-4 h-4" /> Register Damage
            </button>
            <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
              <Plus className="w-4 h-4" /> Add Product
            </button>
          </div>
        )}
      </div>

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-indigo-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Total Products</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">{total}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-emerald-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Active</p>
          </div>
          <p className="text-2xl font-bold text-emerald-700 mt-2 tabular-nums">
            {products.filter((p) => p.status === 'ACTIVE').length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Low Stock</p>
          </div>
          <p className="text-2xl font-bold text-rose-700 mt-2 tabular-nums">
            {products.filter((p) => p.type === 'GOODS' && p.quantity <= p.lowStockThreshold).length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-cyan-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Inv. Worth</p>
          </div>
          <p className="text-xl font-bold text-gray-900 mt-2 tabular-nums">{fmt(totalWorth)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search by name or barcode..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        <select className="input w-36" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}>
          <option value="">All Types</option>
          <option value="GOODS">Goods</option>
          <option value="SERVICE">Service</option>
        </select>
        <select className="input w-40" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          {canDelete && <option value="ARCHIVED">Archived</option>}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {reloadError && (
          <div className="px-4 py-3 border-b border-warning-200 bg-warning-50 text-warning-800 text-sm flex items-center justify-between">
            <span>{reloadError}</span>
            <button className="btn-secondary" onClick={() => { void load(page) }}>
              Retry
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Stock</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Cost</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Profit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Expiry</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <Package className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-400 text-sm">No products found</p>
                  </td>
                </tr>
              ) : (
                products.map((p) => {
                  const cost = Number(p.costPrice)
                  const sell = Number(p.sellingPrice)
                  const marginPct = cost > 0 ? ((sell - cost) / cost) * 100 : 0
                  const isLow = p.type === 'GOODS' && p.quantity <= p.lowStockThreshold

                  // Show original entry currency + live-converted base-currency bracket
                  const origCurrency = p.originalCurrency && p.originalCurrency !== baseCurrency ? p.originalCurrency : null
                  const origRate = origCurrency ? fxRates[origCurrency] : null // baseCurrency→origCurrency rate
                  // 1 origCurrency = 1/origRate baseCurrency
                  const origCostBase  = origCurrency && origRate && p.originalCostPrice    != null ? Number(p.originalCostPrice)    / origRate : null
                  const origSellBase  = origCurrency && origRate && p.originalSellingPrice != null ? Number(p.originalSellingPrice)  / origRate : null
                  const fmtOrig = origCurrency ? makeCurrencyFormatter(origCurrency) : null
                  return (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">{p.name}</p>
                          {p.barcode && <p className="text-xs text-gray-400">{p.barcode}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.type}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${isLow ? 'text-danger-600' : 'text-gray-900'}`}>
                          {p.quantity} {p.keepingUnit || p.unit}
                        </span>
                        {p.sellingUnit && p.keepingToSellingRate != null && Number(p.keepingToSellingRate) > 0 && (
                          <span className="text-xs text-gray-400 ml-1">
                            (≈{(p.quantity * Number(p.keepingToSellingRate)).toLocaleString()} {p.sellingUnit})
                          </span>
                        )}
                        {isLow && (
                          <span className="ml-1.5 badge bg-danger-50 text-danger-600">Low</span>
                        )}
                        {(p.purchaseUnit || p.keepingUnit || p.sellingUnit) && (
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            {p.purchaseUnit && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[10px] font-medium">
                                Buy: {p.purchaseUnit}
                              </span>
                            )}
                            {p.keepingUnit && <span className="text-gray-300 text-[10px]">→</span>}
                            {p.keepingUnit && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-medium">
                                Keep: {p.keepingUnit}
                              </span>
                            )}
                            {p.sellingUnit && <span className="text-gray-300 text-[10px]">→</span>}
                            {p.sellingUnit && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-50 text-green-700 text-[10px] font-medium">
                                Sell: {p.sellingUnit}
                              </span>
                            )}
                            {p.purchaseToKeepingRate != null && Number(p.purchaseToKeepingRate) > 0 && (
                              <span className="text-[10px] text-gray-400 w-full">1 {p.purchaseUnit} = {Number(p.purchaseToKeepingRate)} {p.keepingUnit || p.unit}</span>
                            )}
                            {p.keepingToSellingRate != null && Number(p.keepingToSellingRate) > 0 && (
                              <span className="text-[10px] text-gray-400 w-full">1 {p.keepingUnit || p.unit} = {Number(p.keepingToSellingRate)} {p.sellingUnit || p.unit}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {fmtOrig && p.originalCostPrice != null
                          ? <>{fmtOrig(Number(p.originalCostPrice))}{origCostBase != null && <span className="text-gray-400 text-xs ml-1">({fmt(origCostBase)})</span>}</>
                          : fmt(cost)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {fmtOrig && p.originalSellingPrice != null
                          ? <>{fmtOrig(Number(p.originalSellingPrice))}{origSellBase != null && <span className="text-gray-400 text-xs ml-1">({fmt(origSellBase)})</span>}</>
                          : fmt(sell)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${marginColor(marginPct)}`}>
                          {marginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {p.type === 'GOODS' && p.expiryDate ? (
                          <ExpiryStatusBadge expiryDate={p.expiryDate} />
                        ) : (
                          <span className="text-xs text-gray-400">N/A</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusColors[p.status]}`}>{p.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        {canManage && (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setDamagingProduct(p); setDamageModalOpen(true) }}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-warning-600"
                              title="Register damage/expired"
                            >
                              <AlertTriangle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => { setEditing(p); setModalOpen(true) }}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-primary-600"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            {canDelete && (
                              <button
                                onClick={() => handleDelete(p.id)}
                                className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-danger-600"
                              >
                                <Archive className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      {modalOpen && (
        <ProductModal
          product={editing}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSaved={(opts) => {
            if (opts?.editProductId) {
              // Duplicate resolved — open edit mode for existing product
              const existing = products.find((p) => p.id === opts.editProductId)
              if (existing) {
                setEditing(existing)
                // modal stays open — ProductModal re-renders with product prop set
                return
              }
            }
            setModalOpen(false)
            setEditing(null)
            void load(page)
          }}
        />
      )}

      {damageModalOpen && (
        <DamageModal
          product={damagingProduct}
          products={products}
          onClose={() => { setDamageModalOpen(false); setDamagingProduct(null) }}
          onSaved={() => load(page)}
        />
      )}
    </div>
  )
}
