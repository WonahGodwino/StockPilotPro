import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Barcode, Trash2, Minus, Plus, ShoppingCart, WifiOff, History, ShoppingBag } from 'lucide-react'
import { useCartStore } from '@/store/cart.store'
import type { Product, Sale, SaleCheckoutPayload } from '@/types'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { getProductByBarcode, searchCachedProducts, addPendingSale } from '@/lib/db'
import { useAuthStore } from '@/store/auth.store'
import Receipt from '@/components/sales/Receipt'
import Pagination from '@/components/Pagination'

let _audioCtx: AudioContext | null = null
function getAudioContext(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new AudioContext()
    }
    return _audioCtx
  } catch { return null }
}

function playBeep(success: boolean) {
  const ctx = getAudioContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = success ? 1800 : 400
    osc.type = 'sine'
    const duration = success ? 0.12 : 0.25
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch { /* ignore */ }
}

const MIN_SEARCH_LENGTH = 2


export default function SalesPage() {
  const cart = useCartStore()
  const setSubsidiaryId = useCartStore((s) => s.setSubsidiaryId)
  const cartSubsidiaryId = useCartStore((s) => s.subsidiaryId)
  const user = useAuthStore((s) => s.user)
  const [tab, setTab] = useState<'pos' | 'history'>('pos')
  const [products, setProducts] = useState<Product[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'POS'>('CASH')
  const [discount, setDiscount] = useState(0)
  const [amountPaid, setAmountPaid] = useState(0)
  const [loading, setLoading] = useState(false)
  const [completedSale, setCompletedSale] = useState<{ id: string; receiptNumber: string; offline?: boolean } | null>(null)
  const [scanState, setScanState] = useState<'idle' | 'success' | 'error'>('idle')
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<ReturnType<typeof setTimeout>>()
  const scanResetTimer = useRef<ReturnType<typeof setTimeout>>()

  // Sales history state
  const HISTORY_LIMIT = 20
  const [sales, setSales] = useState<Sale[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyTotal, setHistoryTotal] = useState(0)

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(historyPage))
      params.set('limit', String(HISTORY_LIMIT))
      const { data } = await api.get(`/sales?${params}`)
      setSales(data.data)
      setHistoryTotal(data.total)
    } catch { toast.error('Failed to load sales history') }
    finally { setHistoryLoading(false) }
  }, [historyPage])

  useEffect(() => {
    if (tab === 'history') loadHistory()
  }, [tab, historyPage, loadHistory])

  // Auto-set subsidiaryId from the authenticated user if not already set
  useEffect(() => {
    if (!cartSubsidiaryId && user?.subsidiaryId) {
      setSubsidiaryId(user.subsidiaryId)
    }
  }, [user, cartSubsidiaryId, setSubsidiaryId])

  const loadProducts = useCallback(async (q: string) => {
    if (q.length < MIN_SEARCH_LENGTH) { setProducts([]); return }
    try {
      // Try online first, fallback to offline cache
      if (navigator.onLine) {
        const { data } = await api.get(`/products?search=${encodeURIComponent(q)}&status=ACTIVE&limit=10`)
        setProducts(data.data)
      } else {
        const cached = await searchCachedProducts(q)
        setProducts(cached)
      }
    } catch { setProducts([]) }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => loadProducts(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery, loadProducts])

  // Global barcode scanner listener
  useEffect(() => {
    const handleKey = async (e: KeyboardEvent) => {
      if (e.key === 'Enter' && barcodeBuffer.current.length > 3) {
        const barcode = barcodeBuffer.current
        barcodeBuffer.current = ''
        clearTimeout(barcodeTimer.current)
        const flash = (state: 'success' | 'error') => {
          setScanState(state)
          clearTimeout(scanResetTimer.current)
          scanResetTimer.current = setTimeout(() => setScanState('idle'), 800)
        }
        try {
          let product: Product | undefined
          if (navigator.onLine) {
            const { data } = await api.get(`/products?barcode=${encodeURIComponent(barcode)}&status=ACTIVE`)
            product = data.data[0]
          } else {
            product = await getProductByBarcode(barcode)
          }
          if (product) {
            cart.addItem(product)
            playBeep(true)
            flash('success')
            toast.success(`Added: ${product.name}`)
          } else {
            playBeep(false)
            flash('error')
            toast.error(`Product not found: ${barcode}`)
          }
        } catch {
          playBeep(false)
          flash('error')
          toast.error('Barcode lookup failed')
        }
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key
        clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = '' }, 200)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      clearTimeout(scanResetTimer.current)
    }
  }, [cart])

  const total = cart.items.reduce((s, i) => s + i.quantity * i.unitPrice - i.discount, 0) - discount
  const change = amountPaid - total

  const handleCheckout = async () => {
    if (cart.items.length === 0) { toast.error('Cart is empty'); return }
    if (amountPaid < total) { toast.error('Amount tendered is less than total'); return }

    setLoading(true)
    try {
      const subsidiaryId = cartSubsidiaryId || user?.subsidiaryId || ''
      if (!subsidiaryId) { toast.error('Select a subsidiary first'); setLoading(false); return }

      const payload: SaleCheckoutPayload = {
        subsidiaryId,
        paymentMethod,
        discount,
        amountPaid,
        items: cart.items.map((i) => ({
          productId: i.product.id,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          costPrice: Number(i.product.costPrice),
          discount: i.discount,
        })),
      }

      if (!navigator.onLine) {
        // Store sale in IndexedDB pendingRecords for later sync
        const localId = await addPendingSale(payload)
        cart.clearCart()
        setDiscount(0)
        setAmountPaid(0)
        setCompletedSale({ id: localId, receiptNumber: `OFFLINE-${Date.now()}`, offline: true })
        toast.success('Sale saved offline — will sync when back online')
        return
      }

      const { data } = await api.post('/sales', payload)
      setCompletedSale({ id: data.data.id, receiptNumber: data.data.receiptNumber })
      cart.clearCart()
      setDiscount(0)
      setAmountPaid(0)
      toast.success('Sale completed!')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Checkout failed'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('pos')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'pos' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          Point of Sale
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === 'history' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <History className="w-4 h-4" />
          Sales History
        </button>
      </div>

      {tab === 'history' ? (
        /* ── Sales History ── */
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Receipt #</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Payment</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {historyLoading ? (
                  <tr><td colSpan={5} className="text-center py-10 text-gray-400">Loading...</td></tr>
                ) : sales.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12">
                      <ShoppingCart className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm">No sales recorded yet</p>
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{s.receiptNumber}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(s.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {s.user ? `${s.user.firstName} ${s.user.lastName}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge bg-gray-100 text-gray-600">{s.paymentMethod}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        ${Number(s.totalAmount).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={historyPage} limit={HISTORY_LIMIT} total={historyTotal} onPageChange={setHistoryPage} />
        </div>
      ) : (
      /* ── Point of Sale ── */
      <>
      <div className="flex flex-col md:flex-row gap-6 md:h-[calc(100vh-12rem)]">
        {/* Products panel */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-900">Point of Sale</h1>
            <div className={`flex items-center gap-2 text-xs transition-colors duration-200 ${
              scanState === 'success' ? 'text-success-600' :
              scanState === 'error' ? 'text-danger-500' :
              'text-gray-400'
            }`}>
              <Barcode className={scanState !== 'idle' ? 'w-4 h-4 animate-pulse' : 'w-4 h-4'} />
              {scanState === 'success' ? 'Item added!' : scanState === 'error' ? 'Not found' : 'Barcode scanner ready'}
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search products by name or scan barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery.length === 1 && (
              <p className="absolute -bottom-5 left-1 text-xs text-gray-400">Type at least {MIN_SEARCH_LENGTH} characters to search</p>
            )}
          </div>

          {/* Product results */}
          {products.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:overflow-y-auto pb-2 mt-2">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { cart.addItem(p); setSearchQuery('') }}
                  className="card p-4 text-left hover:border-primary-300 hover:shadow-sm transition-all active:scale-95"
                >
                  <p className="font-medium text-sm text-gray-900 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{p.type} · {p.unit}</p>
                  <p className="text-primary-600 font-semibold mt-2">${Number(p.sellingPrice).toFixed(2)}</p>
                  {p.type === 'GOODS' && (
                    <p className={`text-xs mt-1 ${p.quantity <= p.lowStockThreshold ? 'text-danger-500' : 'text-gray-400'}`}>
                      Stock: {p.quantity}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}

          {searchQuery.length >= MIN_SEARCH_LENGTH && products.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-gray-400 mt-2">
              <div className="text-center">
                <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>No products found</p>
              </div>
            </div>
          )}

          {!searchQuery && (
            <div className="flex-1 flex items-center justify-center text-gray-300 mt-2">
              <div className="text-center">
                <Search className="w-12 h-12 mx-auto mb-2" />
                <p className="text-sm">Search or scan to add products</p>
              </div>
            </div>
          )}
        </div>
        {/* end products panel */}

        {/* Cart panel */}
        <div className="w-full md:w-80 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary-600" />
                <span className="font-semibold text-gray-900">Cart</span>
                {cart.items.length > 0 && (
                  <span className="text-xs bg-primary-100 text-primary-700 rounded-full px-1.5 py-0.5">
                    {cart.items.reduce((s, i) => s + i.quantity, 0)}
                  </span>
                )}
              </div>
              {cart.items.length > 0 && (
                <button onClick={cart.clearCart} className="text-xs text-danger-500 hover:text-danger-600">Clear</button>
              )}
            </div>
          </div>

          {/* Cart items */}
          <div className="max-h-48 md:flex-1 overflow-y-auto p-4 space-y-3">
            {cart.items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-300">
                <ShoppingCart className="w-12 h-12 mb-2" />
                <p className="text-sm">Cart is empty</p>
              </div>
            ) : (
              cart.items.map((item) => (
                <div key={item.product.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 flex-1 truncate">{item.product.name}</p>
                    <button
                      onClick={() => cart.removeItem(item.product.id)}
                      className="text-gray-400 hover:text-danger-500 flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => cart.updateQuantity(item.product.id, item.quantity - 1)}
                        className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                      <button
                        onClick={() => cart.updateQuantity(item.product.id, item.quantity + 1)}
                        className="w-6 h-6 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-100"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      ${(item.quantity * item.unitPrice - item.discount).toFixed(2)}
                    </span>
                  </div>
                  {/* Per-item discount */}
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="text-xs text-gray-400 w-14">Discount</span>
                    <input
                      className="input text-xs py-0.5 flex-1"
                      type="number" min="0" step="0.01"
                      placeholder="0.00"
                      value={item.discount || ''}
                      onChange={(e) => cart.updateDiscount(item.product.id, parseFloat(e.target.value) || 0)}
                    />
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Totals & Checkout */}
          <div className="p-4 border-t border-gray-100 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span>${cart.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0).toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 w-20">Discount</span>
              <input
                className="input text-sm py-1 flex-1"
                type="number" min="0" step="0.01"
                value={discount}
                onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="flex items-center justify-between text-base font-bold border-t pt-2">
              <span>Total</span>
              <span className="text-primary-600">${Math.max(0, total).toFixed(2)}</span>
            </div>
            <select
              className="input text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'TRANSFER' | 'POS')}
            >
              <option value="CASH">Cash</option>
              <option value="TRANSFER">Transfer</option>
              <option value="POS">POS</option>
            </select>
            <input
              className="input text-sm"
              type="number" min="0" step="0.01"
              placeholder="Amount Tendered"
              value={amountPaid || ''}
              onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)}
            />
            {amountPaid > 0 && amountPaid >= total && (
              <div className="flex items-center justify-between text-sm font-medium text-success-600 bg-success-50 rounded-lg px-3 py-2">
                <span>Change</span>
                <span>${change.toFixed(2)}</span>
              </div>
            )}
            {amountPaid > 0 && amountPaid < total && (
              <div className="flex items-center justify-between text-sm font-medium text-danger-600 bg-danger-50 rounded-lg px-3 py-2">
                <span>Short by</span>
                <span>${(total - amountPaid).toFixed(2)}</span>
              </div>
            )}
            <button
              onClick={handleCheckout}
              disabled={loading || cart.items.length === 0}
              className="btn-primary w-full py-2.5"
            >
              {loading ? 'Processing...' : 'Checkout'}
            </button>
          </div>
        </div>
      </div>

      {/* Receipt modal overlay */}
      {completedSale && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md my-8">
            {completedSale.offline ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-warning-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <WifiOff className="w-8 h-8 text-warning-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900 mb-2">Sale Saved Offline</h2>
                <p className="text-sm text-gray-500 mb-1">Receipt: {completedSale.receiptNumber}</p>
                <p className="text-sm text-gray-500 mb-6">
                  This sale has been stored locally and will be synced automatically when your connection is restored.
                </p>
                <button onClick={() => setCompletedSale(null)} className="btn-primary w-full">
                  New Sale
                </button>
              </div>
            ) : (
              <Receipt saleId={completedSale.id} onNewSale={() => setCompletedSale(null)} />
            )}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  )
}
