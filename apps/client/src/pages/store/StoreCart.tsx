import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Trash2, Minus, Plus, ArrowLeft, ArrowRight, ShoppingCart, Shield, Truck, Zap, Package } from 'lucide-react'
import { publicGet } from '@/lib/publicApi'
import type { Product } from '@/types'
import { getCurrencySymbol } from '@/lib/currency'

interface CartItem { product: Product; quantity: number }

const CARD_COLORS = ['#7c3aed','#f43f5e','#f59e0b','#10b981','#0ea5e9','#d946ef']

export default function StoreCartPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [cart, setCart] = useState<CartItem[]>([])
  const [storeInfo, setStoreInfo] = useState<{ name: string; baseCurrency: string } | null>(null)

  useEffect(() => {
    try { const s = sessionStorage.getItem(`storefront-cart-${slug}`); if (s) setCart(JSON.parse(s) || []) } catch {}
    publicGet<any>(`/api/storefront/info?slug=${slug}`).then(r => { const d = r.data || r; if (d) setStoreInfo({ name: d.name, baseCurrency: d.baseCurrency }) }).catch(() => {})
  }, [slug])

  const saveAndSet = (items: CartItem[]) => { sessionStorage.setItem(`storefront-cart-${slug}`, JSON.stringify(items)); setCart(items) }
  const updateQty = (pid: string, q: number) => { if (q <= 0) saveAndSet(cart.filter(i => i.product.id !== pid)); else saveAndSet(cart.map(i => i.product.id === pid ? { ...i, quantity: q } : i)) }

  const currencySymbol = storeInfo ? getCurrencySymbol(storeInfo.baseCurrency) : '$'
  const subtotal = cart.reduce((s, i) => s + i.quantity * Number(i.product.sellingPrice), 0)
  const shipping = subtotal > 50000 ? 0 : 2500
  const total = subtotal + shipping
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0)

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      {/* Announcement */}
      <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 text-white text-xs font-semibold py-2.5 px-4 text-center">Free shipping on orders over {currencySymbol}50,000 ✨</div>

      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => navigate(`/store/${slug}`)} className="flex items-center gap-2 text-gray-600 hover:text-indigo-600 font-semibold text-sm transition-colors group"><ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Continue Shopping</button>
          <div className="flex items-center gap-2.5"><div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-200"><Zap className="w-4 h-4 text-white" /></div><span className="font-extrabold text-gray-900">{storeInfo?.name || 'Cart'}</span></div>
          <div className="w-24" />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-10">
        {cart.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <div className="w-24 h-24 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-6"><ShoppingCart className="w-10 h-10 text-gray-300" /></div>
            <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Your cart is empty</h2>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto">Looks like you haven't added anything yet. Discover our amazing products!</p>
            <button onClick={() => navigate(`/store/${slug}`)} className="px-8 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl font-bold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-xl shadow-indigo-200">Start Shopping</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-3xl font-black text-gray-900">Shopping Cart</h1>
                <span className="text-sm font-semibold text-gray-500">{itemCount} item{itemCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {cart.map((item, idx) => (
                  <div key={item.product.id} className="p-5 border-b border-gray-50 last:border-0 flex gap-4 items-center hover:bg-gray-50/50 transition-colors">
                    <div className="w-20 h-20 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-lg" style={{ background: `linear-gradient(135deg, ${CARD_COLORS[idx % CARD_COLORS.length]}, ${CARD_COLORS[(idx+1) % CARD_COLORS.length]})` }}><Package className="w-8 h-8 text-white/60" /></div>
                    <div className="flex-1 min-w-0"><h3 className="font-bold text-gray-900">{item.product.name}</h3><p className="text-xs text-gray-400 mt-0.5">{item.product.category}</p><p className="text-sm font-semibold text-indigo-600 mt-1">{currencySymbol}{Number(item.product.sellingPrice).toLocaleString()}</p></div>
                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-1">
                      <button onClick={() => updateQty(item.product.id, item.quantity - 1)} className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:border-gray-400 transition-colors shadow-sm"><Minus className="w-3 h-3" /></button>
                      <span className="text-sm font-bold w-8 text-center tabular-nums">{item.quantity}</span>
                      <button onClick={() => updateQty(item.product.id, item.quantity + 1)} className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center hover:border-gray-400 transition-colors shadow-sm"><Plus className="w-3 h-3" /></button>
                    </div>
                    <p className="text-sm font-extrabold text-gray-900 w-28 text-right tabular-nums">{currencySymbol}{(item.quantity * Number(item.product.sellingPrice)).toLocaleString()}</p>
                    <button onClick={() => updateQty(item.product.id, 0)} className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sticky top-24">
                <h2 className="text-xl font-extrabold text-gray-900 mb-5">Order Summary</h2>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span className="font-bold text-gray-900">{currencySymbol}{subtotal.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className="font-bold">{shipping === 0 ? <span className="text-emerald-600">FREE</span> : `${currencySymbol}${shipping.toLocaleString()}`}</span></div>
                  <div className="flex justify-between pt-4 border-t border-gray-100 font-extrabold text-lg"><span>Total</span><span>{currencySymbol}{total.toLocaleString()}</span></div>
                </div>
                {subtotal > 0 && subtotal < 50000 && (
                  <div className="mt-4 p-3 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl border border-amber-100 flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <p className="text-xs text-amber-800 font-medium">Add {currencySymbol}{(50000 - subtotal).toLocaleString()} more for <span className="font-extrabold">FREE</span> shipping!</p>
                  </div>
                )}
                <button onClick={() => navigate(`/store/${slug}/checkout`)} className="w-full mt-5 py-4 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl font-bold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2">Proceed to Checkout <ArrowRight className="w-4 h-4" /></button>
                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400"><Shield className="w-3.5 h-3.5" /> Secure SSL encrypted checkout</div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
