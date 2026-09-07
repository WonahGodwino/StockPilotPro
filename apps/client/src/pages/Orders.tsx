import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { Search, Filter, Package, Truck, CheckCircle, Clock, Shield, MapPin, Loader2, ChevronDown, ChevronUp, X, ShoppingBag, Phone, Mail } from 'lucide-react'
import { getCurrencySymbol } from '@/lib/currency'
import { useAuthStore } from '@/store/auth.store'
import Pagination from '@/components/Pagination'

interface OrderItem {
  id: string; product: { name: string; unit: string; imageUrl: string | null; sellingUnit?: string | null }; quantity: number
  unitPrice: number; subtotal: number
}

interface Order {
  id: string; customerName: string; customerPhone?: string | null; customerEmail?: string | null
  totalAmount: number; currency: string; notes?: string | null
  createdAt: string; status: string
  subsidiary: { name: string } | null
  items: OrderItem[]
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  PENDING:    { label: 'Pending',    icon: Clock,        color: 'text-amber-600', bg: 'bg-amber-100' },
  CONFIRMED:  { label: 'Confirmed',  icon: Shield,       color: 'text-blue-600',  bg: 'bg-blue-100' },
  PROCESSING: { label: 'Processing', icon: Package,      color: 'text-indigo-600',bg: 'bg-indigo-100' },
  READY:      { label: 'Ready',      icon: MapPin,       color: 'text-emerald-600',bg: 'bg-emerald-100' },
  DELIVERED:  { label: 'Delivered',  icon: CheckCircle,  color: 'text-green-600', bg: 'bg-green-100' },
  CANCELLED:  { label: 'Cancelled',  icon: X,            color: 'text-rose-600',  bg: 'bg-rose-100' },
}

const NEXT_STATUS: Record<string, { status: string; label: string }[]> = {
  PENDING:    [{ status: 'CONFIRMED', label: '✅ Confirm Order' }, { status: 'CANCELLED', label: '❌ Cancel' }],
  CONFIRMED:  [{ status: 'PROCESSING', label: '📦 Start Processing' }, { status: 'CANCELLED', label: '❌ Cancel' }],
  PROCESSING: [{ status: 'READY', label: '📍 Mark Ready' }, { status: 'CANCELLED', label: '❌ Cancel' }],
  READY:      [{ status: 'DELIVERED', label: '✅ Mark Delivered' }],
}

export default function OrdersPage() {
  const user = useAuthStore(s => s.user)
  const baseCurrency = user?.tenant?.baseCurrency || 'NGN'
  const fmt = useCallback((v: number, c?: string) => {
    try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency: c || baseCurrency }).format(v) }
    catch { return `${c || baseCurrency} ${v.toLocaleString()}` }
  }, [baseCurrency])

  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const limit = 20

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page)); params.set('limit', String(limit))
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const { data } = await api.get(`/orders?${params}`)
      setOrders(data.data || [])
      setTotal(data.total || 0)
    } catch { toast.error('Failed to load orders') }
    finally { setLoading(false) }
  }, [page, search, statusFilter])

  useEffect(() => { loadOrders() }, [loadOrders])

  const updateStatus = async (orderId: string, newStatus: string) => {
    setUpdating(orderId)
    try {
      await api.patch(`/orders/${orderId}`, { status: newStatus })
      toast.success(`Order ${newStatus.toLowerCase()}`)
      loadOrders()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to update order')
    } finally { setUpdating(null) }
  }

  const statusCounts = orders.reduce((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="p-6 space-y-6 bg-gradient-to-b from-white to-gray-50 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Online Orders</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage orders, validate payments, and update fulfillment status</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const count = statusCounts[key] || 0
          if (key === 'CANCELLED') return null
          return (
            <button key={key} onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
              className={`${cfg.bg} rounded-xl p-3 text-left transition-all hover:shadow-md ${statusFilter === key ? 'ring-2 ring-indigo-500 shadow-lg' : ''}`}>
              <cfg.icon className={`w-4 h-4 ${cfg.color} mb-1`} />
              <p className="text-xs font-bold text-gray-700">{cfg.label}</p>
              <p className="text-xl font-extrabold text-gray-900">{count}</p>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Search by name, email, receipt, tracking code..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        </div>
        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition-colors">
            <Filter className="w-3.5 h-3.5" /> {STATUS_CONFIG[statusFilter]?.label || statusFilter} <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Orders list */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No online orders found</p>
          <p className="text-xs text-gray-400 mt-1">Orders placed through your storefront will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => {
            const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.PENDING
            const nextActions = NEXT_STATUS[order.status] || []
            const isExpanded = expanded === order.id

            return (
              <div key={order.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                {/* Row header */}
                <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : order.id)}>
                  <div className={`w-10 h-10 rounded-xl ${sc.bg} flex items-center justify-center flex-shrink-0`}>
                    <sc.icon className={`w-5 h-5 ${sc.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-900">{order.customerName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${sc.bg} ${sc.color}`}>{sc.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                      {order.customerPhone && <span><Phone className="w-3 h-3 inline mr-1" />{order.customerPhone}</span>}
                      {order.customerEmail && <span><Mail className="w-3 h-3 inline mr-1" />{order.customerEmail}</span>}
                      <span>·</span>
                      <span><Clock className="w-3 h-3 inline mr-1" />{new Date(order.createdAt).toLocaleString()}</span>
                      {order.subsidiary && <><span>·</span><span>{order.subsidiary.name}</span></>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-extrabold text-gray-900">{fmt(Number(order.totalAmount), order.currency)}</p>
                    <p className="text-[10px] text-gray-400">{order.items?.length || 0} item{(order.items?.length || 0) !== 1 ? 's' : ''}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-gray-50 pt-4 space-y-4">
                    {/* Items */}
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Order Items</p>
                      <div className="space-y-2">
                        {order.items?.map(item => (
                          <div key={item.id} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                            {item.product?.imageUrl && (
                              <img src={item.product.imageUrl} alt="" className="w-10 h-10 rounded-md object-contain bg-white border border-gray-200" />
                            )}
                            <div className="flex-1">
                              <p className="text-sm font-medium text-gray-800">{item.product?.name}</p>
                              <p className="text-xs text-gray-500">
                                {item.quantity} × {fmt(Number(item.unitPrice), order.currency)} {item.product?.sellingUnit || item.product?.unit || ''}
                              </p>
                            </div>
                            <span className="font-semibold text-gray-900">{fmt(Number(item.subtotal), order.currency)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between pt-2 mt-2 border-t border-gray-100 font-bold">
                        <span>Total</span>
                        <span className="text-indigo-700">{fmt(Number(order.totalAmount), order.currency)}</span>
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="bg-gray-50 rounded-xl p-3 text-sm">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Customer Details</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div><span className="text-gray-500">Name:</span> <span className="font-medium">{order.customerName}</span></div>
                        {order.customerPhone && <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{order.customerPhone}</span></div>}
                        {order.customerEmail && <div><span className="text-gray-500">Email:</span> <span className="font-medium">{order.customerEmail}</span></div>}
                        {order.subsidiary && <div><span className="text-gray-500">Branch:</span> <span className="font-medium">{order.subsidiary.name}</span></div>}
                      </div>
                      {order.notes && <p className="text-xs text-gray-500 mt-2 italic">📝 {order.notes}</p>}
                    </div>

                    {/* Actions */}
                    {nextActions.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                        {nextActions.map(action => (
                          <button
                            key={action.status}
                            onClick={() => updateStatus(order.id, action.status)}
                            disabled={updating === order.id}
                            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                          >
                            {updating === order.id && <Loader2 className="w-3 h-3 animate-spin" />}
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Pagination page={page} limit={limit} total={total} onPageChange={setPage} />
    </div>
  )
}
