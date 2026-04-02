import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Download, RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import type { SubscriptionPaymentMethod, SubscriptionTransaction, SubscriptionTransactionStatus, Tenant } from '@/types'

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

export default function SubscriptionTransactionsPage() {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  const apiOrigin = apiBase.startsWith('http') ? new URL(apiBase).origin : window.location.origin

  const [rows, setRows] = useState<SubscriptionTransaction[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const [status, setStatus] = useState<SubscriptionTransactionStatus | 'ALL'>('ALL')
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentMethod | 'ALL'>('ALL')
  const [tenantId, setTenantId] = useState<string>('ALL')

  const load = async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (status !== 'ALL') params.status = status
      if (paymentMethod !== 'ALL') params.paymentMethod = paymentMethod
      if (tenantId !== 'ALL') params.tenantId = tenantId

      const [txRes, tenantRes] = await Promise.all([
        api.get<{ data: SubscriptionTransaction[] }>('/subscriptions/transactions', { params }),
        api.get<{ data: Tenant[] }>('/tenants', { params: { page: 1, limit: 100 } }),
      ])

      setRows(txRes.data.data || [])
      setTenants(tenantRes.data.data || [])
    } catch {
      toast.error('Failed to load transaction ledger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [status, paymentMethod, tenantId])

  const exportCsv = async () => {
    try {
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
    if (row.status === 'PENDING_VERIFICATION' && (row.paymentMethod === 'TRANSFER' || row.paymentMethod === 'MANUAL')) return true
    if (row.status === 'PENDING_PAYMENT' && row.paymentMethod === 'PAYSTACK') return true
    return false
  }

  const canReject = (row: SubscriptionTransaction) => {
    return row.status === 'PENDING_VERIFICATION' || row.status === 'PENDING_PAYMENT'
  }

  const canCancel = (row: SubscriptionTransaction) => {
    return row.status === 'PENDING_VERIFICATION' || row.status === 'PENDING_PAYMENT'
  }

  const summary = useMemo(() => {
    const active = rows.filter((r) => r.status === 'ACTIVE').length
    const pending = rows.filter((r) => r.status === 'PENDING_PAYMENT' || r.status === 'PENDING_VERIFICATION').length
    return { total: rows.length, active, pending }
  }, [rows])

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
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No transactions found.</td></tr>
              ) : rows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.tenant?.name || row.tenantId}</p>
                    <p className="text-xs text-gray-500">{row.id}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{row.requestedPlan?.name || row.requestedPlanId}</td>
                  <td className="px-4 py-3 text-gray-700">{row.changeType}</td>
                  <td className="px-4 py-3 text-gray-700">{row.paymentMethod} ({Number(row.amount).toFixed(2)} {row.currency})</td>
                  <td className="px-4 py-3"><span className="badge badge-info">{row.status}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {row.activatedAt
                      ? new Date(row.activatedAt).toLocaleString()
                      : row.subscription?.startDate
                        ? new Date(row.subscription.startDate).toLocaleString()
                        : '-'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <p>Initiated: {displayActor(row, 'initiated')}</p>
                    <p>Verified: {displayActor(row, 'verified')}</p>
                    <p>Activated: {displayActor(row, 'activated')}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {row.transferProofUrl ? (
                      <div className="space-y-1">
                        <a
                          className="text-primary-600 hover:underline"
                          href={row.transferProofUrl.startsWith('http') ? row.transferProofUrl : `${apiOrigin}${row.transferProofUrl}`}
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
                          {actionLoading === `activate-${row.id}` ? 'Activating...' : 'Activate'}
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
