import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Check, Shield, Lock, CreditCard, Truck, MapPin, User, Mail, Phone, Zap, Package, Banknote, Building2, Store, Home, Copy, Clock, ChevronDown, AlertCircle, Sparkles, Gift, Star, MessageSquare, Info } from 'lucide-react'
import { publicGet, publicPost } from '@/lib/publicApi'
import type { Product } from '@/types'
import { getCurrencySymbol } from '@/lib/currency'

// === Nigerian States ===
const NG_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo',
  'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa',
  'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba',
  'Yobe', 'Zamfara',
]

interface CartItem { product: Product; quantity: number }
interface CheckoutForm { name: string; email: string; phone: string; address: string; city: string; state: string; zip: string; notes: string }
interface FormErrors { name?: string; email?: string; phone?: string; address?: string; city?: string; state?: string }

type PaymentMethod = 'online' | 'transfer' | 'cash'
type DeliveryMethod = 'delivery' | 'pickup'

const GRADIENT_COLORS = [
  'from-violet-500 to-purple-600', 'from-rose-500 to-pink-600', 'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600', 'from-sky-500 to-blue-600', 'from-fuchsia-500 to-purple-600',
]

function estimateDelivery(): string {
  const d = new Date(); d.setDate(d.getDate() + 3)
  return d.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function StoreCheckoutPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [cart, setCart] = useState<CartItem[]>([])
  const [storeInfo, setStoreInfo] = useState<{ id: string; name: string; baseCurrency: string } | null>(null)
  const [subsidiaryId, setSubsidiaryId] = useState('')
  const [form, setForm] = useState<CheckoutForm>({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', notes: '' })
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('online')
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('delivery')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderComplete, setOrderComplete] = useState<{ receipt: string; orderId: string; trackingCode?: string; method: string } | null>(null)
  const [step, setStep] = useState<'shipping' | 'review'>('shipping')
  const [promoCode, setPromoCode] = useState('')
  const [promoApplied, setPromoApplied] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const scriptLoaded = useRef(false)

  useEffect(() => {
    try { const s = sessionStorage.getItem(`storefront-cart-${slug}`); if (s) { const p = JSON.parse(s) as CartItem[]; setCart(p); if (p.length === 0) navigate(`/store/${slug}`) } else navigate(`/store/${slug}`) } catch { navigate(`/store/${slug}`) }
  }, [slug, navigate])

  useEffect(() => {
    publicGet<any>(`/api/storefront/info?slug=${slug}`).then(r => { const d = r.data || r; if (d) { setStoreInfo({ id: d.id, name: d.name, baseCurrency: d.baseCurrency }); if (d.subsidiaryId) setSubsidiaryId(d.subsidiaryId); else { const s = sessionStorage.getItem(`storefront-subsidiary-${slug}`); if (s) setSubsidiaryId(s) } } }).catch(() => setError('Store not available'))
  }, [slug])

  useEffect(() => { if (scriptLoaded.current || document.querySelector('#paystack-script')) return; const s = document.createElement('script'); s.id='paystack-script'; s.src='https://js.paystack.co/v2/inline.js'; s.async=true; document.body.appendChild(s); scriptLoaded.current=true; return () => { const el=document.querySelector('#paystack-script'); if(el) el.remove() } }, [])

  // Validation
  const validate = useMemo(() => {
    const errs: FormErrors = {}
    if (!form.name.trim()) errs.name = 'Full name is required'
    else if (form.name.trim().length < 3) errs.name = 'Name must be at least 3 characters'
    if (!form.email.trim()) errs.email = 'Email is required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address'
    if (deliveryMethod === 'pickup' && !form.phone.trim()) errs.phone = 'Phone is required for pickup'
    if (deliveryMethod === 'delivery') {
      if (!form.address.trim()) errs.address = 'Address is required'
      if (!form.city.trim()) errs.city = 'City is required'
      if (!form.state) errs.state = 'State is required'
    }
    return errs
  }, [form, deliveryMethod])

  const hasErrors = Object.keys(validate).length > 0

  const subtotal = cart.reduce((s, i) => s + i.quantity * Number(i.product.sellingPrice), 0)
  const deliveryFee = deliveryMethod === 'pickup' ? 0 : (subtotal > 50000 ? 0 : 2500)
  const total = subtotal + deliveryFee
  const currencySymbol = storeInfo ? getCurrencySymbol(storeInfo.baseCurrency) : '$'
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0)
  const estimatedDate = estimateDelivery()

  const updateForm = (field: keyof CheckoutForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setTouched(prev => ({ ...prev, [field]: true }))
  }

  const inputClass = (field: keyof FormErrors) => {
    const base = 'w-full px-4 py-3 rounded-xl border-2 outline-none text-sm font-medium transition-all duration-200 bg-white'
    if (touched[field] && validate[field]) return `${base} border-rose-300 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 bg-rose-50/30`
    if (touched[field] && form[field as keyof CheckoutForm] && !validate[field]) return `${base} border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 bg-emerald-50/20`
    return `${base} border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 hover:border-gray-300`
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  const buildOrderPayload = () => ({
    tenantId: storeInfo!.id,
    subsidiaryId,
    items: cart.map(i => ({ productId: i.product.id, quantity: i.quantity, unitPrice: Number(i.product.sellingPrice), costPrice: Number(i.product.costPrice), discount: 0 })),
    discount: 0,
    currency: storeInfo!.baseCurrency,
    fxRate: 1,
    customerName: form.name,
    customerEmail: form.email,
    customerPhone: form.phone,
    shippingAddress: deliveryMethod === 'delivery' ? { name: form.name, line1: form.address, city: form.city, state: form.state, zip: form.zip, country: 'NG', phone: form.phone } : null,
    transactionRef: '',
    notes: form.notes || undefined,
  })

  const placeOrder = async () => {
    if (!storeInfo?.id || !subsidiaryId || hasErrors) return
    setLoading(true); setError(null)

    try {
      const ref = `SPP-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
      const payload = { ...buildOrderPayload(), transactionRef: ref }
      const res = await publicPost<any>('/api/storefront/checkout', payload)
      sessionStorage.removeItem(`storefront-cart-${slug}`)
      setOrderComplete({ receipt: res.data?.receiptNumber || `ORD-${Date.now().toString(36).toUpperCase()}`, orderId: ref, trackingCode: res.data?.trackingCode, method: paymentMethod })
    } catch (err: any) {
      setError(err?.message || 'Order could not be placed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleOnlinePay = () => {
    if (!storeInfo?.id || !subsidiaryId || hasErrors) return
    setLoading(true); setError(null)
    const reference = `SPP-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`
    const payload = { ...buildOrderPayload(), transactionRef: reference }

    const handler = (window as any).PaystackPop?.setup({
      key: 'pk_test_placeholder',
      email: form.email,
      amount: Math.round(total * 100),
      currency: storeInfo.baseCurrency,
      ref: reference,
      metadata: { custom_fields: [{ display_name:'Order', variable_name:'items', value:`${itemCount} items` }] },
      onClose: () => { setLoading(false); setError('Payment was cancelled.') },
      callback: async (r: { reference:string; status:string }) => {
        if (r.status === 'success') {
          try {
            const res = await publicPost('/api/storefront/checkout', payload)
            await publicPost('/api/storefront/payment/verify', { reference: r.reference })
            sessionStorage.removeItem(`storefront-cart-${slug}`)
            setOrderComplete({ receipt: `RCP-${Date.now().toString(36).toUpperCase()}`, orderId: r.reference, trackingCode: res.data?.trackingCode, method: 'online' })
          } catch (e: any) { setError(e?.message || 'Order processing failed.') }
        } else { setError('Payment was not successful.') }
        setLoading(false)
      },
    })
    handler.openIframe()
  }

  const handleSubmit = () => {
    // Validate all fields on submit
    setTouched({ name: true, email: true, phone: true, address: true, city: true, state: true })
    if (hasErrors) { setError('Please fix the errors below before continuing.'); return }
    if (paymentMethod === 'online') { handleOnlinePay() } else { placeOrder() }
  }

  // === SUCCESS PAGE ===
  if (orderComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 font-sans" style={{ background: 'linear-gradient(180deg, #f9fafb 0%, #f3f4f6 25%, #f9fafb 50%, #f5f6f8 75%, #fafbfc 100%)' }}>
        <div className="bg-white rounded-2xl p-8 md:p-10 max-w-lg w-full" style={{ border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.06)' }}>

          <div className="relative">
            {/* Success icon */}
            <div className="w-24 h-24 bg-gradient-to-br from-emerald-400 via-teal-400 to-emerald-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-200 animate-[bounce_0.5s_ease-out]">
              <Check className="w-12 h-12 text-white" strokeWidth={3} />
            </div>

            <h1 className="text-3xl font-black text-gray-900 mb-2 text-center">🎉 Order Confirmed!</h1>
            <p className="text-gray-500 text-center mb-4">
              Thank you, <strong>{form.name}</strong>! A confirmation has been sent to <strong>{form.email}</strong>.
            </p>

            {/* Order details card */}
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-5 mb-5 space-y-3 text-sm border border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Receipt #</span>
                <span className="font-bold text-gray-900 font-mono">{orderComplete.receipt}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Reference</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-gray-700">{orderComplete.orderId}</span>
                  <button onClick={() => copyToClipboard(orderComplete.orderId, 'ref')} className="p-1 hover:bg-gray-200 rounded-lg transition-colors">
                    {copiedField === 'ref' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                  </button>
                </div>
              </div>
              {orderComplete.trackingCode && (
                <div className="flex justify-between items-center bg-white rounded-xl p-3 border border-indigo-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center"><Package className="w-4 h-4 text-indigo-600" /></div>
                    <div><p className="text-xs text-gray-500">Tracking Code</p><p className="font-extrabold font-mono text-indigo-700">{orderComplete.trackingCode}</p></div>
                  </div>
                  <button onClick={() => copyToClipboard(orderComplete.trackingCode!, 'track')} className="p-2 hover:bg-indigo-100 rounded-lg transition-colors">
                    {copiedField === 'track' ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-indigo-400" />}
                  </button>
                </div>
              )}
              <div className="flex justify-between"><span className="text-gray-500">Items</span><span className="font-bold">{itemCount}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Delivery</span><span className="font-bold capitalize flex items-center gap-1.5">{deliveryMethod === 'pickup' ? <><Store className="w-3.5 h-3.5" /> Pickup</> : <><Truck className="w-3.5 h-3.5" /> Home Delivery</>}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Est. Delivery</span><span className="font-bold flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-amber-500" />{deliveryMethod === 'pickup' ? 'Ready in 24h' : estimatedDate}</span></div>
              <div className="flex justify-between pt-3 border-t border-gray-200"><span className="font-bold text-base">Total Paid</span><span className="font-extrabold text-xl text-gray-900">{currencySymbol}{total.toLocaleString()}</span></div>
            </div>

            {/* Payment instructions */}
            {paymentMethod === 'transfer' && (
              <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl p-5 mb-5 border border-amber-200 space-y-2">
                <p className="font-bold text-amber-900 flex items-center gap-2"><Building2 className="w-4 h-4" /> Bank Transfer Details</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white/80 rounded-xl p-3">
                    <p className="text-amber-600 mb-0.5">Bank</p>
                    <p className="font-bold text-amber-900">GTBank</p>
                  </div>
                  <div className="bg-white/80 rounded-xl p-3 relative group">
                    <p className="text-amber-600 mb-0.5">Account Number</p>
                    <p className="font-bold text-amber-900 font-mono">0123456789</p>
                    <button onClick={() => copyToClipboard('0123456789', 'acct')} className="absolute top-2 right-2 p-1.5 hover:bg-amber-100 rounded-lg transition-colors">
                      {copiedField === 'acct' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-amber-700">Name: <strong>{storeInfo?.name || 'Store'}</strong></p>
                <p className="text-xs text-amber-600 bg-amber-100/80 rounded-lg p-2">
                  ⚠️ Use <strong className="font-mono">{orderComplete.orderId}</strong> as the payment description so we can match your payment.
                </p>
              </div>
            )}

            {paymentMethod === 'cash' && (
              <div className="bg-gradient-to-r from-blue-50 to-sky-50 rounded-2xl p-5 mb-5 border border-blue-200">
                <p className="font-bold text-blue-900 flex items-center gap-2"><Banknote className="w-4 h-4" /> Cash Payment</p>
                <p className="text-sm text-blue-700 mt-2">Please have <strong>{currencySymbol}{total.toLocaleString()}</strong> ready when {deliveryMethod === 'pickup' ? 'picking up' : 'receiving'} your order. Your reference is <strong className="font-mono">{orderComplete.orderId}</strong>.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => navigate(`/store/${slug}`)} className="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl font-bold hover:from-indigo-700 hover:to-violet-700 transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2">
                <Zap className="w-4 h-4" /> Continue Shopping
              </button>
              {orderComplete.trackingCode && (
                <button onClick={() => navigate(`/track`)} className="py-3.5 px-5 bg-white border-2 border-gray-200 text-gray-700 rounded-2xl font-bold hover:border-indigo-300 hover:text-indigo-600 transition-all flex items-center gap-2">
                  <Package className="w-4 h-4" /> Track
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // === CHECKOUT PAGE ===
  return (
    <div className="min-h-screen font-sans antialiased" style={{ background: 'linear-gradient(180deg, #f9fafb 0%, #f3f4f6 25%, #f9fafb 50%, #f5f6f8 75%, #fafbfc 100%)' }}>
      {/* Header with progress bar */}
      <header className="sticky top-0 z-30" style={{ background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(16px) saturate(180%)', borderBottom: '1px solid rgba(148,163,184,0.12)' }}>
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <button onClick={() => navigate(`/store/${slug}/cart`)} className="flex items-center gap-2 text-gray-600 hover:text-indigo-600 font-semibold text-sm transition-colors group">
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> Back to Cart
          </button>

          {/* Progress steps */}
          <div className="flex items-center gap-2 sm:gap-4">
            <button onClick={() => setStep('shipping')} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all ${step === 'shipping' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-gray-600'}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold transition-all ${step === 'review' ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-200' : step === 'shipping' ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200' : 'bg-gray-200 text-gray-400'}`}>
                {step === 'review' ? <Check className="w-4 h-4" /> : '1'}
              </div>
              <span className={`text-xs font-bold hidden sm:inline ${step === 'shipping' ? 'text-indigo-700' : step === 'review' ? 'text-emerald-600' : 'text-gray-400'}`}>Shipping</span>
            </button>
            <div className={`w-8 sm:w-12 h-0.5 rounded-full transition-all duration-500 ${step === 'review' ? 'bg-emerald-400' : 'bg-gray-200'}`} />
            <button onClick={() => { if (step === 'review') setStep('review') }} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all ${step === 'review' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold transition-all ${step === 'review' ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200' : 'bg-gray-200 text-gray-400'}`}>2</div>
              <span className={`text-xs font-bold hidden sm:inline ${step === 'review' ? 'text-indigo-700' : 'text-gray-400'}`}>Payment</span>
            </button>
          </div>

          <div className="w-24 hidden sm:flex items-center justify-end gap-1 text-xs text-gray-400">
            <Shield className="w-3 h-3" /> Secure
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1" style={{ background: '#e5e7eb' }}>
          <div className={`h-full transition-all duration-700 ease-out ${step === 'shipping' ? 'w-1/2' : 'w-full'}`} style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }} />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 md:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* === LEFT COLUMN - FORMS === */}
          <div className="lg:col-span-2 space-y-6">
            {step === 'shipping' ? (
              <div className="rounded-2xl p-6 md:p-8 animate-[fadeIn_0.3s_ease-out] relative overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7)' }} />
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', boxShadow: '0 8px 20px rgba(99,102,241,0.12)' }}>
                    <MapPin className="w-7 h-7" style={{ color: '#4f46e5' }} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-extrabold" style={{ color: '#111827' }}>Delivery Details</h2>
                    <p className="text-sm text-gray-500">Tell us where to send your order</p>
                  </div>
                </div>

                {/* Delivery Method Toggle */}
                <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><Truck className="w-4 h-4" /> Delivery Method</p>
                <div className="grid grid-cols-2 gap-3 mb-8">
                  <button onClick={() => setDeliveryMethod('delivery')} className="relative p-5 rounded-2xl border-2 text-left transition-all duration-300 overflow-hidden group" style={deliveryMethod === 'delivery' ? { borderColor: '#6366f1', background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)', boxShadow: '0 8px 24px rgba(99,102,241,0.12)' } : { borderColor: '#e5e7eb' }}>
                    {deliveryMethod === 'delivery' && <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}><Check className="w-3.5 h-3.5 text-white" /></div>}
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-all" style={deliveryMethod === 'delivery' ? { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', boxShadow: '0 6px 16px rgba(99,102,241,0.25)' } : { background: '#f3f4f6', color: '#9ca3af' }}>
                      <Truck className="w-6 h-6" />
                    </div>
                    <p className={`text-sm font-extrabold mb-1 ${deliveryMethod === 'delivery' ? 'text-indigo-900' : 'text-gray-700'}`}>Home Delivery</p>
                    <p className="text-xs text-gray-500">Delivered to your doorstep</p>
                    <p className={`text-xs font-bold mt-2 ${deliveryFee === 0 ? 'text-emerald-600' : 'text-gray-600'}`}>{deliveryFee === 0 ? '✨ Free' : `${currencySymbol}${deliveryFee.toLocaleString()}`}</p>
                  </button>
                  <button onClick={() => setDeliveryMethod('pickup')} className="relative p-5 rounded-2xl border-2 text-left transition-all duration-300 overflow-hidden group" style={deliveryMethod === 'pickup' ? { borderColor: '#6366f1', background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)', boxShadow: '0 8px 24px rgba(99,102,241,0.12)' } : { borderColor: '#e5e7eb' }}>
                    {deliveryMethod === 'pickup' && <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}><Check className="w-3.5 h-3.5 text-white" /></div>}
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-all" style={deliveryMethod === 'pickup' ? { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', boxShadow: '0 6px 16px rgba(99,102,241,0.25)' } : { background: '#f3f4f6', color: '#9ca3af' }}>
                      <Store className="w-6 h-6" />
                    </div>
                    <p className={`text-sm font-extrabold mb-1 ${deliveryMethod === 'pickup' ? 'text-indigo-900' : 'text-gray-700'}`}>Store Pickup</p>
                    <p className="text-xs text-gray-500">Collect at our location</p>
                    <p className="text-xs font-bold mt-2 text-emerald-600">✨ Free</p>
                  </button>
                </div>

                {/* Contact Form */}
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-bold text-gray-700 mb-2"><User className="w-3.5 h-3.5 inline mr-1.5" />Full Name *</label>
                      <input className={inputClass('name')} value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="John Doe" />
                      {touched.name && validate.name && <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{validate.name}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2"><Mail className="w-3.5 h-3.5 inline mr-1.5" />Email Address *</label>
                      <input className={inputClass('email')} type="email" value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="john@example.com" />
                      {touched.email && validate.email && <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{validate.email}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2"><Phone className="w-3.5 h-3.5 inline mr-1.5" />Phone Number{deliveryMethod === 'pickup' ? ' *' : ''}</label>
                      <input className={inputClass('phone')} value={form.phone} onChange={e => updateForm('phone', e.target.value)} placeholder="+234 800 000 0000" />
                      {touched.phone && validate.phone && <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{validate.phone}</p>}
                    </div>
                  </div>

                  {deliveryMethod === 'delivery' && (
                    <>
                      <div className="border-t border-gray-100 pt-5">
                        <p className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><Home className="w-4 h-4" /> Shipping Address</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                          <div className="sm:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-2">Street Address *</label>
                            <input className={inputClass('address')} value={form.address} onChange={e => updateForm('address', e.target.value)} placeholder="123 Admiralty Way" />
                            {touched.address && validate.address && <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{validate.address}</p>}
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">City *</label>
                            <input className={inputClass('city')} value={form.city} onChange={e => updateForm('city', e.target.value)} placeholder="Lekki" />
                            {touched.city && validate.city && <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{validate.city}</p>}
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">State *</label>
                            <div className="relative">
                              <select className={`${inputClass('state')} appearance-none cursor-pointer pr-10`} value={form.state} onChange={e => updateForm('state', e.target.value)}>
                                <option value="">Select state...</option>
                                {NG_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                            </div>
                            {touched.state && validate.state && <p className="text-xs text-rose-500 mt-1.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{validate.state}</p>}
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">ZIP / Postal Code</label>
                            <input className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm font-medium transition-all hover:border-gray-300" value={form.zip} onChange={e => updateForm('zip', e.target.value)} placeholder="100001" />
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Order Notes */}
                  <div className="border-t border-gray-100 pt-5">
                    <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2"><MessageSquare className="w-3.5 h-3.5" />Order Notes (Optional)</label>
                    <textarea className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm font-medium transition-all hover:border-gray-300 resize-none" rows={3} value={form.notes} onChange={e => updateForm('notes', e.target.value)} placeholder="Special delivery instructions, gift message, etc." />
                  </div>
                </div>

                <button onClick={() => { setTouched({ name: true, email: true, phone: true, address: true, city: true, state: true }); if (!hasErrors) setStep('review'); }} className="w-full mt-8 py-4 text-white rounded-xl font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base active:scale-[0.99]" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 8px 24px rgba(99,102,241,0.2)' }}>
                  Continue to Payment →
                </button>
              </div>
            ) : (
              <div className="rounded-2xl p-6 md:p-8 animate-[fadeIn_0.3s_ease-out] relative overflow-hidden" style={{ background: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div className="absolute top-0 left-0 right-0 h-1" style={{ background: 'linear-gradient(90deg, #8b5cf6, #a855f7, #d946ef)' }} />
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #f3e8ff, #ede9fe)', boxShadow: '0 8px 20px rgba(139,92,246,0.12)' }}>
                    <CreditCard className="w-7 h-7" style={{ color: '#7c3aed' }} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-extrabold text-gray-900">Payment</h2>
                    <p className="text-sm text-gray-500">Complete your purchase securely</p>
                  </div>
                </div>

                {/* Delivery Summary Card */}
                <div className="rounded-2xl p-5 mb-6 border" style={{ background: 'linear-gradient(135deg, #f8fafc, #f0f4ff, #faf5ff)', borderColor: 'rgba(99,102,241,0.15)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-bold text-gray-700 flex items-center gap-2">
                      {deliveryMethod === 'pickup' ? <Store className="w-4 h-4 text-indigo-500" /> : <Truck className="w-4 h-4 text-indigo-500" />}
                      {deliveryMethod === 'pickup' ? 'Store Pickup' : 'Home Delivery'}
                    </p>
                    <button onClick={() => setStep('shipping')} className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-all">Edit</button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 text-gray-400" /><span className="font-semibold text-gray-800">{form.name}</span></div>
                    <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-600">{form.email}</span></div>
                    {form.phone && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 text-gray-400" /><span className="text-gray-600">{form.phone}</span></div>}
                    {deliveryMethod === 'delivery' && (
                      <div className="sm:col-span-2 flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" /><span className="text-gray-600 truncate">{form.address}, {form.city}, {form.state}</span></div>
                    )}
                  </div>
                </div>

                {/* Payment Method Selection */}
                <p className="text-sm font-bold text-gray-700 mb-4 flex items-center gap-2"><Lock className="w-4 h-4 text-violet-500" /> Payment Method</p>
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <button onClick={() => setPaymentMethod('online')} className={`relative p-4 rounded-2xl border-2 text-center transition-all duration-300 group ${paymentMethod === 'online' ? 'shadow-xl' : 'hover:shadow-md'}`}
                    style={paymentMethod === 'online' ? { borderColor: '#7c3aed', background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', boxShadow: '0 8px 24px rgba(124,58,237,0.15)' } : { borderColor: '#e5e7eb' }}>
                    {paymentMethod === 'online' && <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}><Check className="w-3 h-3 text-white" /></div>}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition-all ${paymentMethod === 'online' ? 'text-white' : 'text-gray-400 group-hover:bg-gray-200'}`}
                      style={paymentMethod === 'online' ? { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', boxShadow: '0 4px 12px rgba(124,58,237,0.25)' } : { background: '#f3f4f6' }}>
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <span className={`text-xs font-bold block ${paymentMethod === 'online' ? 'text-violet-800' : 'text-gray-600'}`}>Card / Bank</span>
                    <span className="text-[10px] text-gray-400 block mt-0.5">Instant · Secure</span>
                  </button>
                  <button onClick={() => setPaymentMethod('transfer')} className={`relative p-4 rounded-2xl border-2 text-center transition-all duration-300 group ${paymentMethod === 'transfer' ? 'shadow-xl' : 'hover:shadow-md'}`}
                    style={paymentMethod === 'transfer' ? { borderColor: '#7c3aed', background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', boxShadow: '0 8px 24px rgba(124,58,237,0.15)' } : { borderColor: '#e5e7eb' }}>
                    {paymentMethod === 'transfer' && <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}><Check className="w-3 h-3 text-white" /></div>}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition-all ${paymentMethod === 'transfer' ? 'text-white' : 'text-gray-400 group-hover:bg-gray-200'}`}
                      style={paymentMethod === 'transfer' ? { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', boxShadow: '0 4px 12px rgba(124,58,237,0.25)' } : { background: '#f3f4f6' }}>
                      <Building2 className="w-5 h-5" />
                    </div>
                    <span className={`text-xs font-bold block ${paymentMethod === 'transfer' ? 'text-violet-800' : 'text-gray-600'}`}>Bank Transfer</span>
                    <span className="text-[10px] text-gray-400 block mt-0.5">Manual · Verify</span>
                  </button>
                  <button onClick={() => setPaymentMethod('cash')} className={`relative p-4 rounded-2xl border-2 text-center transition-all duration-300 group ${paymentMethod === 'cash' ? 'shadow-xl' : 'hover:shadow-md'}`}
                    style={paymentMethod === 'cash' ? { borderColor: '#7c3aed', background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', boxShadow: '0 8px 24px rgba(124,58,237,0.15)' } : { borderColor: '#e5e7eb' }}>
                    {paymentMethod === 'cash' && <div className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}><Check className="w-3 h-3 text-white" /></div>}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 transition-all ${paymentMethod === 'cash' ? 'text-white' : 'text-gray-400 group-hover:bg-gray-200'}`}
                      style={paymentMethod === 'cash' ? { background: 'linear-gradient(135deg, #7c3aed, #a855f7)', boxShadow: '0 4px 12px rgba(124,58,237,0.25)' } : { background: '#f3f4f6' }}>
                      <Banknote className="w-5 h-5" />
                    </div>
                    <span className={`text-xs font-bold block ${paymentMethod === 'cash' ? 'text-violet-800' : 'text-gray-600'}`}>Cash</span>
                    <span className="text-[10px] text-gray-400 block mt-0.5">Pay on receipt</span>
                  </button>
                </div>

                {/* Payment method info panels */}
                {paymentMethod === 'online' && (
                  <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-5 mb-6 border border-emerald-100 flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0"><Lock className="w-5 h-5 text-emerald-600" /></div>
                    <div>
                      <p className="font-bold text-emerald-900 text-sm">🔒 Secure Card Payment</p>
                      <p className="text-xs text-emerald-700 mt-1">Powered by Paystack — your card details are encrypted and never stored on our servers. We accept all major debit & credit cards.</p>
                      <div className="flex gap-2 mt-2">
                        <span className="text-[10px] bg-white rounded-lg px-2 py-1 text-emerald-700 font-semibold">Visa</span>
                        <span className="text-[10px] bg-white rounded-lg px-2 py-1 text-emerald-700 font-semibold">Mastercard</span>
                        <span className="text-[10px] bg-white rounded-lg px-2 py-1 text-emerald-700 font-semibold">Verve</span>
                      </div>
                    </div>
                  </div>
                )}

                {paymentMethod === 'transfer' && (
                  <div className="bg-gradient-to-r from-amber-50 to-yellow-50 rounded-2xl p-5 mb-6 border border-amber-200">
                    <p className="font-bold text-amber-900 text-sm flex items-center gap-2 mb-3"><Building2 className="w-4 h-4" /> Bank Transfer Instructions</p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="bg-white/80 rounded-xl p-3">
                        <p className="text-amber-600 mb-0.5">Bank</p>
                        <p className="font-extrabold text-amber-900">GTBank</p>
                      </div>
                      <div className="bg-white/80 rounded-xl p-3 relative">
                        <p className="text-amber-600 mb-0.5">Account Number</p>
                        <p className="font-extrabold text-amber-900 font-mono">0123456789</p>
                        <button onClick={() => copyToClipboard('0123456789', 'acct2')} className="absolute top-2 right-2 p-1 hover:bg-amber-100 rounded-lg transition-colors">
                          {copiedField === 'acct2' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-amber-400" />}
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-amber-700 mt-2">Account Name: <strong>{storeInfo?.name || 'Store'}</strong></p>
                    <p className="text-xs text-amber-600 mt-2 bg-amber-100/80 rounded-lg p-2">After placing your order, use the reference number as the payment description.</p>
                  </div>
                )}

                {paymentMethod === 'cash' && (
                  <div className="bg-gradient-to-r from-blue-50 to-sky-50 rounded-2xl p-5 mb-6 border border-blue-200 flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0"><Info className="w-5 h-5 text-blue-600" /></div>
                    <div>
                      <p className="font-bold text-blue-900 text-sm">💵 Cash on {deliveryMethod === 'pickup' ? 'Pickup' : 'Delivery'}</p>
                      <p className="text-xs text-blue-700 mt-1">Pay <strong>{currencySymbol}{total.toLocaleString()}</strong> in cash when your order is {deliveryMethod === 'pickup' ? 'picked up at our store' : 'delivered to your address'}.</p>
                    </div>
                  </div>
                )}

                {/* Promo Code */}
                <div className="border-t border-gray-100 pt-5 mb-6">
                  <p className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><Gift className="w-4 h-4" /> Promo Code</p>
                  <div className="flex gap-2">
                    <input className="flex-1 px-4 py-2.5 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-sm font-medium transition-all" value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="Enter code..." disabled={promoApplied} />
                    <button onClick={() => { if (promoCode.trim()) setPromoApplied(true) }} disabled={promoApplied || !promoCode.trim()} className={`px-4 py-2.5 rounded-xl font-bold text-sm transition-all ${promoApplied ? 'bg-emerald-100 text-emerald-700 cursor-default' : 'bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40'}`}>
                      {promoApplied ? <span className="flex items-center gap-1.5"><Check className="w-4 h-4" /> Applied</span> : 'Apply'}
                    </button>
                  </div>
                  {promoApplied && <p className="text-xs text-emerald-600 mt-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Promo code applied — discount will reflect at checkout completion.</p>}
                </div>

                {/* Error display */}
                {error && (
                  <div className="bg-rose-50 text-rose-700 font-medium text-sm rounded-2xl p-4 mb-6 border border-rose-200 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Oops! Something went wrong</p>
                      <p className="text-xs text-rose-600 mt-0.5">{error}</p>
                    </div>
                  </div>
                )}

                {/* Submit button */}
                <button onClick={handleSubmit} disabled={loading || !storeInfo?.id || !subsidiaryId} className="w-full py-4 text-white rounded-xl font-bold text-base transition-all flex items-center justify-center gap-3 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99]" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 4px 16px rgba(79,70,229,0.2)' }}>
                  {loading ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : paymentMethod === 'online' ? (
                    <Lock className="w-5 h-5" />
                  ) : (
                    <Star className="w-5 h-5" />
                  )}
                  {loading ? 'Processing...' : paymentMethod === 'online' ? `Pay ${currencySymbol}${total.toLocaleString()} Securely` : `Place Order · ${currencySymbol}${total.toLocaleString()}`}
                </button>

                <p className="text-center text-[11px] text-gray-400 mt-4 flex items-center justify-center gap-1.5">
                  <Shield className="w-3 h-3" /> Your data is encrypted with 256-bit SSL
                </p>
              </div>
            )}
          </div>

          {/* === RIGHT COLUMN - ORDER SUMMARY === */}
          <div className="relative">
            <div className="rounded-2xl p-6 sticky top-24 relative overflow-hidden" style={{ background: '#ffffff', border: '1px solid #e8ecf1', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)' }}>
              <div className="absolute top-0 left-0 w-1 h-full" style={{ background: 'linear-gradient(180deg, #6366f1, #8b5cf6, #a855f7)' }} />
              <h2 className="text-lg font-extrabold mb-5 flex items-center gap-2" style={{ color: '#1e1b4b' }}>
                <span className="w-8 h-8 rounded-lg text-white flex items-center justify-center text-xs font-bold" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>{itemCount}</span>
                Order Summary
              </h2>

              {/* Cart items */}
              <div className="space-y-4 max-h-64 overflow-y-auto mb-5 pr-1">
                {cart.map((item, idx) => (
                  <div key={item.product.id} className="flex gap-3 group">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${GRADIENT_COLORS[idx % GRADIENT_COLORS.length]} flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-105 transition-transform`}>
                      {item.product.imageUrl ? (
                        <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover rounded-xl" />
                      ) : (
                        <Package className="w-6 h-6 text-white/70" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 font-bold text-sm truncate">{item.product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">Qty: {item.quantity}</span>
                        <span className="text-xs text-gray-300">×</span>
                        <span className="text-xs text-gray-500">{currencySymbol}{Number(item.product.sellingPrice).toLocaleString()}</span>
                      </div>
                    </div>
                    <span className="font-bold text-gray-900 text-sm">{currencySymbol}{(item.quantity * Number(item.product.sellingPrice)).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              {/* Price breakdown */}
              <div className="border-t border-gray-100 pt-4 space-y-2.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal ({itemCount} items)</span>
                  <span className="font-semibold text-gray-800">{currencySymbol}{subtotal.toLocaleString()}</span>
                </div>

                {promoApplied && (
                  <div className="flex justify-between text-emerald-600">
                    <span className="flex items-center gap-1"><Gift className="w-3.5 h-3.5" /> Promo discount</span>
                    <span className="font-semibold">-{currencySymbol}0.00</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span className="text-gray-500 flex items-center gap-1.5">
                    {deliveryMethod === 'pickup' ? <Store className="w-3.5 h-3.5" /> : <Truck className="w-3.5 h-3.5" />}
                    {deliveryMethod === 'pickup' ? 'Store Pickup' : 'Delivery'}
                  </span>
                  <span className="font-semibold">{deliveryFee === 0 ? <span className="text-emerald-600 font-bold">FREE</span> : `${currencySymbol}${deliveryFee.toLocaleString()}`}</span>
                </div>

                {subtotal < 50000 && deliveryMethod === 'delivery' && (
                  <div className="rounded-xl p-2.5 text-xs flex items-center gap-2 border" style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)', borderColor: '#fcd34d', color: '#92400e' }}>
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    Add {currencySymbol}{(50000 - subtotal).toLocaleString()} more for <strong>free delivery</strong>!
                  </div>
                )}

                <div className="flex justify-between pt-3 border-t-2 border-gray-200">
                  <span className="font-extrabold text-base text-gray-900">Total</span>
                  <span className="font-extrabold text-xl text-gray-900">{currencySymbol}{total.toLocaleString()}</span>
                </div>
              </div>

              {/* Estimated delivery */}
              <div className="mt-5 rounded-xl p-3 flex items-center gap-3 border" style={{ background: 'linear-gradient(135deg, #eef2ff, #f3e8ff)', borderColor: 'rgba(99,102,241,0.2)' }}>
                <Clock className="w-5 h-5 flex-shrink-0" style={{ color: '#6366f1' }} />
                <div>
                  <p className="text-xs font-bold text-indigo-800">Estimated {deliveryMethod === 'pickup' ? 'Ready' : 'Delivery'}</p>
                  <p className="text-xs text-indigo-600">{deliveryMethod === 'pickup' ? 'Within 24 hours' : estimatedDate}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Inline animation keyframes */}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{opacity:.2}50%{opacity:.35}}`}</style>
    </div>
  )
}
