import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, Package, Truck, CheckCircle, Clock, MapPin, AlertCircle, ArrowLeft, ShoppingBag, Zap, ChevronRight, Shield, Mail, Phone } from 'lucide-react'
import { publicPost } from '@/lib/publicApi'

interface TrackingInfo {
  id: string; receiptNumber: string; trackingCode: string; trackingStatus: string
  totalAmount: number; currency: string; paymentMethod: string
  createdAt: string; updatedAt: string; validatedAt: string | null; validationNote: string | null
  shippingAddress: any
  trackingHistory?: Array<{ status: string; changedBy: string; changedAt: string; note: string }>
  items: Array<{ product: { name: string; unit: string; imageUrl: string | null }; quantity: number }>
}

const STATUS_STEPS = [
  { key: 'PENDING', label: 'Order Placed', desc: 'Your order has been received', icon: Clock, color: 'text-indigo-500', bg: 'bg-indigo-50', dot: 'bg-indigo-500' },
  { key: 'PAYMENT_VALIDATED', label: 'Payment Confirmed', desc: 'Payment has been verified', icon: Shield, color: 'text-blue-500', bg: 'bg-blue-50', dot: 'bg-blue-500' },
  { key: 'GOODS_PACKED', label: 'Goods Packed', desc: 'Items packed and ready', icon: Package, color: 'text-violet-500', bg: 'bg-violet-50', dot: 'bg-violet-500' },
  { key: 'OUT_FOR_DELIVERY', label: 'On the Way', desc: 'Your order is being delivered', icon: Truck, color: 'text-amber-500', bg: 'bg-amber-50', dot: 'bg-amber-500' },
  { key: 'READY_FOR_PICKUP', label: 'Ready for Pickup', desc: 'Come collect your order', icon: MapPin, color: 'text-emerald-500', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
  { key: 'DELIVERED', label: 'Delivered', desc: 'Order completed successfully', icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', dot: 'bg-green-500' },
]

export default function TrackOrderPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<TrackingInfo | null>(null)

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault(); if (!email || !code) return
    setLoading(true); setError(null); setOrder(null)
    try {
      const res = await publicPost<any>('/api/storefront/orders/track', { email: email.trim(), code: code.trim().toUpperCase() })
      if (res.data) setOrder(res.data); else setError('Order not found. Please check your email and tracking code.')
    } catch { setError('Could not track order. Please try again.') }
    finally { setLoading(false) }
  }

  const isPickup = order && !order.shippingAddress
  const currentStepIdx = order ? STATUS_STEPS.findIndex(s => s.key === order.trackingStatus) : -1
  const visibleSteps = STATUS_STEPS.filter(s => {
    if (s.key === 'OUT_FOR_DELIVERY' && isPickup) return false
    if (s.key === 'READY_FOR_PICKUP' && !isPickup) return false
    return true
  })

  const formatCurrency = (amount: number, currency: string) => {
    try { return new Intl.NumberFormat('en-NG', { style: 'currency', currency }).format(amount) }
    catch { return `${currency} ${amount.toLocaleString()}` }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-gray-50 to-white font-sans antialiased">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40 backdrop-blur-xl bg-white/90">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-indigo-600 font-medium text-sm transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-200">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-extrabold text-gray-900">Track Order</span>
          </div>
          <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors">← Store</Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950 py-16 md:py-20">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/20 via-transparent to-transparent" />
        <div className="max-w-3xl mx-auto px-4 text-center relative">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center mx-auto mb-6 border border-white/10">
            <Search className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-3 tracking-tight">Track Your Order</h1>
          <p className="text-indigo-200/80 text-lg max-w-lg mx-auto">Enter your email and tracking code to see real-time updates on your order status.</p>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </section>

      <main className="max-w-2xl mx-auto px-4 -mt-8 relative z-10">
        {/* Search Form */}
        <div className="bg-white rounded-2xl shadow-2xl shadow-gray-200/50 border border-gray-100 p-6 md:p-8 mb-8">
          <form onSubmit={handleTrack} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  <Mail className="w-3 h-3 inline mr-1" /> Email Address
                </label>
                <input
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-sm font-medium placeholder:text-gray-400"
                  type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  <Search className="w-3 h-3 inline mr-1" /> Tracking Code
                </label>
                <input
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-100 bg-gray-50 focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-sm font-mono font-bold uppercase tracking-wider placeholder:text-gray-400"
                  value={code} onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="SP-XXXX-XXXX" maxLength={12} required
                />
              </div>
              <div className="sm:col-span-1 flex items-end">
                <button type="submit" disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-bold text-sm hover:from-indigo-700 hover:to-violet-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Search className="w-4 h-4" />}
                  {loading ? '' : 'Track'}
                </button>
              </div>
            </div>
            {error && (
              <div className="flex items-start gap-3 p-4 bg-rose-50 rounded-xl border border-rose-100">
                <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-rose-700 font-medium">{error}</p>
              </div>
            )}
          </form>
        </div>

        {/* Results */}
        {order && (
          <div className="space-y-6 animate-fadeIn">
            {/* Order Header */}
            <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/30 border border-gray-100 p-6 md:p-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Order</p>
                  <h2 className="text-2xl font-black text-gray-900 mt-0.5">#{order.receiptNumber}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Tracking: <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">{order.trackingCode}</span></p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-4 py-2 rounded-full text-xs font-bold capitalize ${order.paymentMethod === 'ONLINE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : order.paymentMethod === 'CASH' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                    {order.paymentMethod === 'ONLINE' ? '💳 Online' : order.paymentMethod === 'CASH' ? '💵 Cash' : `🏦 ${order.paymentMethod?.toLowerCase()}`}
                  </span>
                  <span className="px-4 py-2 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {isPickup ? '🏪 Pickup' : '🚚 Delivery'}
                  </span>
                </div>
              </div>

              {/* Timeline */}
              <div className="relative pl-2">
                {visibleSteps.map((step, idx) => {
                  const isCompleted = idx < currentStepIdx || order.trackingStatus === 'DELIVERED'
                  const isCurrent = idx === currentStepIdx
                  const isFuture = idx > currentStepIdx && order.trackingStatus !== 'DELIVERED'
                  return (
                    <div key={step.key} className="flex gap-4">
                      <div className="flex flex-col items-center">
                        <div className={`relative z-10 w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-500 ${isCompleted || isCurrent ? `${step.bg} shadow-md` : 'bg-gray-50'}`}>
                          <step.icon className={`w-5 h-5 ${isCompleted || isCurrent ? step.color : 'text-gray-300'}`} />
                          {isCurrent && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-indigo-500 animate-pulse border-2 border-white" />}
                        </div>
                        {idx < visibleSteps.length - 1 && (
                          <div className={`w-0.5 flex-1 min-h-[32px] mt-1 mb-1 transition-colors duration-500 ${isCompleted ? 'bg-gradient-to-b from-indigo-400 to-indigo-200' : 'bg-gray-100'}`} />
                        )}
                      </div>
                      <div className={`pb-6 pt-1.5 flex-1 ${isFuture ? 'opacity-40' : ''}`}>
                        <p className={`text-sm font-bold ${isCompleted || isCurrent ? 'text-gray-900' : 'text-gray-400'}`}>{step.label}</p>
                        <p className={`text-xs mt-0.5 ${isCurrent ? 'text-indigo-600 font-medium' : 'text-gray-400'}`}>
                          {isCurrent ? 'Current status' : isCompleted ? 'Completed' : step.desc}
                        </p>
                        {isCurrent && (
                          <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 rounded-full text-xs font-bold text-indigo-700 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> In Progress
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Validation info */}
              {order.validatedAt && (
                <div className="mt-6 flex items-start gap-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-100">
                  <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-blue-800">Payment Validated</p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      {new Date(order.validatedAt).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                      {order.validationNote && <> · <span className="italic">{order.validationNote}</span></>}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Order Details */}
            <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/30 border border-gray-100 p-6 md:p-8">
              <h3 className="text-lg font-extrabold text-gray-900 mb-4">Order Details</h3>
              <div className="divide-y divide-gray-50">
                {order.items?.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-100 to-violet-100 flex items-center justify-center flex-shrink-0">
                      <Package className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{item.product?.name}</p>
                      <p className="text-xs text-gray-400">{item.quantity} × {item.product?.unit}</p>
                    </div>
                    <span className="text-sm font-bold text-gray-900">{item.quantity}x</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center pt-4 mt-4 border-t border-gray-100">
                <span className="text-sm font-bold text-gray-500">Total Amount</span>
                <span className="text-xl font-extrabold text-gray-900">{formatCurrency(order.totalAmount, order.currency)}</span>
              </div>

              {/* Tracking History */}
              {order.trackingHistory && order.trackingHistory.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Activity Log</p>
                  <div className="space-y-2">
                    {order.trackingHistory.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                        <span className="font-semibold text-gray-700">
                          {STATUS_STEPS.find(s => s.key === entry.status)?.label || entry.status}
                        </span>
                        {entry.note && <span className="text-gray-400 italic">— "{entry.note}"</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Shipping Details */}
            <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/30 border border-gray-100 p-6 md:p-8">
              <h3 className="text-lg font-extrabold text-gray-900 mb-4 flex items-center gap-2">
                {isPickup ? <><MapPin className="w-5 h-5 text-emerald-500" /> Pickup Information</> : <><Truck className="w-5 h-5 text-indigo-500" /> Delivery Information</>}
              </h3>
              {isPickup ? (
                <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                  <p className="text-sm font-bold text-emerald-800">📍 Pickup at Store</p>
                  <p className="text-xs text-emerald-600 mt-1">Please visit our store to collect your order. Bring your tracking code <span className="font-mono font-bold">{order.trackingCode}</span> for verification.</p>
                </div>
              ) : order.shippingAddress ? (
                <div className="p-4 bg-gray-50 rounded-xl text-sm space-y-1">
                  <p className="font-bold text-gray-900">{(order.shippingAddress as any)?.name}</p>
                  <p className="text-gray-600">{(order.shippingAddress as any)?.line1}</p>
                  {(order.shippingAddress as any)?.line2 && <p className="text-gray-600">{(order.shippingAddress as any).line2}</p>}
                  <p className="text-gray-600">{(order.shippingAddress as any)?.city}, {(order.shippingAddress as any)?.state} {(order.shippingAddress as any)?.zip}</p>
                  <p className="text-gray-600">{(order.shippingAddress as any)?.country}</p>
                  {(order.shippingAddress as any)?.phone && <p className="text-gray-600">📞 {(order.shippingAddress as any).phone}</p>}
                </div>
              ) : null}
            </div>

            <p className="text-center text-xs text-gray-400 pb-8">
              Order placed on {new Date(order.createdAt).toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        )}

        {/* Empty state (no search yet) */}
        {!order && !error && !loading && (
          <div className="text-center py-12">
            <div className="w-20 h-20 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-10 h-10 text-gray-300" />
            </div>
            <p className="text-sm text-gray-400 font-medium">Enter your email and tracking code above to view your order status</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5" /> Secure tracking</span>
            <span className="hidden sm:inline">·</span>
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Real-time updates</span>
          </div>
          <p>Need help? <span className="text-indigo-600 font-semibold cursor-pointer hover:underline">Contact Support</span></p>
        </div>
      </footer>
    </div>
  )
}
