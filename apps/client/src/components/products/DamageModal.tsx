import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getApiErrorMessage } from '@/lib/apiError'
import type { Product } from '@/types'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/auth.store'
import { makeCurrencyFormatter } from '@/lib/currency'
import { X, Loader2, AlertTriangle } from 'lucide-react'

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning-600" />
            <h2 className="text-lg font-semibold text-gray-900">Register Damage/Expired</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Product Search/Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Product</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or barcode"
              className="input w-full"
            />
            {loadingProducts && <p className="text-xs text-gray-500 mt-1">Searching products...</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Product</label>
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
                  {p.name} ({Number(p.quantity)} {p.unit})
                </option>
              ))}
            </select>
            {!loadingProducts && filteredProducts.length === 0 && (
              <p className="text-xs text-gray-500 mt-1">No registered product matched your search.</p>
            )}
          </div>

          {/* Product Info */}
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
            <p className="text-sm font-medium text-gray-600">Product</p>
            <p className="text-gray-900 font-semibold">{selectedProduct?.name || 'No product selected'}</p>
            <p className="text-sm text-gray-500">Available: {availableQuantity} {selectedProduct?.unit || form.unit}</p>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Quantity to Register
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              max={availableQuantity}
              value={form.quantity || ''}
              onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })}
              className="input w-full"
              placeholder="Enter quantity"
            />
          </div>

          {/* Unit */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
            <select
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              className="input w-full"
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {/* Damage Stage */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Damage Stage</label>
            <select
              value={form.damageStage}
              onChange={(e) => setForm({ ...form, damageStage: e.target.value as 'FINISHED_GOODS' | 'RAW_MATERIAL' })}
              className="input w-full"
            >
              <option value="FINISHED_GOODS">Finished goods (use selling price)</option>
              <option value="RAW_MATERIAL">Raw material (use purchase price)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Unit price used: {fmt(baseUnitPrice)} • Estimated damage cost: {fmt(estimatedCost)}
            </p>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reason
            </label>
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

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (Optional)
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input w-full"
              placeholder="Add notes about the damage/expiration..."
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 font-medium transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-warning-600 text-white rounded-lg hover:bg-warning-700 font-medium transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Register
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
