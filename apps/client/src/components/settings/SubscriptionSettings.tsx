import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CreditCard, RefreshCw, UploadCloud, ShieldCheck } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import type { Plan, Subscription, SubscriptionPaymentMethod, SubscriptionTransaction } from '@/types'

const methodLabels: Record<SubscriptionPaymentMethod, string> = {
  PAYSTACK: 'Paystack (Online)',
  TRANSFER: 'Bank Transfer (Manual Verification)',
  MANUAL: 'Cash / Physical Payment (Super Admin)',
}

export default function SubscriptionSettings() {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  const apiOrigin = apiBase.startsWith('http') ? new URL(apiBase).origin : window.location.origin

  const user = useAuthStore((s) => s.user)
  const [plans, setPlans] = useState<Plan[]>([])
  const [currentSubscription, setCurrentSubscription] = useState<Subscription | null>(null)
  const [transactions, setTransactions] = useState<SubscriptionTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [requestedPlanId, setRequestedPlanId] = useState('')
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY')
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentMethod>('PAYSTACK')
  const [notes, setNotes] = useState('')
  const [transferProofUrl, setTransferProofUrl] = useState('')
  const [transferProofOriginalName, setTransferProofOriginalName] = useState('')
  const [transferProofSize, setTransferProofSize] = useState<number | null>(null)
  const [transferProofContentType, setTransferProofContentType] = useState('')
  const [transferProofUploadedByUserId, setTransferProofUploadedByUserId] = useState('')
  const [transferProofUploadedAt, setTransferProofUploadedAt] = useState('')
  const [proofUploading, setProofUploading] = useState(false)

  const tenantId = user?.tenantId || null

  const load = async () => {
    if (!tenantId) return

    setLoading(true)
    try {
      const [plansRes, tenantRes, txRes] = await Promise.all([
        api.get<{ data: Plan[] }>('/plans'),
        api.get<{ data: { subscriptions?: Subscription[] } }>(`/tenants/${tenantId}`),
        api.get<{ data: SubscriptionTransaction[] }>('/subscriptions/transactions'),
      ])

      const loadedPlans = plansRes.data.data || []
      setPlans(loadedPlans)

      const active = (tenantRes.data.data.subscriptions || []).find((s) => s.status === 'ACTIVE') || null
      setCurrentSubscription(active)

      setTransactions(txRes.data.data || [])

      if (!requestedPlanId && loadedPlans.length > 0) {
        const currentPlanId = active?.planId
        setRequestedPlanId(currentPlanId || loadedPlans[0].id)
        setBillingCycle(active?.plan?.billingCycle || loadedPlans[0].billingCycle)
      }
    } catch {
      toast.error('Failed to load subscription settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [tenantId])

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === requestedPlanId),
    [plans, requestedPlanId]
  )

  const isUpgrade = !!currentSubscription && currentSubscription.planId !== requestedPlanId

  const submitRequest = async () => {
    if (!requestedPlanId) {
      toast.error('Select a plan first')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        requestedPlanId,
        billingCycle,
        paymentMethod,
        notes: notes || undefined,
        transferProofUrl: paymentMethod === 'TRANSFER' ? transferProofUrl || undefined : undefined,
        transferProofOriginalName: paymentMethod === 'TRANSFER' ? transferProofOriginalName || undefined : undefined,
        transferProofSize: paymentMethod === 'TRANSFER' && transferProofSize !== null ? transferProofSize : undefined,
        transferProofContentType: paymentMethod === 'TRANSFER' ? transferProofContentType || undefined : undefined,
        transferProofUploadedByUserId: paymentMethod === 'TRANSFER' ? transferProofUploadedByUserId || undefined : undefined,
        transferProofUploadedAt: paymentMethod === 'TRANSFER' ? transferProofUploadedAt || undefined : undefined,
      }

      const createRes = await api.post<{ data: SubscriptionTransaction }>('/subscriptions/transactions', payload)
      const created = createRes.data.data

      if (paymentMethod === 'PAYSTACK') {
        const initRes = await api.post(`/subscriptions/transactions/${created.id}/paystack-init`)
        const url = initRes.data?.payment?.authorizationUrl
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer')
          toast.success('Payment initialized. Complete payment in the opened tab, then click Verify.')
        } else {
          toast.success('Payment initialized. Use transaction reference to complete checkout.')
        }
      } else if (paymentMethod === 'TRANSFER') {
        toast.success('Transfer request submitted for super-admin verification.')
      } else {
        toast.success('Request submitted. Awaiting super-admin activation.')
      }

      setNotes('')
      setTransferProofUrl('')
      setTransferProofOriginalName('')
      setTransferProofSize(null)
      setTransferProofContentType('')
      setTransferProofUploadedByUserId('')
      setTransferProofUploadedAt('')
      await load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  const verifyPaystack = async (txId: string) => {
    try {
      await api.post(`/subscriptions/transactions/${txId}/verify`, {})
      toast.success('Payment verified and subscription activated.')
      await load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'Could not verify payment yet')
    }
  }

  const uploadTransferProof = async (file: File) => {
    if (!file) return
    const form = new FormData()
    form.append('file', file)

    setProofUploading(true)
    try {
      const res = await api.post<{ data: { url: string; originalName: string; size: number; contentType: string; uploadedByUserId: string; uploadedAt: string } }>('/subscriptions/transactions/upload-proof', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setTransferProofUrl(res.data.data.url)
      setTransferProofOriginalName(res.data.data.originalName)
      setTransferProofSize(res.data.data.size)
      setTransferProofContentType(res.data.data.contentType)
      setTransferProofUploadedByUserId(res.data.data.uploadedByUserId)
      setTransferProofUploadedAt(res.data.data.uploadedAt)
      toast.success('Proof uploaded successfully')
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'Proof upload failed')
    } finally {
      setProofUploading(false)
    }
  }

  if (!tenantId) return null

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Subscription & Renewal</h2>
          <p className="text-sm text-gray-500 mt-1">Request renewal or plan upgrade, pay online, or submit transfer proof.</p>
        </div>
        <button className="btn-secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase text-gray-500">Current Plan</p>
          <p className="text-base font-semibold text-gray-900 mt-1">{currentSubscription?.plan?.name || 'No active plan'}</p>
          <p className="text-xs text-gray-500 mt-2">Status: {currentSubscription?.status || 'N/A'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase text-gray-500">Expiry Date</p>
          <p className="text-base font-semibold text-gray-900 mt-1">
            {currentSubscription?.expiryDate ? new Date(currentSubscription.expiryDate).toLocaleDateString() : 'N/A'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-xs uppercase text-gray-500">Selected Amount</p>
          <p className="text-base font-semibold text-gray-900 mt-1">
            {selectedPlan ? `${Number(selectedPlan.price).toFixed(2)} ${selectedPlan.priceCurrency}` : 'N/A'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Requested Plan</label>
          <select className="input" value={requestedPlanId} onChange={(e) => setRequestedPlanId(e.target.value)}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} - {Number(plan.price).toFixed(2)} {plan.priceCurrency}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Billing Cycle</label>
          <select className="input" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value as 'MONTHLY' | 'YEARLY')}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
        <select
          className="input"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as SubscriptionPaymentMethod)}
        >
          <option value="PAYSTACK">{methodLabels.PAYSTACK}</option>
          <option value="TRANSFER">{methodLabels.TRANSFER}</option>
        </select>
      </div>

      {paymentMethod === 'TRANSFER' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
            <UploadCloud className="w-4 h-4" /> Transfer Evidence
          </div>
          <p className="text-xs text-amber-700">Upload a proof file (PNG/JPG/PDF) or paste a hosted document URL for super-admin verification.</p>
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadTransferProof(file)
            }}
            className="block w-full text-xs text-amber-800"
          />
          {proofUploading && <p className="text-xs text-amber-700">Uploading proof...</p>}
          <input
            className="input"
            placeholder="https://.../payment-proof.jpg"
            value={transferProofUrl}
            onChange={(e) => setTransferProofUrl(e.target.value)}
          />
          {transferProofOriginalName && (
            <p className="text-xs text-amber-700">
              File: {transferProofOriginalName} ({transferProofSize || 0} bytes, {transferProofContentType || 'unknown'})
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea className="input min-h-[84px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional context for reviewer" />
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-gray-500">
          {isUpgrade ? 'You are requesting an upgrade.' : 'You are requesting a renewal/new package.'}
        </span>
        <button className="btn-primary" onClick={submitRequest} disabled={submitting || loading}>
          <CreditCard className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit Request'}
        </button>
      </div>

      <div className="pt-4 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Recent Transactions</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-gray-500">No transaction history yet.</p>
        ) : (
          <div className="space-y-2">
            {transactions.slice(0, 8).map((tx) => (
              <div key={tx.id} className="rounded-lg border border-gray-200 p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {tx.changeType} - {tx.requestedPlan?.name || tx.requestedPlanId}
                  </p>
                  <p className="text-xs text-gray-500">
                    {tx.paymentMethod} | {tx.status} | {new Date(tx.createdAt).toLocaleString()}
                  </p>
                  {tx.transferProofUrl && (
                    <a
                      href={tx.transferProofUrl.startsWith('http') ? tx.transferProofUrl : `${apiOrigin}${tx.transferProofUrl}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary-600 hover:underline"
                    >
                      Open transfer proof
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {tx.paymentMethod === 'PAYSTACK' && tx.status === 'PENDING_PAYMENT' && (
                    <button className="btn-secondary" onClick={() => void verifyPaystack(tx.id)}>
                      <ShieldCheck className="w-4 h-4" /> Verify
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
