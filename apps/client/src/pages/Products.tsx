import { useEffect, useState } from 'react'
import { Plus, Search, Edit2, Archive, Package, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import type { Product } from '@/types'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import ProductModal from '@/components/products/ProductModal'
import { cacheProducts } from '@/lib/db'

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

export default function Products() {
  const user = useAuthStore((s) => s.user)
  const [products, setProducts] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)

  const canManage = user?.role !== 'SALESPERSON'
  const canDelete = user?.role === 'BUSINESS_ADMIN' || user?.role === 'SUPER_ADMIN'

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('type', typeFilter)
      params.set('page', String(p))
      params.set('limit', String(PAGE_SIZE))
      const { data } = await api.get(`/products?${params}`)
      setProducts(data.data)
      setTotal(data.total ?? data.data.length)
      await cacheProducts(data.data) // cache for offline
    } catch { toast.error('Failed to load products') }
    finally { setLoading(false) }
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const totalWorth = products
    .filter((p) => p.status === 'ACTIVE')
    .reduce((s, p) => s + p.quantity * Number(p.costPrice), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-1">
            {products.length} items &nbsp;·&nbsp; Inventory worth:{' '}
            <span className="font-semibold text-gray-700">
              ${totalWorth.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={() => { setEditing(null); setModalOpen(true) }}>
            <Plus className="w-4 h-4" /> Add Product
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="input pl-9"
            placeholder="Search by name or barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input w-36" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="GOODS">Goods</option>
          <option value="SERVICE">Service</option>
        </select>
        <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          {canDelete && <option value="ARCHIVED">Archived</option>}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12">
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
                  return (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-gray-900">{p.name}</p>
                          {p.barcode && <p className="text-xs text-gray-400">{p.barcode}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.type}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${isLow ? 'text-danger-600' : 'text-gray-900'}`}>
                          {p.quantity} {p.unit}
                        </span>
                        {isLow && (
                          <span className="ml-1.5 badge bg-danger-50 text-danger-600">Low</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">${cost.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">${sell.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${marginColor(marginPct)}`}>
                          {marginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${statusColors[p.status]}`}>{p.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        {canManage && (
                          <div className="flex items-center justify-end gap-1">
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages} &nbsp;·&nbsp; {total} total
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <ProductModal
          product={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(page) }}
        />
      )}
    </div>
  )
}
