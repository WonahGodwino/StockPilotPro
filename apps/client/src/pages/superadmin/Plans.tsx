import { useState, useEffect } from 'react'
import api from '@/lib/api'
import type { Plan } from '@/types'
import toast from 'react-hot-toast'
import { Plus, CreditCard, Edit, X, Loader2, Check, Zap } from 'lucide-react'

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

interface PlanForm { name: string; price: number; maxBranches: number; features: string; billingCycle: string }
const emptyForm: PlanForm = { name: '', price: 0, maxBranches: 1, features: '', billingCycle: 'MONTHLY' }

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null })
  const [form, setForm] = useState<PlanForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: Plan[] }>('/plans')
      setPlans(res.data.data)
    }
    catch { toast.error('Failed to load plans') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm(emptyForm); setModal({ open: true, plan: null }) }
  const openEdit = (p: Plan) => {
    const featuresText = typeof p.features === 'object' && p.features !== null
      ? Object.keys(p.features).join('\n')
      : ''
    setForm({
      name: p.name,
      price: Number(p.price),
      maxBranches: p.maxSubsidiaries,
      features: featuresText,
      billingCycle: 'MONTHLY',
    })
    setModal({ open: true, plan: p })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      const payload = { ...form, features: form.features.split('\n').map((f) => f.trim()).filter(Boolean), price: Number(form.price), maxBranches: Number(form.maxBranches) }
      const mappedPayload = {
        name: payload.name,
        price: payload.price,
        maxSubsidiaries: payload.maxBranches,
        extraSubsidiaryPrice: 0,
        features: payload.features.reduce<Record<string, boolean>>((acc, item) => {
          acc[item] = true
          return acc
        }, {}),
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

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {plans.map((p) => {
            const features = Array.isArray(p.features) ? (p.features as string[]) : []
            return (
              <div key={p.id} className="card relative overflow-hidden">
                <div className="absolute top-0 right-0 w-20 h-20 rounded-bl-full bg-indigo-50 flex items-start justify-end p-2">
                  <Zap className="w-5 h-5 text-indigo-400" />
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <CreditCard className="w-5 h-5 text-indigo-600" />
                  <h3 className="font-bold text-gray-800 text-lg">{p.name}</h3>
                </div>
                <p className="text-3xl font-black text-indigo-600">{fmt(p.price)}<span className="text-sm font-normal text-gray-400">/mo</span></p>
                <p className="text-sm text-gray-500 mt-1">Up to <strong>{p.maxSubsidiaries}</strong> branch{p.maxSubsidiaries !== 1 ? 'es' : ''}</p>
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
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Price (USD/mo) *</label><input className="input" type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: parseFloat(e.target.value) })} required /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Branches *</label><input className="input" type="number" min="1" value={form.maxBranches} onChange={(e) => setForm({ ...form, maxBranches: parseInt(e.target.value) })} required /></div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Features (one per line)</label>
                <textarea className="input resize-none" rows={4} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder="Unlimited products&#10;POS system&#10;Inventory tracking" />
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
