import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Search, ShoppingCart, Truck, Shield, RotateCcw, Phone, Mail, MapPin, X, Minus, Plus, Sparkles, Clock, ArrowRight, Star, Zap, Gift, Package } from 'lucide-react'
import { publicGet } from '@/lib/publicApi'
import type { Product } from '@/types'
import { getCurrencySymbol } from '@/lib/currency'

interface TenantStoreInfo { id: string; name: string; slug: string; logo?: string | null; baseCurrency: string }
interface CartItem { product: Product; quantity: number }

const CARD_GRADIENTS = [
  'linear-gradient(135deg, #7c3aed, #a855f7, #6366f1)',
  'linear-gradient(135deg, #f43f5e, #ec4899, #d946ef)',
  'linear-gradient(135deg, #f59e0b, #f97316, #ef4444)',
  'linear-gradient(135deg, #10b981, #14b8a6, #06b6d4)',
  'linear-gradient(135deg, #0ea5e9, #3b82f6, #6366f1)',
  'linear-gradient(135deg, #d946ef, #f43f5e, #ec4899)',
]

export default function StorePage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [store, setStore] = useState<TenantStoreInfo | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState('')
  const [cats, setCats] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [heroSlide, setHeroSlide] = useState(0)
  const limit = 12

  // Auto-rotate hero products every 5 seconds
  useEffect(() => {
    if (products.length < 5) return
    const interval = setInterval(() => {
      setHeroSlide(prev => (prev + 1) % Math.max(1, products.length - 3))
    }, 5000)
    return () => clearInterval(interval)
  }, [products.length])

  useEffect(() => { try { const s = sessionStorage.getItem(`storefront-cart-${slug}`); if (s) setCart(JSON.parse(s) || []) } catch {} }, [slug])
  const saveCart = useCallback((c: CartItem[]) => { sessionStorage.setItem(`storefront-cart-${slug}`, JSON.stringify(c)); setCart(c) }, [slug])
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0)
  const cartTotal = cart.reduce((s, i) => s + i.quantity * Number(i.product.sellingPrice), 0)
  const currencySymbol = store ? getCurrencySymbol(store.baseCurrency) : '$'

  const addToCart = (p: Product) => { const ex = cart.find(i => i.product.id === p.id); if (ex) saveCart(cart.map(i => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i)); else saveCart([...cart, { product: p, quantity: 1 }]); setCartOpen(true) }
  const updateQty = (pid: string, q: number) => { if (q <= 0) saveCart(cart.filter(i => i.product.id !== pid)); else saveCart(cart.map(i => i.product.id === pid ? { ...i, quantity: q } : i)) }

  const loadProducts = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams(); params.set('tenant', slug!); params.set('page', String(p)); params.set('limit', String(limit))
      if (search) params.set('search', search); if (activeCat) params.set('category', activeCat)
      const res = await publicGet<any>(`/api/storefront/products?${params}`)
      const list: Product[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : []
      setProducts(list); setTotal(res?.total || 0)
      setCats(Array.from(new Set(list.map(x => x.category).filter(Boolean) as string[])))
    } catch { setProducts([]) } finally { setLoading(false) }
  }, [slug, search, activeCat])

  useEffect(() => { if (!slug) return; publicGet<any>(`/api/storefront/info?slug=${slug}`).then(r => { const d = r.data || r; if (d?.name) { setStore(d); if (d.subsidiaryId) sessionStorage.setItem(`storefront-subsidiary-${slug}`, d.subsidiaryId) } }).catch(() => {}) }, [slug])
  useEffect(() => { if (slug) loadProducts(page) }, [slug, page, loadProducts])

  const heroProduct = products[heroSlide % products.length]
  const featuredProducts = products.length >= 4
    ? [...Array(4)].map((_, i) => products[(heroSlide + i + 1) % products.length])
    : products

  return (
    <div className="min-h-screen bg-white font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
      {/* ── Announcement Bar ── */}
      <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 text-white text-xs font-semibold py-2.5 px-4 text-center tracking-wide">
        <span className="flex items-center justify-center gap-2">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          Free shipping on all orders over {currencySymbol}50,000 · Easy 30-day returns
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
        </span>
      </div>

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <div onClick={() => navigate(`/store/${slug}`)} className="flex items-center gap-2.5 cursor-pointer group">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-200 group-hover:shadow-xl group-hover:shadow-indigo-300 group-hover:scale-105 transition-all duration-300">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <div className="hidden sm:block">
                  <span className="font-extrabold text-lg text-gray-900 tracking-tight">{store?.name || 'Store'}</span>
                  <span className="block text-[10px] text-gray-400 -mt-0.5 font-semibold uppercase tracking-[0.2em]">Marketplace</span>
                </div>
              </div>
              <nav className="flex items-center gap-3 lg:gap-6">
                <button onClick={() => { setActiveCat(''); setSearch(''); setPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }) }} className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors cursor-pointer">Home</button>
                <button onClick={() => document.getElementById('shop')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors cursor-pointer">Products</button>
                <button onClick={() => document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors cursor-pointer">Deals</button>
                <button onClick={() => document.querySelector('footer')?.scrollIntoView({ behavior: 'smooth' })} className="text-sm font-medium text-gray-600 hover:text-indigo-600 transition-colors cursor-pointer">About</button>
                <button onClick={() => navigate('/track')} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 transition-colors cursor-pointer flex items-center gap-1">Track Order</button>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden md:flex relative max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="w-72 lg:w-96 pl-10 pr-4 py-2.5 bg-gray-50 border-0 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all placeholder:text-gray-400" placeholder="Search products..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
              </div>
              <button onClick={() => setCartOpen(true)} className="relative p-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors group">
                <ShoppingCart className="w-5 h-5 text-gray-700 group-hover:text-indigo-600 transition-colors" />
                {cartCount > 0 && <span className="absolute -top-1 -right-1 min-w-[20px] h-5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 shadow-md shadow-indigo-200">{cartCount}</span>}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Mobile Search ── */}
      <div className="md:hidden px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="relative"><Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Search products..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></div>
      </div>

      {/* ── Category Strip ── */}
      {cats.length > 0 && (
        <div className="bg-white border-b border-gray-100 overflow-x-auto shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-2 py-2.5">
            <button onClick={() => { setActiveCat(''); setPage(1) }} className={`flex-shrink-0 px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-200 ${!activeCat ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-gray-50 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 hover:scale-105 hover:shadow-md cursor-pointer'}`}>🔥 All Deals</button>
            {cats.map(c => (
              <button key={c} onClick={() => { setActiveCat(c); setPage(1) }} className={`flex-shrink-0 px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-200 ${activeCat === c ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-gray-50 text-gray-600 hover:bg-indigo-50 hover:text-indigo-700 hover:scale-105 hover:shadow-md cursor-pointer'}`}>{c}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Hero ── */}
      {!search && !activeCat && heroProduct && (
        <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-500/20 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-violet-500/20 via-transparent to-transparent" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 lg:py-28 relative">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-8">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-semibold text-white tracking-wide">Trending Now</span>
                </div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.05] tracking-tight">
                  Discover <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-300 via-violet-200 to-fuchsia-300">Amazing</span> Products
                </h1>
                <p className="text-lg text-indigo-100/80 max-w-md leading-relaxed">Shop {total}+ premium products across {cats.length} categories. Lightning-fast delivery and unbeatable prices.</p>
                <div className="flex flex-wrap items-center gap-4">
                  <a href="#shop" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-gray-900 rounded-2xl font-bold hover:bg-gray-100 hover:scale-105 transition-all duration-300 shadow-2xl shadow-white/10">
                    Start Shopping <ArrowRight className="w-4 h-4" />
                  </a>
                  <div className="flex items-center gap-3 text-white/70">
                    <div className="flex -space-x-2">
                      {[1,2,3].map(i => <div key={i} className="w-8 h-8 rounded-full border-2 border-white/20 bg-gradient-to-br from-indigo-400 to-violet-500" />)}
                    </div>
                    <span className="text-sm"><span className="font-bold text-white">500+</span> happy customers</span>
                  </div>
                </div>
              </div>
              <div className="hidden lg:block relative">
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/30 to-violet-500/30 rounded-3xl blur-3xl" />
                <div className="relative bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-8">
                  <div className="grid grid-cols-2 gap-4 transition-all duration-700 ease-in-out" key={heroSlide}>
                    {featuredProducts.slice(0, 4).map((p, i) => (
                      <div key={p.id} className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/10 hover:border-white/20 transition-all cursor-pointer overflow-hidden" onClick={() => addToCart(p)}>
                        <div className="w-full aspect-square rounded-xl flex items-center justify-center mb-3 shadow-lg overflow-hidden relative" style={{ background: CARD_GRADIENTS[i % CARD_GRADIENTS.length] }}>
                          {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover absolute inset-0" /> : <Package className="w-12 h-12 text-white/40" />}
                        </div>
                        <p className="text-white font-semibold text-sm truncate">{p.name}</p>
                        {p.description && <p className="text-indigo-200/60 text-[10px] line-clamp-1 mt-0.5">{p.description}</p>}
                        <p className="text-indigo-200 text-xs mt-0.5">{currencySymbol}{Number(p.sellingPrice).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  {products.length > 4 && (
                    <div className="flex justify-center gap-1.5 mt-4">
                      {Array.from({ length: Math.min(6, products.length - 3) }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setHeroSlide(i)}
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            i === heroSlide % Math.max(1, products.length - 3)
                              ? 'w-6 bg-white'
                              : 'w-1.5 bg-white/30 hover:bg-white/50'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </section>
      )}

      {/* ── Trust Banner ── */}
      <div className="relative -mt-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 -mt-8 relative z-10 grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-100">
            {[{ icon: Truck, label: 'Free Delivery', sub: 'Orders > ₦50k' }, { icon: Shield, label: 'Secure Payment', sub: '256-bit SSL' }, { icon: RotateCcw, label: 'Easy Returns', sub: 'Within 30 days' }, { icon: Clock, label: '24/7 Support', sub: 'Always available' }].map((b, i) => (
              <div key={i} className="flex items-center justify-center gap-3 px-6 py-5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0"><b.icon className="w-5 h-5 text-indigo-600" /></div>
                <div className="hidden sm:block"><p className="text-sm font-bold text-gray-900">{b.label}</p><p className="text-xs text-gray-500">{b.sub}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Flash Deals Banner ── */}
      {!search && !activeCat && (
        <section id="deals" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="bg-gradient-to-r from-rose-50 via-orange-50 to-amber-50 rounded-3xl p-8 md:p-12 border border-rose-100">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-xl shadow-rose-200 animate-bounce"><Gift className="w-7 h-7 text-white" /></div>
                <div><h2 className="text-2xl md:text-3xl font-black text-gray-900">Flash Sale!</h2><p className="text-gray-600 text-sm mt-1">Limited time offers — grab them before they're gone</p></div>
              </div>
              <a href="#shop" className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-rose-600 to-orange-600 text-white rounded-2xl font-bold hover:from-rose-700 hover:to-orange-700 transition-all shadow-lg shadow-rose-200 hover:shadow-xl hover:shadow-rose-300">Shop Deals <Zap className="w-4 h-4" /></a>
            </div>
          </div>
        </section>
      )}

      {/* ── Product Grid ── */}
      <main id="shop" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-10">
          <div>
            <span className="text-xs font-bold text-indigo-600 uppercase tracking-[0.2em]">Our Collection</span>
            <h2 className="text-3xl md:text-4xl font-black text-gray-900 mt-1">{activeCat || 'All Products'}</h2>
            <p className="text-gray-500 mt-2">{total} premium product{total !== 1 ? 's' : ''} curated for you</p>
          </div>
          <select className="text-sm border border-gray-200 rounded-xl px-4 py-2.5 bg-white outline-none focus:ring-2 focus:ring-indigo-500 font-medium cursor-pointer" defaultValue="newest">
            <option value="newest">🆕 Newest First</option>
            <option value="price-low">💰 Price: Low to High</option>
            <option value="price-high">💎 Price: High to Low</option>
          </select>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 overflow-hidden animate-pulse">
                <div className="aspect-square bg-gradient-to-br from-gray-100 to-gray-200" />
                <div className="p-5 space-y-2"><div className="h-3 bg-gray-100 rounded-full w-1/3" /><div className="h-4 bg-gray-100 rounded-full w-2/3" /><div className="h-5 bg-gray-100 rounded-full w-1/2 mt-3" /></div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-24 h-24 rounded-3xl bg-gray-100 flex items-center justify-center mx-auto mb-6"><Search className="w-10 h-10 text-gray-300" /></div>
            <h3 className="text-xl font-bold text-gray-600 mb-2">No products found</h3>
            <p className="text-gray-400 max-w-sm mx-auto">Try a different search term or browse our categories to find what you need.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 md:gap-6">
              {products.map((product, idx) => {
                const outOfStock = product.type === 'GOODS' && product.quantity < 1
                const lowStock = product.type === 'GOODS' && product.quantity > 0 && product.quantity <= 5
                return (
                  <div key={product.id} className="group bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-2xl hover:shadow-gray-200/50 hover:-translate-y-1 transition-all duration-300 flex flex-col">
                    <div className={`relative aspect-square p-6 flex items-center justify-center overflow-hidden`} style={{ background: CARD_GRADIENTS[idx % CARD_GRADIENTS.length] }}>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-300" />
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover absolute inset-0 group-hover:scale-105 transition-transform duration-500" />
                      ) : (
                        <Package className="w-16 h-16 text-white/25 group-hover:scale-110 transition-transform duration-500" />
                      )}
                      {outOfStock && <span className="absolute top-3 left-3 px-3 py-1.5 bg-gray-900/90 backdrop-blur-sm text-white text-[11px] font-bold rounded-full z-10">Sold Out</span>}
                      {lowStock && <span className="absolute top-3 left-3 px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[11px] font-bold rounded-full shadow-lg">🔥 Only {product.quantity} left</span>}
                      <div className="absolute bottom-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                        <button onClick={() => addToCart(product)} disabled={outOfStock} className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-xl transition-all duration-200 ${outOfStock ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-900 hover:bg-indigo-600 hover:text-white hover:scale-110 hover:shadow-indigo-500/30'}`}><Plus className="w-5 h-5" /></button>
                      </div>
                    </div>
                    <div className="p-4 md:p-5 flex flex-col flex-1">
                      <div className="flex items-center gap-1 mb-1.5">
                        {Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`w-3 h-3 ${i < 4 ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-200'}`} />)}
                        <span className="text-[11px] text-gray-400 ml-1">(24)</span>
                      </div>
                      <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-1.5">{product.category}</span>
                      <h3 className="font-bold text-gray-900 text-sm md:text-base leading-tight line-clamp-2 mb-1 group-hover:text-indigo-700 transition-colors">{product.name}</h3>
                      {product.description && (
                        <p className="text-xs text-gray-400 line-clamp-2 mb-2">{product.description}</p>
                      )}
                      <div className="flex items-end justify-between pt-3 border-t border-gray-50 mt-auto">
                        <div>
                          <p className="text-xl font-extrabold text-gray-900">{currencySymbol}{Number(product.sellingPrice).toLocaleString()}</p>
                          {(product as any).keepingUnit && (product as any).sellingUnit ? (
                            <p className="text-[10px] text-gray-500">per {(product as any).keepingUnit}</p>
                          ) : product.sellingUnit ? (
                            <p className="text-[10px] text-gray-400">per {product.sellingUnit}</p>
                          ) : (
                            <p className="text-[10px] text-gray-400">per {product.unit}</p>
                          )}
                          {(product as any).keepingToSellingRate && Number((product as any).keepingToSellingRate) > 0 && (
                            <p className="text-[11px] text-indigo-600 font-semibold mt-0.5">
                              {currencySymbol}{(Number(product.sellingPrice) / Number((product as any).keepingToSellingRate)).toFixed(2)} / {(product as any).sellingUnit || product.unit}
                            </p>
                          )}
                        </div>
                        <button onClick={() => addToCart(product)} disabled={outOfStock} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${outOfStock ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white hover:shadow-lg hover:shadow-indigo-200'}`}>
                          {outOfStock ? 'Sold Out' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {total > limit && (
              <div className="flex justify-center mt-12 gap-2">
                {Array.from({ length: Math.ceil(total / limit) }).map((_, i) => (
                  <button key={i} onClick={() => setPage(i + 1)} className={`w-11 h-11 rounded-xl text-sm font-bold transition-all duration-200 ${page === i + 1 ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-200' : 'bg-white border-2 border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-600'}`}>{i + 1}</button>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Newsletter ── */}
      <section className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Mail className="w-12 h-12 text-white/30 mx-auto mb-6" />
          <h2 className="text-3xl md:text-4xl font-black text-white mb-3">Stay in the Loop</h2>
          <p className="text-indigo-100 text-lg mb-8 max-w-lg mx-auto">Subscribe for exclusive deals, new arrivals, and insider discounts.</p>
          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <input className="flex-1 px-5 py-3.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/50 outline-none focus:bg-white/20 transition-colors" placeholder="Enter your email" />
            <button className="px-8 py-3.5 bg-white text-indigo-700 rounded-xl font-bold hover:bg-gray-100 transition-colors shadow-xl">Subscribe</button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-900 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/30"><Zap className="w-5 h-5 text-white" /></div>
              <span className="font-extrabold text-white text-lg">{store?.name || 'Store'}</span>
            </div>
            <p className="text-sm leading-relaxed mb-6">Your premium online marketplace. Quality products, lightning-fast delivery, and unbeatable prices.</p>
            <div className="flex gap-3">
              {['📱','📘','🐦','📸'].map((icon, i) => <div key={i} className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 cursor-pointer transition-colors text-sm">{icon}</div>)}
            </div>
          </div>
          <div><h4 className="font-bold text-white text-sm mb-4">Shop</h4><div className="space-y-3 text-sm">{['All Products','New Arrivals','Best Sellers','Deals'].map(l => <p key={l} className="hover:text-white cursor-pointer transition-colors">{l}</p>)}</div></div>
          <div><h4 className="font-bold text-white text-sm mb-4">Support</h4><div className="space-y-3 text-sm">{['Help Center','Shipping','Returns','Contact'].map(l => <p key={l} className="hover:text-white cursor-pointer transition-colors">{l}</p>)}</div></div>
          <div><h4 className="font-bold text-white text-sm mb-4">Contact</h4><div className="space-y-3 text-sm"><p className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-indigo-400" /> Lagos, Nigeria</p><p className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-indigo-400" /> hello@{slug}.com</p><p className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-indigo-400" /> +234 800 000 0000</p></div></div>
        </div>
        <div className="border-t border-white/10"><div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-xs"><p>&copy; {new Date().getFullYear()} {store?.name || 'Store'}. All rights reserved. Built with ❤️</p><div className="flex gap-6"><span className="hover:text-white cursor-pointer transition-colors">Privacy</span><span className="hover:text-white cursor-pointer transition-colors">Terms</span><span className="hover:text-white cursor-pointer transition-colors">Cookies</span></div></div></div>
      </footer>

      {/* ── Slide-Out Cart ── */}
      {cartOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity" onClick={() => setCartOpen(false)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white z-50 shadow-2xl flex flex-col animate-slide-in">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-indigo-600" /><h3 className="font-extrabold text-gray-900 text-lg">Cart ({cartCount})</h3></div>
              <button onClick={() => setCartOpen(false)} className="p-2 rounded-xl hover:bg-gray-100 transition-colors"><X className="w-5 h-5 text-gray-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-300"><ShoppingCart className="w-20 h-20 mb-4 opacity-30" /><p className="font-semibold text-lg">Your cart is empty</p><p className="text-sm mt-1">Add some items to get started!</p></div>
              ) : cart.map(item => (
                <div key={item.product.id} className="flex gap-3 p-4 bg-gray-50 rounded-2xl hover:bg-white hover:shadow-md border border-transparent hover:border-gray-100 transition-all">
                  <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md" style={{ background: CARD_GRADIENTS[Math.floor(Math.random() * CARD_GRADIENTS.length)] }}><Package className="w-7 h-7 text-white/60" /></div>
                  <div className="flex-1 min-w-0"><p className="font-bold text-sm text-gray-900 truncate">{item.product.name}</p>
                    <p className="text-xs text-gray-500">
                      {currencySymbol}{Number(item.product.sellingPrice).toLocaleString()}
                      {(item.product as any).sellingUnit && (item.product as any).keepingUnit
                        ? ` / ${(item.product as any).keepingUnit}`
                        : (item.product as any).sellingUnit
                          ? ` / ${(item.product as any).sellingUnit}`
                          : ` / ${item.product.unit}`}
                    </p>
                    {(item.product as any).keepingToSellingRate && Number((item.product as any).keepingToSellingRate) > 0 && (
                      <p className="text-[11px] text-indigo-600 font-semibold">
                        ≈ {currencySymbol}{(Number(item.product.sellingPrice) / Number((item.product as any).keepingToSellingRate)).toFixed(2)} / {(item.product as any).sellingUnit || item.product.unit}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => updateQty(item.product.id, item.quantity - 1)} className="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center hover:border-gray-400 transition-colors"><Minus className="w-3 h-3" /></button>
                      <span className="text-sm font-bold w-6 text-center tabular-nums">{item.quantity}</span>
                      <button onClick={() => updateQty(item.product.id, item.quantity + 1)} className="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center hover:border-gray-400 transition-colors"><Plus className="w-3 h-3" /></button>
                    </div>
                  </div>
                  <button onClick={() => updateQty(item.product.id, 0)} className="self-start p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            {cart.length > 0 && (
              <div className="border-t border-gray-100 p-5 space-y-3 bg-white">
                <div className="flex justify-between text-sm"><span className="text-gray-500 font-medium">Subtotal</span><span className="font-extrabold text-gray-900 text-lg">{currencySymbol}{cartTotal.toLocaleString()}</span></div>
                <p className="text-xs text-gray-400">Shipping calculated at checkout</p>
                <button onClick={() => { setCartOpen(false); navigate(`/store/${slug}/cart`) }} className="w-full py-3.5 bg-white border-2 border-gray-900 text-gray-900 rounded-2xl font-bold text-sm hover:bg-gray-50 transition-all">View Cart</button>
                <button onClick={() => { setCartOpen(false); navigate(`/store/${slug}/checkout`) }} className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl font-bold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2">Checkout <ArrowRight className="w-4 h-4" /></button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
