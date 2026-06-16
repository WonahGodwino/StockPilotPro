import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getApiErrorMessage } from '@/lib/apiError'
import type { Product } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { makeCurrencyFormatter } from '@/lib/currency'
import { X, Loader2, AlertTriangle, Package, Search } from 'lucide-react'

interface Props {
  product?: Product | null
  products?: Product[]
  onClose: () => void
  onSaved: () => void
}

const UNIT_OPTIONS = ['packet', 'pcs', 'carton', 'bag']

export default function DamageModal({ product, products = [], onClose, onSaved }: Props) {
  const user = useAuthStore((s) => s.user)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const fmt = makeCurrencyFormatter(baseCurrency)
  const [loading, setLoading] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [remoteProducts, setRemoteProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState(product?.id || '')
  const [form, setForm] = useState<{
    quantity: number
    unit: string
    damageStage: 'FINISHED_GOODS' | 'RAW_MATERIAL'
    reason: 'DAMAGED' | 'EXPIRED' | 'LOST' | 'RAW_MATERIAL_DAMAGE' | 'OTHER'
    description: string
  }>({
    quantity: 0,
    unit: product?.unit || 'pcs',
    damageStage: 'FINISHED_GOODS',
    reason: 'DAMAGED',
    description: '',
  })

  useEffect(() => {
    let cancelled = false
    const fetchProducts = async () => {
      setLoadingProducts(true)
      try {
        const params = new URLSearchParams()
        params.set('limit', '200')
        params.set('status', 'ACTIVE')
        if (search.trim()) params.set('search', search.trim())
        const { data } = await api.get(`/products?${params.toString()}`)
        if (!cancelled) {
          const list = (data?.data || []) as Product[]
          setRemoteProducts(list.filter((p) => p.type === 'GOODS'))
        }
      } catch {
        if (!cancelled) setRemoteProducts([])
      } finally {
        if (!cancelled) setLoadingProducts(false)
      }
    }

    fetchProducts()
    return () => {
      cancelled = true
    }
  }, [search])

  const candidateProducts = useMemo(() => {
    const merged = [...remoteProducts, ...products, ...(product ? [product] : [])]
    const seen = new Set<string>()
    return merged.filter((p) => {
      if (!p || seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
  }, [remoteProducts, products, product])

  useEffect(() => {
    if (!selectedProductId && candidateProducts.length > 0) {
      setSelectedProductId(candidateProducts[0].id)
    }
  }, [candidateProducts, selectedProductId])
  const selectedProduct =
    candidateProducts.find((p) => p.id === selectedProductId) ||
    product ||
    candidateProducts[0] ||
    null

  const availableQuantity = Number(selectedProduct?.quantity || 0)
  const baseUnitPrice =
    form.damageStage === 'RAW_MATERIAL'
      ? Number(selectedProduct?.costPrice || 0)
      : Number(selectedProduct?.sellingPrice || 0)
  const estimatedCost = baseUnitPrice * form.quantity
  const filteredProducts = candidateProducts

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedProduct) {
      toast.error('Please select a product')
      return
    }

    if (form.quantity <= 0 || form.quantity > availableQuantity) {
      toast.error(`Please enter a quantity between 0 and ${availableQuantity}`)
      return
    }

    setLoading(true)
    try {
      await api.post(`/products/${selectedProduct.id}/damage`, form)
      toast.success(`Registered ${form.quantity} ${form.unit} as ${form.reason.toLowerCase()}`)
      onSaved()
      onClose()
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Failed to register damage')
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b bg-gradient-to-r from-rose-50 to-orange-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-600 flex items-center justify-center shadow-md shadow-rose-200">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 tracking-tight">Register Damage/Expired</h2>
              <p className="text-xs text-gray-500 mt-0.5">Record damaged, expired, or lost inventory</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/80 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Product Selection Section */}
          <div className="rounded-xl border border-gray-200/80 bg-gray-50/50 p-4 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-rose-500" />
              <h3 className="text-sm font-semibold text-gray-900">Select Product</h3>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or barcode..."
                className="input pl-9 w-full"
              />
              {loadingProducts && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
            </div>

            <select
              className="input w-full"
              value={selectedProduct?.id || ''}
              onChange={(e) => {
                const next = candidateProducts.find((p) => p.id === e.target.value)
                setSelectedProductId(e.target.value)
                if (next?.unit) {
                  setForm((prev) => ({ ...prev, unit: next.unit }))
                }
              }}
            >
              {filteredProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({Number(p.quantity)} {p.unit} available)
                </option>
              ))}
            </select>
            {!loadingProducts && filteredProducts.length === 0 && (
              <p className="text-xs text-gray-400 italic">No registered product matched your search.</p>
            )}
          </div>

          {/* Selected Product Info Card */}
          {selectedProduct && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-rose-700 mb-1">Selected Product</p>
                  <p className="text-base font-bold text-gray-900">{selectedProduct.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-rose-600 font-medium">Available Stock</p>
                  <p className="text-lg font-bold text-rose-700 tabular-nums">
                    {availableQuantity} {selectedProduct.unit || form.unit}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Damage Details Section */}
          <div className="rounded-xl border border-gray-200/80 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Damage Details</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Quantity Lost</label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={availableQuantity}
                  value={form.quantity || ''}
                  onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })}
                  className="input w-full text-center text-lg font-bold"
                  placeholder="0"
                />
                {form.quantity > 0 && (
                  <p className="mt-1 text-xs text-gray-500">
                    Remaining after: <strong className="text-rose-600">{Math.max(0, availableQuantity - form.quantity)}</strong> {selectedProduct?.unit || form.unit}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  className="input w-full"
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Damage Stage</label>
                <select
                  value={form.damageStage}
                  onChange={(e) => setForm({ ...form, damageStage: e.target.value as 'FINISHED_GOODS' | 'RAW_MATERIAL' })}
                  className="input w-full"
                >
                  <option value="FINISHED_GOODS">Finished goods</option>
                  <option value="RAW_MATERIAL">Raw material</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Reason</label>
                <select
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value as any })}
                  className="input w-full"
                >
                  <option value="DAMAGED">Damaged</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="LOST">Lost</option>
                  <option value="RAW_MATERIAL_DAMAGE">Raw Material Damage</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description (Optional)</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="input w-full resize-none"
                placeholder="Add notes about the damage/expiration..."
                rows={2}
              />
            </div>
          </div>

          {/* Cost Estimate Card */}
          {form.quantity > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-1">Estimated Loss</p>
                  <p className="text-xl font-bold text-amber-800">{fmt(estimatedCost)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-amber-600 font-medium">Unit Price</p>
                  <p className="text-sm font-semibold text-amber-700">
                    {fmt(baseUnitPrice)} × {form.quantity} {form.unit}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || form.quantity <= 0 || !selectedProduct}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-rose-600 to-orange-600 rounded-xl hover:from-rose-700 hover:to-orange-700 transition-all duration-200 shadow-md shadow-rose-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Register Damage
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}