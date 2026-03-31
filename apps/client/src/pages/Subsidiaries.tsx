import { useState, useEffect } from 'react'
import api from '@/lib/api'
import type { Subsidiary } from '@/types'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import { Plus, Building2, Edit, ToggleLeft, ToggleRight, X, Loader2, MapPin, Phone } from 'lucide-react'

interface SubForm { name: string; address: string; phone: string; email: string }
const empty: SubForm = { name: '', address: '', phone: '', email: '' }

export default function Subsidiaries() {
  const user = useAuthStore((s) => s.user)
  const [items, setItems] = useState<Subsidiary[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; item: Subsidiary | null }>({ open: false, item: null })
  const [form, setForm] = useState<SubForm>(empty)
  const [saving, setSaving] = useState(false)

  const canManage = user?.role === 'BUSINESS_ADMIN' || user?.role === 'SUPER_ADMIN'

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get<{ data: Subsidiary[] }>('/subsidiaries')
      setItems(res.data.data)
    }
    catch { toast.error('Failed to load branches') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm(empty); setModal({ open: true, item: null }) }
  const openEdit = (s: Subsidiary) => { setForm({ name: s.name, address: s.address || '', phone: s.phone || '', email: s.email || '' }); setModal({ open: true, item: s }) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      if (modal.item) { await api.put(`/subsidiaries/${modal.item.id}`, form); toast.success('Branch updated') }
      else { await api.post('/subsidiaries', form); toast.success('Branch created') }
      setModal({ open: false, item: null }); load()
    } catch (err: unknown) { toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed') }
    finally { setSaving(false) }
  }

  const toggleArchive = async (s: Subsidiary) => {
    try {
      await api.put(`/subsidiaries/${s.id}`, { isActive: !s.isActive })
      toast.success(s.isActive ? 'Branch deactivated' : 'Branch activated')
      load()
    } catch { toast.error('Failed to update') }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Branches / Subsidiaries</h1><p className="text-sm text-gray-500 mt-0.5">{items.length} branch{items.length !== 1 ? 'es' : ''}</p></div>
        {canManage && <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add Branch</button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-gray-400"><Building2 className="w-12 h-12 mb-2 opacity-30" /><p>No branches yet</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((s) => (
            <div key={s.id} className={`card transition-opacity ${!s.isActive ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 rounded-xl"><Building2 className="w-5 h-5 text-indigo-600" /></div>
                  <div>
                    <p className="font-semibold text-gray-800">{s.name}</p>
                    <span className={`badge text-xs ${!s.isActive ? 'badge-danger' : 'badge-success'}`}>{s.isActive ? 'Active' : 'Inactive'}</span>
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => toggleArchive(s)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500" title={s.isActive ? 'Deactivate' : 'Activate'}>
                      {s.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-1 text-sm text-gray-500">
                {s.address && <div className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{s.address}</div>}
                {s.phone && <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />{s.phone}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">{modal.item ? 'Edit Branch' : 'New Branch'}</h2>
              <button onClick={() => setModal({ open: false, item: null })} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Branch Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal({ open: false, item: null })} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{modal.item ? 'Save Changes' : 'Create Branch'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
