import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, RefreshCw } from 'lucide-react'
import { useReactToPrint } from 'react-to-print'
import { QRCodeSVG } from 'qrcode.react'
import api from '@/lib/api'
import { getSuperadminCacheKey, isOnlineNow, readSuperadminCache, writeSuperadminCache } from '@/lib/superadminCache'
import type { Plan, SubscriptionPaymentMethod, SubscriptionTransaction, SubscriptionTransactionStatus, Tenant } from '@/types'
import { useAuthStore } from '@/store/auth.store'

const statusOptions: Array<SubscriptionTransactionStatus | 'ALL'> = [
  'ALL',
  'PENDING_PAYMENT',
  'PENDING_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'REJECTED',
  'CANCELLED',
]

const paymentMethodOptions: Array<SubscriptionPaymentMethod | 'ALL'> = ['ALL', 'PAYSTACK', 'TRANSFER', 'MANUAL']

type InitiationReceipt = {
  transactionId: string
  tenantName: string
  planName: string
  paymentMethod: SubscriptionPaymentMethod
  billingCycle: 'MONTHLY' | 'YEARLY'
  amount: number
  currency: string
  status: SubscriptionTransactionStatus
  createdAt: string
  initiatedBy: string
  notes?: string
}

export default function SubscriptionTransactionsPage() {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  const apiOrigin = apiBase.startsWith('http') ? new URL(apiBase).origin : window.location.origin
  const paymentFeePercent = Number(import.meta.env.VITE_SUBSCRIPTION_PAYMENT_FEE_PERCENT || 0)
  const paymentFeeFixed = Number(import.meta.env.VITE_SUBSCRIPTION_PAYMENT_FEE_FIXED || 0)
  const user = useAuthStore((s) => s.user)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const isAgent = user?.role === 'AGENT'
  const canInitiate = isSuperAdmin || isAgent

  const [rows, setRows] = useState<SubscriptionTransaction[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(isOnlineNow())

  const [status, setStatus] = useState<SubscriptionTransactionStatus | 'ALL'>('ALL')
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentMethod | 'ALL'>('ALL')
  const [tenantId, setTenantId] = useState<string>('ALL')
  const [agentFilter, setAgentFilter] = useState<string>('ALL')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [receiptData, setReceiptData] = useState<InitiationReceipt | null>(null)
  const [createDraft, setCreateDraft] = useState<{
    tenantId: string
    requestedPlanId: string
    paymentMethod: SubscriptionPaymentMethod
    billingCycle: 'MONTHLY' | 'YEARLY'
    notes: string
    activateManualImmediately: boolean
  }>({
    tenantId: '',
    requestedPlanId: '',
    paymentMethod: isAgent ? 'PAYSTACK' : 'MANUAL',
    billingCycle: 'MONTHLY',
    notes: '',
    activateManualImmediately: !isAgent,
  })
  const receiptPrintRef = useRef<HTMLDivElement>(null)
  const cacheKey = useMemo(
    () => getSuperadminCacheKey(`transactions:${status}:${paymentMethod}:${tenantId}`),
    [paymentMethod, status, tenantId]
  )

  const paymentMethodLabel = (method: SubscriptionPaymentMethod) => {
    if (method === 'PAYSTACK') return 'Online (Paystack)'
    if (method === 'TRANSFER') return 'Bank Transfer'
    return 'Cash (Manual)'
  }

  const load = async () => {
    setLoading(true)
    try {
      if (!isOnlineNow()) {
        const cached = readSuperadminCache<{
          rows: SubscriptionTransaction[]
          tenants: Tenant[]
          plans: Plan[]
          createDraft?: {
            tenantId: string
            requestedPlanId: string
            paymentMethod: SubscriptionPaymentMethod
            billingCycle: 'MONTHLY' | 'YEARLY'
            notes: string
            activateManualImmediately: boolean
          }
        }>(cacheKey)
        if (cached) {
          setRows(cached.rows || [])
          setTenants(cached.tenants || [])
          setPlans(cached.plans || [])
          if (cached.createDraft) {
            const cachedDraft = cached.createDraft
            setCreateDraft((prev) => ({
              ...prev,
              ...cachedDraft,
              activateManualImmediately: isAgent ? false : cachedDraft.activateManualImmediately,
            }))
          }
        }
        return
      }

      const params: Record<string, string> = {}
      if (status !== 'ALL') params.status = status
      if (paymentMethod !== 'ALL') params.paymentMethod = paymentMethod
      if (tenantId !== 'ALL') params.tenantId = tenantId

      const [txRes, tenantRes, planRes] = await Promise.all([
        api.get<{ data: SubscriptionTransaction[] }>('/subscriptions/transactions', { params }),
        api.get<{ data: Tenant[] }>('/tenants', { params: { page: 1, limit: 100 } }),
        api.get<{ data: Plan[] }>('/plans'),
      ])

      setRows(txRes.data.data || [])
      setTenants(tenantRes.data.data || [])
      const planRows = planRes.data.data || []
      setPlans(planRows)
      setCreateDraft((prev) => {
        const next = {
          ...prev,
          tenantId: prev.tenantId || tenantRes.data.data?.[0]?.id || '',
          requestedPlanId: prev.requestedPlanId || planRows[0]?.id || '',
          paymentMethod: prev.paymentMethod,
          activateManualImmediately: isAgent ? false : prev.activateManualImmediately,
        }

        if (typeof window !== 'undefined') {
          writeSuperadminCache(cacheKey, {
            rows: txRes.data.data || [],
            tenants: tenantRes.data.data || [],
            plans: planRows,
            createDraft: next,
            cachedAt: new Date().toISOString(),
          })
        }

        return next
      })
    } catch {
      toast.error('Failed to load transaction ledger')
    } finally {
      setLoading(false)
    }
  }

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.id === createDraft.tenantId) || null,
    [tenants, createDraft.tenantId]
  )

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === createDraft.requestedPlanId) || null,
    [plans, createDraft.requestedPlanId]
  )

  const amountBreakdown = useMemo(() => {
    const planPrice = selectedPlan ? Number(selectedPlan.price || 0) : 0
    let subscriptionAmount = planPrice

    if (selectedPlan && selectedPlan.billingCycle !== createDraft.billingCycle) {
      if (selectedPlan.billingCycle === 'MONTHLY' && createDraft.billingCycle === 'YEARLY') {
        subscriptionAmount = planPrice * 12
      } else if (selectedPlan.billingCycle === 'YEARLY' && createDraft.billingCycle === 'MONTHLY') {
        subscriptionAmount = planPrice / 12
      }
    }

    const normalizedSubscriptionAmount = Math.max(0, Math.round(subscriptionAmount * 100) / 100)
    const gatewayCharge = createDraft.paymentMethod === 'PAYSTACK'
      ? Math.max(0, Math.round((normalizedSubscriptionAmount * (paymentFeePercent / 100) + paymentFeeFixed) * 100) / 100)
      : 0
    const totalPayable = Math.round((normalizedSubscriptionAmount + gatewayCharge) * 100) / 100

    return {
      subscriptionAmount: normalizedSubscriptionAmount,
      gatewayCharge,
      totalPayable,
    }
  }, [createDraft.billingCycle, createDraft.paymentMethod, paymentFeeFixed, paymentFeePercent, selectedPlan])

  const rowsToDisplay = useMemo(() => {
    if (!isSuperAdmin || agentFilter === 'ALL') return rows
    if (agentFilter === 'UNASSIGNED') {
      const unassignedTenantIds = new Set(tenants.filter((tenant) => !tenant.acquisitionAgentId).map((tenant) => tenant.id))
      return rows.filter((row) => unassignedTenantIds.has(row.tenantId))
    }
    const tenantIdsForAgent = new Set(tenants.filter((tenant) => tenant.acquisitionAgentId === agentFilter).map((tenant) => tenant.id))
    return rows.filter((row) => tenantIdsForAgent.has(row.tenantId))
  }, [agentFilter, isSuperAdmin, rows, tenants])

  const tenantById = useMemo(() => {
    return new Map(tenants.map((tenant) => [tenant.id, tenant]))
  }, [tenants])

  const handlePrintReceipt = useReactToPrint({
    content: () => receiptPrintRef.current,
    documentTitle: receiptData ? `Subscription-Receipt-${receiptData.transactionId}` : 'Subscription-Receipt',
    pageStyle: '@page { size: A4; margin: 12mm; } body { background: #fff; }',
  })

  const initiateForTenant = async () => {
    if (!canInitiate) {
      toast.error('Only super admin or agent can initiate tenant subscription transactions')
      return
    }
    if (!createDraft.tenantId) {
      toast.error('Select a tenant')
      return
    }
    if (!createDraft.requestedPlanId) {
      toast.error('Select a plan')
      return
    }

    setConfirmOpen(true)
  }

  const confirmInitiation = async () => {
    if (!canInitiate) {
      toast.error('Only super admin or agent can initiate tenant subscription transactions')
      return
    }
    if (!isOnlineNow()) {
      toast.error('Reconnect to initiate subscription transactions')
      return
    }

    setCreating(true)
    try {
      const notePrefix = isSuperAdmin
        ? 'Initiated by SUPER_ADMIN for in-office renewal/upgrade'
        : 'Initiated by AGENT for tenant subscription payment'
      const createRes = await api.post<{ data: SubscriptionTransaction }>('/subscriptions/transactions', {
        tenantId: createDraft.tenantId,
        requestedPlanId: createDraft.requestedPlanId,
        paymentMethod: createDraft.paymentMethod,
        billingCycle: createDraft.billingCycle,
        notes: createDraft.notes ? `${notePrefix}. ${createDraft.notes}` : notePrefix,
      })

      const transactionId = createRes.data.data.id
      let finalStatus = createRes.data.data.status

      if (createDraft.paymentMethod === 'PAYSTACK') {
        const initRes = await api.post(`/subscriptions/transactions/${transactionId}/paystack-init`)
        const url = initRes.data?.payment?.authorizationUrl
        if (url) window.open(url, '_blank', 'noopener,noreferrer')
        toast.success('Transaction initiated. Share payment link with tenant.')
      } else if (isSuperAdmin && createDraft.paymentMethod === 'MANUAL' && createDraft.activateManualImmediately) {
        await api.post(`/subscriptions/transactions/${transactionId}/verify`, {
          note: 'Manual in-office payment confirmed by super admin',
        })
        finalStatus = 'ACTIVE'
        toast.success('Manual in-office payment confirmed and subscription activated')
      } else {
        toast.success('Transaction initiated. Awaiting payment verification.')
      }

      setReceiptData({
        transactionId,
        tenantName: selectedTenant?.name || createDraft.tenantId,
        planName: selectedPlan?.name || createDraft.requestedPlanId,
        paymentMethod: createDraft.paymentMethod,
        billingCycle: createDraft.billingCycle,
        amount: Number(createRes.data.data.amount),
        currency: createRes.data.data.currency,
        status: finalStatus,
        createdAt: new Date().toISOString(),
        initiatedBy: user ? `${user.firstName} ${user.lastName}`.trim() : 'SUPER_ADMIN',
        notes: createDraft.notes,
      })

      setConfirmOpen(false)

      await load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'You can only initiate transactions for your own business or organization')
    } finally {
      setCreating(false)
    }
  }

  useEffect(() => {
    void load()
  }, [cacheKey])

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      void load()
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [cacheKey])

  const exportCsv = async () => {
    try {
      if (!isOnlineNow()) {
        const escapeCell = (value: unknown) => {
          const text = String(value ?? '')
          if (text.includes(',') || text.includes('"') || text.includes('\n')) {
            return `"${text.replace(/"/g, '""')}"`
          }
          return text
        }

        const header = [
          'id',
          'createdAt',
          'tenantId',
          'tenantName',
          'registeredAgent',
          'requestedPlan',
          'changeType',
          'paymentMethod',
          'status',
          'amount',
          'currency',
          'paystackReference',
          'transferProofUrl',
        ]

        const lines = rowsToDisplay.map((row) => {
          const tenant = tenantById.get(row.tenantId)
          const agentName = tenant?.acquisitionAgent
            ? `${tenant.acquisitionAgent.firstName} ${tenant.acquisitionAgent.lastName}`
            : ''

          return [
            row.id,
            row.createdAt,
            row.tenantId,
            row.tenant?.name || row.tenantId,
            agentName,
            row.requestedPlan?.name || row.requestedPlanId,
            row.changeType,
            row.paymentMethod,
            row.status,
            Number(row.amount || 0).toFixed(2),
            row.currency,
            row.paystackReference || '',
            row.transferProofUrl || '',
          ]
        })

        const csv = [header, ...lines].map((line) => line.map(escapeCell).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `subscription-transactions-${Date.now()}.csv`
        a.click()
        window.URL.revokeObjectURL(url)
        return
      }

      if (isSuperAdmin && agentFilter !== 'ALL') {
        const escapeCell = (value: unknown) => {
          const text = String(value ?? '')
          if (text.includes(',') || text.includes('"') || text.includes('\n')) {
            return `"${text.replace(/"/g, '""')}"`
          }
          return text
        }

        const header = [
          'id',
          'createdAt',
          'tenantId',
          'tenantName',
          'registeredAgent',
          'requestedPlan',
          'changeType',
          'paymentMethod',
          'status',
          'amount',
          'currency',
          'paystackReference',
          'transferProofUrl',
        ]

        const lines = rowsToDisplay.map((row) => {
          const tenant = tenantById.get(row.tenantId)
          const agentName = tenant?.acquisitionAgent
            ? `${tenant.acquisitionAgent.firstName} ${tenant.acquisitionAgent.lastName}`
            : ''

          return [
            row.id,
            row.createdAt,
            row.tenantId,
            row.tenant?.name || row.tenantId,
            agentName,
            row.requestedPlan?.name || row.requestedPlanId,
            row.changeType,
            row.paymentMethod,
            row.status,
            Number(row.amount || 0).toFixed(2),
            row.currency,
            row.paystackReference || '',
            row.transferProofUrl || '',
          ]
        })

        const csv = [header, ...lines].map((line) => line.map(escapeCell).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `subscription-transactions-${Date.now()}.csv`
        a.click()
        window.URL.revokeObjectURL(url)
        return
      }

      const params: Record<string, string> = { format: 'csv' }
      if (status !== 'ALL') params.status = status
      if (paymentMethod !== 'ALL') params.paymentMethod = paymentMethod
      if (tenantId !== 'ALL') params.tenantId = tenantId

      const response = await api.get('/subscriptions/transactions', {
        params,
        responseType: 'blob',
      })

      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `subscription-transactions-${Date.now()}.csv`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('CSV export failed')
    }
  }

  const activateRequest = async (row: SubscriptionTransaction) => {
    if (!isOnlineNow()) {
      toast.error('Reconnect to activate subscription requests')
      return
    }

    if (row.paymentMethod === 'PAYSTACK' && !row.paystackReference) {
      toast.error('Cannot verify Paystack payment yet: missing payment reference on this transaction.')
      return
    }

    setActionLoading(`activate-${row.id}`)
    try {
      if (row.paymentMethod === 'TRANSFER') {
        await api.post(`/subscriptions/transactions/${row.id}/verify`, {
          approveTransfer: true,
          note: 'Approved and activated by super admin',
        })
      } else if (row.paymentMethod === 'MANUAL') {
        await api.post(`/subscriptions/transactions/${row.id}/verify`, {
          note: 'Manual payment confirmed and activated by super admin',
        })
      } else {
        await api.post(`/subscriptions/transactions/${row.id}/verify`, {
          reference: row.paystackReference,
        })
      }
      toast.success('Subscription request activated')
      await load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'Activation failed')
    } finally {
      setActionLoading(null)
    }
  }

  const rejectRequest = async (row: SubscriptionTransaction) => {
    if (!isOnlineNow()) {
      toast.error('Reconnect to reject subscription requests')
      return
    }

    setActionLoading(`reject-${row.id}`)
    try {
      if (row.paymentMethod === 'TRANSFER') {
        await api.post(`/subscriptions/transactions/${row.id}/verify`, {
          rejectTransfer: true,
          note: 'Rejected by super admin',
        })
      } else {
        await api.patch(`/subscriptions/transactions/${row.id}`, {
          status: 'REJECTED',
          notes: 'Rejected by super admin',
        })
      }
      toast.success('Subscription request rejected')
      await load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'Rejection failed')
    } finally {
      setActionLoading(null)
    }
  }

  const cancelRequest = async (row: SubscriptionTransaction) => {
    if (!isOnlineNow()) {
      toast.error('Reconnect to cancel subscription requests')
      return
    }

    setActionLoading(`cancel-${row.id}`)
    try {
      await api.patch(`/subscriptions/transactions/${row.id}`, {
        status: 'CANCELLED',
        notes: 'Cancelled by super admin',
      })
      toast.success('Subscription request cancelled')
      await load()
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(message || 'Cancel failed')
    } finally {
      setActionLoading(null)
    }
  }

  const canActivate = (row: SubscriptionTransaction) => {
    if (isAgent) {
      return row.status === 'PENDING_PAYMENT' && row.paymentMethod === 'PAYSTACK' && !!row.paystackReference
    }
    if (row.status === 'PENDING_VERIFICATION' && (row.paymentMethod === 'TRANSFER' || row.paymentMethod === 'MANUAL')) return true
    if (row.status === 'PENDING_PAYMENT' && row.paymentMethod === 'PAYSTACK' && !!row.paystackReference) return true
    return false
  }

  const canReject = (row: SubscriptionTransaction) => {
    if (isAgent) return false
    return row.status === 'PENDING_VERIFICATION' || row.status === 'PENDING_PAYMENT'
  }

  const canCancel = (row: SubscriptionTransaction) => {
    if (isAgent) return false
    return row.status === 'PENDING_VERIFICATION' || row.status === 'PENDING_PAYMENT'
  }

  const getRowTone = (statusValue: SubscriptionTransactionStatus) => {
    if (statusValue === 'ACTIVE') return 'bg-emerald-50/55 border-l-4 border-emerald-400 hover:bg-emerald-100/60'
    if (statusValue === 'PENDING_VERIFICATION') return 'bg-amber-50/60 border-l-4 border-amber-400 hover:bg-amber-100/60'
    if (statusValue === 'PENDING_PAYMENT') return 'bg-sky-50/60 border-l-4 border-sky-400 hover:bg-sky-100/60'
    if (statusValue === 'REJECTED' || statusValue === 'CANCELLED') return 'bg-rose-50/60 border-l-4 border-rose-400 hover:bg-rose-100/60'
    if (statusValue === 'VERIFIED') return 'bg-indigo-50/60 border-l-4 border-indigo-400 hover:bg-indigo-100/60'
    return 'hover:bg-gray-50'
  }

  const formatDateTime = (value?: string | null) => {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleString()
  }

  const normalizeProofUrl = (value: unknown) => {
    if (typeof value !== 'string') return ''
    const trimmed = value.trim()
    if (!trimmed) return ''
    return trimmed.startsWith('http') ? trimmed : `${apiOrigin}${trimmed}`
  }

  const summary = useMemo(() => {
    const active = rowsToDisplay.filter((r) => r.status === 'ACTIVE').length
    const pending = rowsToDisplay.filter((r) => r.status === 'PENDING_PAYMENT' || r.status === 'PENDING_VERIFICATION').length
    return { total: rowsToDisplay.length, active, pending }
  }, [rowsToDisplay])

  const displayActor = (row: SubscriptionTransaction, kind: 'initiated' | 'verified' | 'activated') => {
    const actor = kind === 'initiated' ? row.initiatedBy : kind === 'verified' ? row.verifiedBy : row.activatedBy
    const id = kind === 'initiated' ? row.initiatedByUserId : kind === 'verified' ? row.verifiedByUserId : row.activatedByUserId
    if (actor) {
      return `${actor.firstName} ${actor.lastName}`.trim()
    }
    return id || '-'
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription Transaction Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">Audit lifecycle from initiation to activation, including payment and proof metadata.</p>
          {!isOnline && <p className="text-xs text-amber-600 mt-1">Offline mode: showing cached transactions.</p>}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button className="btn-primary" onClick={exportCsv}>
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-gray-500 uppercase">Total Records</p><p className="text-2xl font-bold text-gray-900 mt-1">{summary.total}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500 uppercase">Active</p><p className="text-2xl font-bold text-success-700 mt-1">{summary.active}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-500 uppercase">Pending</p><p className="text-2xl font-bold text-warning-700 mt-1">{summary.pending}</p></div>
      </div>

      <div className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionTransactionStatus | 'ALL')}>
            {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Payment Method</label>
          <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as SubscriptionPaymentMethod | 'ALL')}>
            {paymentMethodOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-600 mb-1">Tenant</label>
          <select className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="ALL">All tenants</option>
            {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
          </select>
        </div>
      </div>

      {isSuperAdmin && (
        <div className="card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Registered Agent</label>
            <select className="input" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
              <option value="ALL">All agents</option>
              <option value="UNASSIGNED">Unassigned</option>
              {Array.from(new Map(
                tenants
                  .filter((tenant) => tenant.acquisitionAgent)
                  .map((tenant) => [tenant.acquisitionAgent!.id, tenant.acquisitionAgent!])
              ).values()).map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.firstName} {agent.lastName}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="card p-4 space-y-3 border border-indigo-100 bg-indigo-50/50">
        <div>
          <h2 className="text-sm font-semibold text-indigo-900">Initiate Tenant Renewal/Upgrade</h2>
          <p className="text-xs text-indigo-700 mt-1">
            {isSuperAdmin
              ? 'Use this when a tenant visits the physical office and needs super-admin assisted renewal or upgrade.'
              : 'Use this to initiate online subscription payment for tenants assigned to your agent account.'}
          </p>
        </div>
        {isAgent && (
          <p className="text-xs text-indigo-700 bg-indigo-100 border border-indigo-200 rounded-md p-2">
            Agent accounts can initiate Online (Paystack), Bank Transfer, and Cash (Manual). Only online payments can be activated by agents.
          </p>
        )}
        {!isSuperAdmin && !isAgent && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            This initiation function is only permitted for super admin and agent accounts.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-indigo-700 mb-1">Tenant</label>
            <select
              className="input"
              value={createDraft.tenantId}
              disabled={!canInitiate}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, tenantId: e.target.value }))}
            >
              <option value="">Select tenant</option>
              {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-indigo-700 mb-1">Plan</label>
            <select
              className="input"
              value={createDraft.requestedPlanId}
              disabled={!canInitiate}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, requestedPlanId: e.target.value }))}
            >
              <option value="">Select plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name} ({Number(plan.price).toFixed(2)} {plan.priceCurrency})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-indigo-700 mb-1">Payment Method</label>
            <select
              className="input"
              value={createDraft.paymentMethod}
              disabled={!canInitiate}
              onChange={(e) => setCreateDraft((prev) => ({
                ...prev,
                paymentMethod: e.target.value as SubscriptionPaymentMethod,
                activateManualImmediately: e.target.value === 'MANUAL' ? prev.activateManualImmediately : false,
              }))}
            >
              <option value="PAYSTACK">Online (Paystack)</option>
              <option value="TRANSFER">Bank Transfer</option>
              <option value="MANUAL">Cash (Manual/Physical)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-indigo-700 mb-1">Billing Cycle</label>
            <select
              className="input"
              value={createDraft.billingCycle}
              disabled={!canInitiate}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, billingCycle: e.target.value as 'MONTHLY' | 'YEARLY' }))}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs text-indigo-700 mb-1">Notes</label>
            <input
              className="input"
              value={createDraft.notes}
              disabled={!canInitiate}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Optional context about the in-office request"
            />
          </div>
        </div>
        {isSuperAdmin && createDraft.paymentMethod === 'MANUAL' && (
          <label className="flex items-center gap-2 text-xs text-indigo-800">
            <input
              type="checkbox"
              checked={createDraft.activateManualImmediately}
              disabled={!isSuperAdmin}
              onChange={(e) => setCreateDraft((prev) => ({ ...prev, activateManualImmediately: e.target.checked }))}
            />
            Activate immediately after creating transaction
          </label>
        )}
        <div>
          <button className="btn-primary" onClick={initiateForTenant} disabled={creating || !canInitiate}>
            {creating ? 'Initiating...' : 'Initiate for Tenant'}
          </button>
        </div>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Confirm Subscription Initiation</h3>
              <p className="text-sm text-gray-500 mt-1">Please confirm this action before creating the transaction.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Tenant</p><p className="font-medium text-gray-900">{selectedTenant?.name || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Plan</p><p className="font-medium text-gray-900">{selectedPlan?.name || '-'}</p></div>
              <div><p className="text-xs text-gray-500">Payment</p><p className="font-medium text-gray-900">{paymentMethodLabel(createDraft.paymentMethod)}</p></div>
              <div><p className="text-xs text-gray-500">Billing Cycle</p><p className="font-medium text-gray-900">{createDraft.billingCycle}</p></div>
            </div>
            {createDraft.notes && (
              <div>
                <p className="text-xs text-gray-500">Note</p>
                <p className="text-sm text-gray-700">{createDraft.notes}</p>
              </div>
            )}
            <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Payment Breakdown</p>
              <div className="mt-2 space-y-1.5 text-sm">
                <div className="flex items-center justify-between text-gray-700">
                  <span>Subscription Amount</span>
                  <span className="font-medium">{amountBreakdown.subscriptionAmount.toFixed(2)} {selectedPlan?.priceCurrency || 'USD'}</span>
                </div>
                <div className="flex items-center justify-between text-gray-700">
                  <span>{createDraft.paymentMethod === 'PAYSTACK' ? 'Gateway Charge' : 'Gateway Charge'}</span>
                  <span className="font-medium">{amountBreakdown.gatewayCharge.toFixed(2)} {selectedPlan?.priceCurrency || 'USD'}</span>
                </div>
                <div className="my-1 border-t border-indigo-200" />
                <div className="flex items-center justify-between text-gray-900">
                  <span className="font-semibold">Total Payable</span>
                  <span className="text-base font-bold">{amountBreakdown.totalPayable.toFixed(2)} {selectedPlan?.priceCurrency || 'USD'}</span>
                </div>
                {createDraft.paymentMethod === 'PAYSTACK' && (paymentFeePercent > 0 || paymentFeeFixed > 0) && (
                  <p className="text-[11px] text-indigo-700">
                    Charge formula: {paymentFeePercent.toFixed(2)}% + {paymentFeeFixed.toFixed(2)} {selectedPlan?.priceCurrency || 'USD'}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={creating}>Cancel</button>
              <button className="btn-primary" onClick={confirmInitiation} disabled={creating}>
                {creating ? 'Confirming...' : 'Confirm & Initiate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Subscription Transaction Receipt</h3>
                <p className="text-sm text-gray-500">Generated after confirmed super-admin initiation.</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={handlePrintReceipt}>Print</button>
                <button className="btn-secondary" onClick={() => setReceiptData(null)}>Close</button>
              </div>
            </div>

            <div ref={receiptPrintRef} className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
              <div className="text-center border-b pb-3">
                <p className="text-xl font-bold text-gray-900">StockPilot Pro</p>
                <p className="text-sm text-gray-600">Platform Subscription Receipt</p>
                <p className="text-xs text-gray-500 mt-1">Receipt Ref: STX-{receiptData.transactionId.slice(-8).toUpperCase()}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs text-gray-500">Tenant</p><p className="font-medium text-gray-900">{receiptData.tenantName}</p></div>
                <div><p className="text-xs text-gray-500">Plan</p><p className="font-medium text-gray-900">{receiptData.planName}</p></div>
                <div><p className="text-xs text-gray-500">Payment Method</p><p className="font-medium text-gray-900">{receiptData.paymentMethod}</p></div>
                <div><p className="text-xs text-gray-500">Billing Cycle</p><p className="font-medium text-gray-900">{receiptData.billingCycle}</p></div>
                <div><p className="text-xs text-gray-500">Amount</p><p className="font-medium text-gray-900">{receiptData.amount.toFixed(2)} {receiptData.currency}</p></div>
                <div><p className="text-xs text-gray-500">Status</p><p className="font-medium text-gray-900">{receiptData.status}</p></div>
                <div><p className="text-xs text-gray-500">Initiated By</p><p className="font-medium text-gray-900">{receiptData.initiatedBy}</p></div>
                <div><p className="text-xs text-gray-500">Created At</p><p className="font-medium text-gray-900">{new Date(receiptData.createdAt).toLocaleString()}</p></div>
              </div>
              {receiptData.notes && (
                <div>
                  <p className="text-xs text-gray-500">Notes</p>
                  <p className="text-sm text-gray-700">{receiptData.notes}</p>
                </div>
              )}
              <div className="border-t pt-4 text-center">
                <p className="text-xs text-gray-500 mb-2">Verification QR (scan to retrieve transaction reference)</p>
                <div className="inline-flex flex-col items-center justify-center bg-white p-2">
                  <QRCodeSVG
                    value={`TX:${receiptData.transactionId}|TENANT:${receiptData.tenantName}|AMT:${receiptData.amount.toFixed(2)}${receiptData.currency}`}
                    size={132}
                    level="M"
                    includeMargin
                  />
                  <p className="mt-2 max-w-xs break-all text-[11px] text-gray-500">
                    TX: {receiptData.transactionId}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Change</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Payment</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Effective Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actors</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Proof</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Loading transactions...</td></tr>
              ) : rowsToDisplay.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No transactions found.</td></tr>
              ) : rowsToDisplay.map((row) => (
                <tr key={row.id} className={getRowTone(row.status)}>
                  <td className="px-4 py-3 text-gray-700">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.tenant?.name || row.tenantId}</p>
                    <p className="text-xs text-gray-500">{row.id}</p>
                    {tenantById.get(row.tenantId)?.acquisitionAgent && (
                      <p className="mt-1 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                        Agent: {tenantById.get(row.tenantId)?.acquisitionAgent?.firstName} {tenantById.get(row.tenantId)?.acquisitionAgent?.lastName}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.requestedPlan?.name || row.requestedPlanId}</td>
                  <td className="px-4 py-3 text-gray-700">{row.changeType}</td>
                  <td className="px-4 py-3 text-gray-700">{row.paymentMethod} ({Number(row.amount || 0).toFixed(2)} {row.currency})</td>
                  <td className="px-4 py-3"><span className="badge badge-info">{row.status}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {row.activatedAt
                      ? formatDateTime(row.activatedAt)
                      : row.subscription?.startDate
                        ? formatDateTime(row.subscription.startDate)
                        : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <p>Initiated: {displayActor(row, 'initiated')}</p>
                    <p>Verified: {displayActor(row, 'verified')}</p>
                    <p>Activated: {displayActor(row, 'activated')}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {normalizeProofUrl(row.transferProofUrl) ? (
                      <div className="space-y-1">
                        <a
                          className="text-primary-600 hover:underline"
                          href={normalizeProofUrl(row.transferProofUrl)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open proof
                        </a>
                        <p>{row.transferProofOriginalName || '-'}</p>
                        <p>{row.transferProofContentType || '-'} {row.transferProofSize ? `(${row.transferProofSize} bytes)` : ''}</p>
                        <p>Uploader: {row.transferProofUploadedByUserId || '-'}</p>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {canActivate(row) && (
                        <button
                          className="btn-primary"
                          onClick={() => void activateRequest(row)}
                          disabled={actionLoading === `activate-${row.id}`}
                        >
                          {actionLoading === `activate-${row.id}`
                            ? (row.paymentMethod === 'PAYSTACK' ? 'Verifying...' : 'Activating...')
                            : (row.paymentMethod === 'PAYSTACK' ? 'Verify Payment' : 'Activate')}
                        </button>
                      )}
                      {canReject(row) && (
                        <button
                          className="btn-secondary"
                          onClick={() => void rejectRequest(row)}
                          disabled={actionLoading === `reject-${row.id}`}
                        >
                          {actionLoading === `reject-${row.id}` ? 'Rejecting...' : 'Reject'}
                        </button>
                      )}
                      {canCancel(row) && (
                        <button
                          className="btn-secondary"
                          onClick={() => void cancelRequest(row)}
                          disabled={actionLoading === `cancel-${row.id}`}
                        >
                          {actionLoading === `cancel-${row.id}` ? 'Cancelling...' : 'Cancel'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
