import { useState, useEffect, useMemo } from 'react'
import api from '@/lib/api'
import type { Plan } from '@/types'
import toast from 'react-hot-toast'
import { Plus, CreditCard, Edit, X, Loader2, Check, Zap } from 'lucide-react'
import { SUPPORTED_CURRENCIES, makeCurrencyFormatter } from '@/lib/currency'
import { getSuperadminCacheKey, isOnlineNow, readSuperadminCache, writeSuperadminCache } from '@/lib/superadminCache'

interface PlanForm {
  name: string
  price: number
  priceCurrency: string
  maxBranches: number
  billingCycle: string
  selectedFeatures: string[]
  extraFeatureTokens: string
}

const FEATURE_TOGGLES = [
  {
    key: 'ENTERPRISE_PACKAGE',
    label: 'Enterprise package',
    description: 'Marks the plan as an Enterprise tier plan.',
  },
  {
    key: 'ENTERPRISE_AI_ENABLED',
    label: 'Enterprise AI core',
    description: 'Enables Enterprise AI access for eligible tenant roles.',
  },
  {
    key: 'AI_NATURAL_LANGUAGE_ASSISTANT',
    label: 'Natural language assistant',
    description: 'Unlocks the assistant chat, saved replies, and approval surfaces.',
  },
  {
    key: 'ENTERPRISE_AI_EXTERNAL_DATA',
    label: 'External data grounding',
    description: 'Shows the external database setup panel on the tenant Enterprise AI page and allows read-only grounding configuration.',
  },
  {
    key: 'AI_BRANCH_PERFORMANCE_COPILOT',
    label: 'Branch performance copilot',
    description: 'Enables branch ranking and performance copilots.',
  },
  {
    key: 'AI_DEMAND_FORECAST',
    label: 'Demand forecast',
    description: 'Enables AI demand forecasting recommendations.',
  },
  {
    key: 'AI_REORDER_ADVISOR',
    label: 'Reorder advisor',
    description: 'Enables replenishment and stock-transfer guidance.',
  },
  {
    key: 'AI_PRICING_MARGIN_ADVISOR',
    label: 'Pricing and margin advisor',
    description: 'Enables price adjustment simulations and margin recommendations.',
  },
  {
    key: 'AI_CASHFLOW_FORECAST',
    label: 'Cashflow forecast',
    description: 'Enables cashflow forecasting recommendations.',
  },
  {
    key: 'AI_EXPENSE_RISK_ALERTS',
    label: 'Expense risk alerts',
    description: 'Enables spend risk alerts and expense-cap simulations.',
  },
  {
    key: 'AI_ANOMALY_DETECTION',
    label: 'Anomaly detection',
    description: 'Enables AI anomaly detection recommendations.',
  },
] as const

const ENTERPRISE_AI_BUNDLE_KEYS = [
  'ENTERPRISE_PACKAGE',
  'ENTERPRISE_AI_ENABLED',
  'AI_NATURAL_LANGUAGE_ASSISTANT',
  'ENTERPRISE_AI_EXTERNAL_DATA',
] as const

const emptyForm: PlanForm = {
  name: '',
  price: 0,
  priceCurrency: 'USD',
  maxBranches: 1,
  billingCycle: 'MONTHLY',
  selectedFeatures: [],
  extraFeatureTokens: '',
}

function normalizeFeatureToken(token: string): string {
  return token.trim().toUpperCase().replace(/\s+/g, '_')
}

function extractPlanFeatureTokens(features: unknown): string[] {
  if (Array.isArray(features)) {
    return features
      .map((value) => String(value).trim())
      .filter(Boolean)
  }

  if (features && typeof features === 'object') {
    return Object.entries(features as Record<string, unknown>)
      .flatMap(([key, value]) => {
        if (value === true) return [normalizeFeatureToken(key)]
        if (typeof value === 'number' && Number.isFinite(value)) return [`${normalizeFeatureToken(key)}=${value}`]
        if (typeof value === 'string' && value.trim()) return [`${normalizeFeatureToken(key)}=${value.trim()}`]
        return []
      })
  }

  return []
}

function buildPlanFeatureList(selectedFeatures: string[], extraFeatureTokens: string): string[] {
  const deduped = new Map<string, string>()

  for (const feature of selectedFeatures) {
    const normalized = normalizeFeatureToken(feature)
    if (normalized) deduped.set(normalized, normalized)
  }

  for (const rawToken of extraFeatureTokens.split('\n')) {
    const trimmed = rawToken.trim()
    if (!trimmed) continue

    const [head, ...tail] = trimmed.split('=')
    const normalizedHead = normalizeFeatureToken(head)
    if (!normalizedHead) continue
    const normalizedToken = tail.length > 0
      ? `${normalizedHead}=${tail.join('=').trim()}`
      : normalizedHead
    deduped.set(normalizedToken, normalizedToken)
  }

  return Array.from(deduped.values())
}

function toggleSelectedFeature(selectedFeatures: string[], feature: string): string[] {
  return selectedFeatures.includes(feature)
    ? selectedFeatures.filter((entry) => entry !== feature)
    : [...selectedFeatures, feature]
}

function hasFeatureToken(features: string[], featureKey: string): boolean {
  return features.some((token) => normalizeFeatureToken(token.split('=')[0] || token) === featureKey)
}

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null })
  const [form, setForm] = useState<PlanForm>(emptyForm)
  const [currencySearch, setCurrencySearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [isOnline, setIsOnline] = useState(isOnlineNow())

  const cacheKey = useMemo(() => getSuperadminCacheKey('plans'), [])
  const filteredCurrencies = useMemo(() => {
    const q = currencySearch.trim().toLowerCase()
    if (!q) return SUPPORTED_CURRENCIES
    return SUPPORTED_CURRENCIES.filter(
      (currency) => currency.code.toLowerCase().includes(q) || currency.name.toLowerCase().includes(q)
    )
  }, [currencySearch])

  const load = async () => {
    setLoading(true)
    try {
      if (!isOnlineNow()) {
        const cached = readSuperadminCache<{ plans: Plan[] }>(cacheKey)
        if (cached) setPlans(cached.plans || [])
        return
      }

      const res = await api.get<{ data: Plan[] }>('/plans')
      setPlans(res.data.data)
      writeSuperadminCache(cacheKey, { plans: res.data.data, cachedAt: new Date().toISOString() })
    }
    catch { toast.error('Failed to load plans') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

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
  }, [])

  const openCreate = () => { setForm(emptyForm); setCurrencySearch(''); setModal({ open: true, plan: null }) }
  const openEdit = (p: Plan) => {
    const featureList = extractPlanFeatureTokens(p.features)
    const featureKeySet = new Set(featureList.map((token) => normalizeFeatureToken(token.split('=')[0] || token)))
    const selectedFeatures = FEATURE_TOGGLES
      .map((feature) => feature.key)
      .filter((feature) => featureKeySet.has(feature))
    const selectedFeatureSet = new Set(selectedFeatures)
    const extraFeatureTokens = featureList
      .filter((token) => !selectedFeatureSet.has(normalizeFeatureToken(token.split('=')[0] || token) as typeof selectedFeatures[number]))
      .join('\n')
    setForm({
      name: p.name,
      price: Number(p.price),
      priceCurrency: p.priceCurrency,
      maxBranches: p.maxSubsidiaries,
      billingCycle: p.billingCycle,
      selectedFeatures,
      extraFeatureTokens,
    })
    setCurrencySearch('')
    setModal({ open: true, plan: p })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      if (!isOnlineNow()) {
        toast.error('Reconnect to create or edit plans')
        return
      }

      const payload = {
        ...form,
        featureList: buildPlanFeatureList(form.selectedFeatures, form.extraFeatureTokens),
        price: Number(form.price),
        maxBranches: Number(form.maxBranches),
      }
      const mappedPayload = {
        name: payload.name,
        price: payload.price,
        priceCurrency: form.priceCurrency,
        billingCycle: form.billingCycle,
        maxSubsidiaries: payload.maxBranches,
        extraSubsidiaryPrice: 0,
        features: payload.featureList,
      }
      if (modal.plan) { await api.put(`/plans/${modal.plan.id}`, mappedPayload); toast.success('Plan updated') }
      else { await api.post('/plans', mappedPayload); toast.success('Plan created') }
      setModal({ open: false, plan: null }); load()
    } catch (err: unknown) { toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Subscription Plans</h1><p className="text-sm text-gray-500 mt-0.5">{plans.length} plan{plans.length !== 1 ? 's' : ''}</p></div>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> New Plan</button>
      </div>

      {!isOnline && <p className="text-xs text-amber-600">Offline mode: showing cached plans. Reconnect to edit.</p>}

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {plans.map((p) => {
            const features = extractPlanFeatureTokens(p.features)
            const fmt = makeCurrencyFormatter(p.priceCurrency || 'USD')
            const enterpriseAiEnabled = hasFeatureToken(features, 'ENTERPRISE_AI_ENABLED')
            const assistantEnabled = hasFeatureToken(features, 'AI_NATURAL_LANGUAGE_ASSISTANT')
            const externalGroundingEnabled = hasFeatureToken(features, 'ENTERPRISE_AI_EXTERNAL_DATA')
            return (
              <div key={p.id} className="card relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 rounded-bl-full bg-indigo-50 flex items-start justify-end p-2">
                  <Zap className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-gray-800 text-lg">{p.name}</h3>
                </div>
                <p className="text-3xl font-black text-indigo-600">{fmt(Number(p.price))}<span className="text-sm font-normal text-gray-400">/{p.billingCycle === 'YEARLY' ? 'yr' : 'mo'}</span></p>
                <p className="text-sm text-gray-500 mt-1">Up to <strong>{p.maxSubsidiaries}</strong> branch{p.maxSubsidiaries !== 1 ? 'es' : ''}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                  <span className={`rounded-full border px-2.5 py-1 ${enterpriseAiEnabled ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    AI Core {enterpriseAiEnabled ? 'On' : 'Off'}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 ${assistantEnabled ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    Assistant {assistantEnabled ? 'On' : 'Off'}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 ${externalGroundingEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                    External DB {externalGroundingEnabled ? 'On' : 'Off'}
                  </span>
                </div>
                {features.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {features.map((f, i) => <li key={i} className="flex items-center gap-2 text-sm text-gray-600"><Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />{f}</li>)}
                  </ul>
                )}
                <button onClick={() => openEdit(p)} className="mt-4 w-full btn-secondary text-sm"><Edit className="w-3.5 h-3.5" /> Edit Plan</button>
              </div>
            )
          })}
        </div>
      )}

      {modal.open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">{modal.plan ? 'Edit Plan' : 'New Plan'}</h2>
              <button onClick={() => setModal({ open: false, plan: null })} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Plan Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Price *</label><input className="input" type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) || 0 })} required /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Branches *</label><input className="input" type="number" min="1" value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: parseInt(e.target.value) })} required /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price Currency *</label>
                  <input
                    className="input mb-2"
                    placeholder="Search by code or name"
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    onBlur={() => setCurrencySearch('')}
                  />
                  <select className="input" value={form.priceCurrency} onChange={(e) => setForm({ ...form, priceCurrency: e.target.value })}>
                    {filteredCurrencies.map((currency) => (
                      <option key={currency.code} value={currency.code}>{currency.code} — {currency.name}</option>
                    ))}
                    {filteredCurrencies.length === 0 && (
                      <option value="" disabled>No currency matches search</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Billing Cycle *</label>
                  <select className="input" value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>
              </div>
              <div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 mb-3">
                  <p className="text-sm font-semibold text-indigo-900">Enterprise AI access bundle</p>
                  <p className="mt-1 text-xs text-indigo-800">Turn on the first four switches below to give tenant admins access to the Enterprise AI console, assistant workflows, and the external database setup panel. Without ENTERPRISE_AI_EXTERNAL_DATA, the external DB setup section stays hidden on the tenant AI page.</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-indigo-700">
                    {ENTERPRISE_AI_BUNDLE_KEYS.map((featureKey) => (
                      <span key={featureKey} className={`rounded-full border px-2.5 py-1 ${form.selectedFeatures.includes(featureKey) ? 'border-indigo-300 bg-white text-indigo-700' : 'border-indigo-100 bg-indigo-100/70 text-indigo-500'}`}>
                        {featureKey}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="block text-sm font-medium text-gray-700">Platform Feature Access</label>
                  <span className="text-xs text-gray-500">Used by runtime feature checks</span>
                </div>
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tenant access controls</p>
                    <div className="mt-2 space-y-2">
                      {FEATURE_TOGGLES.filter((feature) => ENTERPRISE_AI_BUNDLE_KEYS.includes(feature.key as typeof ENTERPRISE_AI_BUNDLE_KEYS[number])).map((feature) => {
                        const checked = form.selectedFeatures.includes(feature.key)
                        return (
                          <label key={feature.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-indigo-100 bg-white px-3 py-2 hover:border-indigo-200">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                              checked={checked}
                              onChange={() => setForm((current) => ({
                                ...current,
                                selectedFeatures: toggleSelectedFeature(current.selectedFeatures, feature.key),
                              }))}
                            />
                            <div>
                              <p className="text-sm font-medium text-gray-900">{feature.label}</p>
                              <p className="text-xs text-gray-500">{feature.key} · {feature.description}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Additional AI modules</p>
                    <div className="mt-2 space-y-2">
                      {FEATURE_TOGGLES.filter((feature) => !ENTERPRISE_AI_BUNDLE_KEYS.includes(feature.key as typeof ENTERPRISE_AI_BUNDLE_KEYS[number])).map((feature) => {
                    const checked = form.selectedFeatures.includes(feature.key)
                    return (
                      <label key={feature.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent bg-white px-3 py-2 hover:border-indigo-200">
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          checked={checked}
                          onChange={() => setForm((current) => ({
                            ...current,
                            selectedFeatures: toggleSelectedFeature(current.selectedFeatures, feature.key),
                          }))}
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{feature.label}</p>
                          <p className="text-xs text-gray-500">{feature.key} · {feature.description}</p>
                        </div>
                      </label>
                    )
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Feature Tokens</label>
                <textarea
                  className="input resize-none"
                  rows={4}
                  value={form.extraFeatureTokens}
                  onChange={(e) => setForm({ ...form, extraFeatureTokens: e.target.value })}
                  placeholder="MAX_BUSINESS_ADMINS=3&#10;UNLIMITED_BRANCHES"
                />
                <p className="mt-1 text-xs text-gray-500">Use one token per line for advanced flags or numeric limits that are not covered by the toggles above.</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Custom plan entries can be added in the additional token box above. They will be stored with the same feature payload the backend enforces.</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal({ open: false, plan: null })} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{modal.plan ? 'Save Changes' : 'Create Plan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
