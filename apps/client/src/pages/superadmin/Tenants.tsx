import { useState, useEffect } from 'react'
import api from '@/lib/api'
import type { Tenant, Plan, SubscriptionTransaction } from '@/types'
import toast from 'react-hot-toast'
import { Plus, Building, Edit, X, Loader2, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Shield } from 'lucide-react'

interface TenantForm { name: string; email: string; phone: string; address: string }
const emptyForm: TenantForm = { name: '', email: '', phone: '', address: '' }

interface SsoSettings { ssoEnabled: boolean; ssoProviders: string[] }

function makeSlug(input: string) {
  return input.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

export default function TenantsPage() {
  const apiBase = import.meta.env.VITE_API_URL || '/api'
  const apiOrigin = apiBase.startsWith('http') ? new URL(apiBase).origin : window.location.origin

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modal, setModal] = useState<{ open: boolean; tenant: Tenant | null }>({ open: false, tenant: null })
  const [form, setForm] = useState<TenantForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  // SSO management state per tenant
  const [ssoSettings, setSsoSettings] = useState<Record<string, SsoSettings>>({})
  const [ssoSaving, setSsoSaving] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [pendingTransactions, setPendingTransactions] = useState<Record<string, SubscriptionTransaction[]>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [initiateDraft, setInitiateDraft] = useState<Record<string, { requestedPlanId: string; paymentMethod: 'PAYSTACK' | 'TRANSFER' | 'MANUAL'; billingCycle: 'MONTHLY' | 'YEARLY'; note: string }>>({})

  const load = async () => {
    setLoading(true)
    try {
      const [tenantRes, planRes] = await Promise.all([
        api.get<{ data: Tenant[] }>('/tenants'),
        api.get<{ data: Plan[] }>('/plans'),
      ])
      setTenants(tenantRes.data.data)
      setPlans(planRes.data.data || [])
    } catch { toast.error('Failed to load tenants') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const loadSsoSettings = async (tenantId: string) => {
    if (ssoSettings[tenantId]) return
    try {
      const res = await api.get<{ data: SsoSettings }>(`/tenants/${tenantId}/sso`)
      setSsoSettings((prev) => ({ ...prev, [tenantId]: res.data.data }))
    } catch {
      setSsoSettings((prev) => ({ ...prev, [tenantId]: { ssoEnabled: false, ssoProviders: [] } }))
    }
  }

  const handleExpand = (id: string) => {
    const next = expanded === id ? null : id
    setExpanded(next)
    if (next) {
      loadSsoSettings(next)
      void loadPendingTransactions(next)
      setInitiateDraft((prev) => {
        if (prev[next]) return prev
        return {
          ...prev,
          [next]: {
            requestedPlanId: plans[0]?.id || '',
            paymentMethod: 'TRANSFER',
            billingCycle: 'MONTHLY',
            note: '',
          },
        }
      })
    }
  }

  const loadPendingTransactions = async (tenantId: string) => {
    try {
      const res = await api.get<{ data: SubscriptionTransaction[] }>('/subscriptions/transactions', {
        params: { tenantId, status: 'PENDING_VERIFICATION' },
      })
      setPendingTransactions((prev) => ({ ...prev, [tenantId]: res.data.data || [] }))
    } catch {
      setPendingTransactions((prev) => ({ ...prev, [tenantId]: [] }))
    }
  }

  const initiateSubscription = async (tenantId: string) => {
    const draft = initiateDraft[tenantId]
    if (!draft?.requestedPlanId) {
      toast.error('Select a plan first')
      return
    }

    setActionLoading(`init-${tenantId}`)
    try {
      const createRes = await api.post<{ data: SubscriptionTransaction }>('/subscriptions/transactions', {
        tenantId,
        requestedPlanId: draft.requestedPlanId,
        billingCycle: draft.billingCycle,
        paymentMethod: draft.paymentMethod,
        notes: draft.note || undefined,
      })

      if (draft.paymentMethod === 'PAYSTACK') {
        const initRes = await api.post(`/subscriptions/transactions/${createRes.data.data.id}/paystack-init`)
        const url = initRes.data?.payment?.authorizationUrl
        if (url) window.open(url, '_blank', 'noopener,noreferrer')
      }

      if (draft.paymentMethod === 'MANUAL') {
        await api.post(`/subscriptions/transactions/${createRes.data.data.id}/verify`, {
          note: draft.note || 'Manual payment confirmed by super admin',
        })
        toast.success('Subscription activated successfully')
      } else {
        toast.success('Subscription transaction initiated')
      }

      await Promise.all([load(), loadPendingTransactions(tenantId)])
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to initiate')
    } finally {
      setActionLoading(null)
    }
  }

  const approveTransfer = async (tenantId: string, transactionId: string, approve: boolean) => {
    setActionLoading(`${approve ? 'approve' : 'reject'}-${transactionId}`)
    try {
      await api.post(`/subscriptions/transactions/${transactionId}/verify`, approve ? { approveTransfer: true } : { rejectTransfer: true })
      toast.success(approve ? 'Transfer approved and subscription activated' : 'Transfer rejected')
      await Promise.all([load(), loadPendingTransactions(tenantId)])
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  const cancelTransferRequest = async (tenantId: string, transactionId: string) => {
    setActionLoading(`cancel-${transactionId}`)
    try {
      await api.patch(`/subscriptions/transactions/${transactionId}`, {
        status: 'CANCELLED',
        notes: 'Cancelled by super admin',
      })
      toast.success('Transfer request cancelled')
      await Promise.all([load(), loadPendingTransactions(tenantId)])
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Cancel failed')
    } finally {
      setActionLoading(null)
    }
  }

  const handleSsoToggle = async (tenantId: string, provider: string, checked: boolean) => {
    const current = ssoSettings[tenantId] || { ssoEnabled: false, ssoProviders: [] }
    const newProviders = checked
      ? [...new Set([...current.ssoProviders, provider])]
      : current.ssoProviders.filter((p) => p !== provider)
    const newEnabled = newProviders.length > 0
    setSsoSettings((prev) => ({ ...prev, [tenantId]: { ssoEnabled: newEnabled, ssoProviders: newProviders } }))
  }

  const saveSsoSettings = async (tenantId: string) => {
    const settings = ssoSettings[tenantId]
    if (!settings) return
    setSsoSaving(tenantId)
    try {
      await api.patch(`/tenants/${tenantId}/sso`, { ssoEnabled: settings.ssoEnabled, ssoProviders: settings.ssoProviders })
      toast.success('SSO settings saved')
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save SSO settings')
    } finally { setSsoSaving(null) }
  }

  const openCreate = () => { setForm(emptyForm); setModal({ open: true, tenant: null }) }
  const openEdit = (t: Tenant) => { setForm({ name: t.name, email: t.email || '', phone: t.phone || '', address: '' }); setModal({ open: true, tenant: t }) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      if (modal.tenant) {
        await api.put(`/tenants/${modal.tenant.id}`, { ...form, isActive: true })
        toast.success('Tenant updated')
      } else {
        await api.post('/tenants', { ...form, slug: makeSlug(form.name) })
        toast.success('Tenant created')
      }
      setModal({ open: false, tenant: null }); load()
    } catch (err: unknown) { toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed') }
    finally { setSaving(false) }
  }

  const toggleArchive = async (t: Tenant) => {
    try { await api.put(`/tenants/${t.id}`, { isActive: !t.isActive }); toast.success(t.isActive ? 'Tenant suspended' : 'Tenant activated'); load() }
    catch { toast.error('Failed') }
  }

  const filtered = tenants.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()) || (t.email || '').toLowerCase().includes(search.toLowerCase()))

  const subStatus = (t: Tenant) => {
    const sub = t.subscriptions?.[0]
    if (!sub) return { label: 'No Plan', color: 'badge-danger' }
    if (sub.status === 'ACTIVE') return { label: 'Active', color: 'badge-success' }
    if (sub.status === 'SUSPENDED') return { label: 'Suspended', color: 'badge-warning' }
    return { label: 'Expired', color: 'badge-danger' }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Tenants</h1><p className="text-sm text-gray-500 mt-0.5">{tenants.length} registered business{tenants.length !== 1 ? 'es' : ''}</p></div>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Tenant</button>
      </div>

      <input className="input max-w-sm" placeholder="Search tenants..." value={search} onChange={(e) => setSearch(e.target.value)} />

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400"><Building className="w-12 h-12 mb-2 opacity-30" /><p>No tenants found</p></div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => {
            const { label, color } = subStatus(t)
            const sub = t.subscriptions?.[0]
            const sso = ssoSettings[t.id]
            return (
              <div key={t.id} className={`card transition-opacity ${!t.isActive ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => handleExpand(t.id)}>
                    <div className="p-2 bg-indigo-50 rounded-xl"><Building className="w-5 h-5 text-indigo-600" /></div>
                    <div>
                      <p className="font-semibold text-gray-800">{t.name}</p>
                      <p className="text-xs text-gray-500">{t.email}</p>
                    </div>
                    <span className={`badge ml-2 ${color}`}>{label}</span>
                    {sub?.plan && <span className="badge badge-info ml-1">{sub.plan.name}</span>}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => toggleArchive(t)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title={t.isActive ? 'Suspend' : 'Activate'}>
                      {t.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleExpand(t.id)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                      {expanded === t.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                {expanded === t.id && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div><p className="text-gray-400 text-xs">Phone</p><p className="text-gray-700">{t.phone || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs">Address</p><p className="text-gray-700">—</p></div>
                      <div><p className="text-gray-400 text-xs">Plan</p><p className="text-gray-700">{sub?.plan?.name || '—'}</p></div>
                      <div><p className="text-gray-400 text-xs">Expires</p><p className="text-gray-700">{sub?.expiryDate ? new Date(sub.expiryDate).toLocaleDateString() : '—'}</p></div>
                    </div>

                    {/* SSO Settings */}
                    <div className="bg-gray-50 rounded-xl p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Shield className="w-4 h-4 text-indigo-500" />
                        <span className="text-sm font-semibold text-gray-700">SSO Authentication</span>
                      </div>
                      {!sso ? (
                        <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-xs text-gray-500">Enable Single Sign-On for BUSINESS_ADMIN accounts in this tenant.</p>
                          <div className="flex flex-wrap gap-4">
                            {['google', 'microsoft'].map((provider) => (
                              <label key={provider} className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 rounded accent-indigo-600"
                                  checked={sso.ssoProviders.includes(provider)}
                                  onChange={(e) => handleSsoToggle(t.id, provider, e.target.checked)}
                                />
                                <span className="text-sm text-gray-700 capitalize">{provider}</span>
                              </label>
                            ))}
                          </div>
                          <div className="flex items-center gap-3 pt-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sso.ssoEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                              {sso.ssoEnabled ? 'SSO Enabled' : 'SSO Disabled'}
                            </span>
                            <button
                              onClick={() => saveSsoSettings(t.id)}
                              disabled={ssoSaving === t.id}
                              className="btn-primary text-xs px-3 py-1.5"
                            >
                              {ssoSaving === t.id && <Loader2 className="w-3 h-3 animate-spin" />}
                              Save SSO Settings
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="bg-indigo-50 rounded-xl p-4 space-y-3">
                      <p className="text-sm font-semibold text-indigo-800">Subscription Actions (Super Admin)</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-indigo-700 mb-1">Plan</label>
                          <select
                            className="input"
                            value={initiateDraft[t.id]?.requestedPlanId || ''}
                            onChange={(e) => setInitiateDraft((prev) => ({
                              ...prev,
                              [t.id]: {
                                ...(prev[t.id] || { paymentMethod: 'TRANSFER', billingCycle: 'MONTHLY', note: '' }),
                                requestedPlanId: e.target.value,
                              },
                            }))}
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
                            value={initiateDraft[t.id]?.paymentMethod || 'TRANSFER'}
                            onChange={(e) => setInitiateDraft((prev) => ({
                              ...prev,
                              [t.id]: {
                                ...(prev[t.id] || { requestedPlanId: '', billingCycle: 'MONTHLY', note: '' }),
                                paymentMethod: e.target.value as 'PAYSTACK' | 'TRANSFER' | 'MANUAL',
                              },
                            }))}
                          >
                            <option value="PAYSTACK">Paystack</option>
                            <option value="TRANSFER">Transfer</option>
                            <option value="MANUAL">Manual/Physical</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-indigo-700 mb-1">Billing Cycle</label>
                          <select
                            className="input"
                            value={initiateDraft[t.id]?.billingCycle || 'MONTHLY'}
                            onChange={(e) => setInitiateDraft((prev) => ({
                              ...prev,
                              [t.id]: {
                                ...(prev[t.id] || { requestedPlanId: '', paymentMethod: 'TRANSFER', note: '' }),
                                billingCycle: e.target.value as 'MONTHLY' | 'YEARLY',
                              },
                            }))}
                          >
                            <option value="MONTHLY">Monthly</option>
                            <option value="YEARLY">Yearly</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-indigo-700 mb-1">Note</label>
                          <input
                            className="input"
                            value={initiateDraft[t.id]?.note || ''}
                            onChange={(e) => setInitiateDraft((prev) => ({
                              ...prev,
                              [t.id]: {
                                ...(prev[t.id] || { requestedPlanId: '', paymentMethod: 'TRANSFER', billingCycle: 'MONTHLY' }),
                                note: e.target.value,
                              },
                            }))}
                          />
                        </div>
                      </div>
                      <button onClick={() => initiateSubscription(t.id)} className="btn-primary" disabled={actionLoading === `init-${t.id}`}>
                        {actionLoading === `init-${t.id}` && <Loader2 className="w-4 h-4 animate-spin" />} Initiate Renewal/Upgrade
                      </button>

                      <div className="pt-2 border-t border-indigo-100 space-y-2">
                        <p className="text-xs font-semibold text-indigo-700">Pending Transfer Verification</p>
                        {(pendingTransactions[t.id] || []).length === 0 ? (
                          <p className="text-xs text-indigo-500">No pending transfer requests.</p>
                        ) : (
                          (pendingTransactions[t.id] || []).map((tx) => (
                            <div key={tx.id} className="rounded-lg bg-white border border-indigo-100 p-3 flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-medium text-gray-800">{tx.requestedPlan?.name || tx.requestedPlanId} ({tx.changeType})</p>
                                <p className="text-xs text-gray-500">{new Date(tx.createdAt).toLocaleString()}</p>
                                {tx.transferProofUrl ? (
                                  <a
                                    className="text-xs text-primary-600 hover:underline"
                                    target="_blank"
                                    rel="noreferrer"
                                    href={tx.transferProofUrl.startsWith('http') ? tx.transferProofUrl : `${apiOrigin}${tx.transferProofUrl}`}
                                  >
                                    Open transfer proof
                                  </a>
                                ) : (
                                  <p className="text-xs text-gray-500">Proof not provided</p>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button className="btn-secondary" onClick={() => approveTransfer(t.id, tx.id, false)} disabled={actionLoading === `reject-${tx.id}`}>Reject</button>
                                <button className="btn-secondary" onClick={() => cancelTransferRequest(t.id, tx.id)} disabled={actionLoading === `cancel-${tx.id}`}>Cancel</button>
                                <button className="btn-primary" onClick={() => approveTransfer(t.id, tx.id, true)} disabled={actionLoading === `approve-${tx.id}`}>Approve</button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modal.open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">{modal.tenant ? 'Edit Tenant' : 'New Tenant'}</h2>
              <button onClick={() => setModal({ open: false, tenant: null })} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Business Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal({ open: false, tenant: null })} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{modal.tenant ? 'Save Changes' : 'Create Tenant'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
