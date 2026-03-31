import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Barcode, Trash2, Minus, Plus, ShoppingCart, Printer } from 'lucide-react'
import { useCartStore } from '@/store/cart.store'
import type { Product } from '@/types'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { getProductByBarcode, searchCachedProducts } from '@/lib/db'
import Receipt from '@/components/sales/Receipt'

export default function SalesPage() {
  const cart = useCartStore()
  const [products, setProducts] = useState<Product[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'POS'>('CASH')
  const [discount, setDiscount] = useState(0)
  const [amountPaid, setAmountPaid] = useState(0)
  const [loading, setLoading] = useState(false)
  const [completedSale, setCompletedSale] = useState<{ id: string; receiptNumber: string } | null>(null)
  const barcodeBuffer = useRef('')
  const barcodeTimer = useRef<ReturnType<typeof setTimeout>>()

  const loadProducts = useCallback(async (q: string) => {
    if (!q) { setProducts([]); return }
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
            toast.success(`Added: ${product.name}`)
          } else {
            toast.error(`Product not found: ${barcode}`)
          }
        } catch { toast.error('Barcode lookup failed') }
      } else if (e.key.length === 1) {
        barcodeBuffer.current += e.key
        clearTimeout(barcodeTimer.current)
        barcodeTimer.current = setTimeout(() => { barcodeBuffer.current = '' }, 200)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [cart])

  const total = cart.items.reduce((s, i) => s + i.quantity * i.unitPrice - i.discount, 0) - discount
  const change = amountPaid - total

  const handleCheckout = async () => {
    if (cart.items.length === 0) { toast.error('Cart is empty'); return }
    if (amountPaid < total) { toast.error('Amount paid is less than total'); return }

    setLoading(true)
    try {
      const subsidiaryId = cart.subsidiaryId || ''
      if (!subsidiaryId) { toast.error('Select a subsidiary first'); setLoading(false); return }

      const payload = {
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

  if (completedSale) {
    return (
      <Receipt
        saleId={completedSale.id}
        onNewSale={() => setCompletedSale(null)}
      />
    )
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-9rem)]">
      {/* Products panel */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Point of Sale</h1>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Barcode className="w-4 h-4" />
            Barcode scanner ready
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
        </div>

        {/* Product results */}
        {products.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto pb-2">
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

        {searchQuery && products.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Search className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No products found</p>
            </div>
          </div>
        )}

        {!searchQuery && (
          <div className="flex-1 flex items-center justify-center text-gray-300">
            <div className="text-center">
              <Search className="w-12 h-12 mx-auto mb-2" />
              <p className="text-sm">Search or scan to add products</p>
            </div>
          </div>
        )}
      </div>

      {/* Cart panel */}
      <div className="w-80 flex flex-col bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary-600" />
              <span className="font-semibold text-gray-900">Cart</span>
            </div>
            {cart.items.length > 0 && (
              <button onClick={cart.clearCart} className="text-xs text-danger-500 hover:text-danger-600">Clear</button>
            )}
          </div>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
            placeholder="Amount paid"
            value={amountPaid || ''}
            onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)}
          />
          {amountPaid > 0 && amountPaid >= total && (
            <div className="text-sm text-success-600 font-medium">
              Change: ${change.toFixed(2)}
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
  )
}
