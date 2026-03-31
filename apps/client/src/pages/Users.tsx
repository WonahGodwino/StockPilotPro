import { useState, useEffect } from 'react'
import api from '@/lib/api'
import type { AuthUser, Subsidiary } from '@/types'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import { Plus, User, Edit, Shield, X, Loader2, KeyRound } from 'lucide-react'

const ROLES = ['BUSINESS_ADMIN', 'SALESPERSON'] as const
const ROLE_LABELS: Record<string, string> = { BUSINESS_ADMIN: 'Admin', SALESPERSON: 'Salesperson', SUPER_ADMIN: 'Super Admin' }
const ROLE_COLORS: Record<string, string> = { BUSINESS_ADMIN: 'badge-warning', SALESPERSON: 'badge-info', SUPER_ADMIN: 'badge-danger' }

interface UserForm { name: string; email: string; password: string; role: string; subsidiaryId: string }
const emptyForm: UserForm = { name: '', email: '', password: '', role: 'SALESPERSON', subsidiaryId: '' }

function splitName(name: string) {
  const parts = name.trim().split(/\s+/)
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || 'User',
  }
}

function fullName(u: AuthUser) {
  return `${u.firstName} ${u.lastName}`.trim()
}

export default function Users() {
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<AuthUser[]>([])
  const [subsidiaries, setSubsidiaries] = useState<Subsidiary[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; user: AuthUser | null }>({ open: false, user: null })
  const [form, setForm] = useState<UserForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const canManage = currentUser?.role === 'BUSINESS_ADMIN' || currentUser?.role === 'SUPER_ADMIN'

  const load = async () => {
    setLoading(true)
    try {
      const [usersRes, subsRes] = await Promise.all([
        api.get<{ data: AuthUser[] }>('/users'),
        api.get<{ data: Subsidiary[] }>('/subsidiaries'),
      ])
      setUsers(usersRes.data.data)
      setSubsidiaries(subsRes.data.data)
    } catch { toast.error('Failed to load users') } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => { setForm(emptyForm); setModal({ open: true, user: null }) }
  const openEdit = (u: AuthUser) => {
    setForm({ name: fullName(u), email: u.email, password: '', role: u.role, subsidiaryId: u.subsidiaryId || '' })
    setModal({ open: true, user: u })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      const { firstName, lastName } = splitName(form.name)
      const payload: Record<string, unknown> = {
        firstName,
        lastName,
        email: form.email,
        role: form.role,
        subsidiaryId: form.subsidiaryId || undefined,
      }
      if (form.password) payload.password = form.password
      if (modal.user) { await api.put(`/users/${modal.user.id}`, payload); toast.success('User updated') }
      else { await api.post('/users', { ...payload, password: form.password }); toast.success('User created') }
      setModal({ open: false, user: null }); load()
    } catch (err: unknown) { toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Users</h1><p className="text-sm text-gray-500 mt-0.5">{users.length} team member{users.length !== 1 ? 's' : ''}</p></div>
        {canManage && <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add User</button>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50">
              {['Name', 'Email', 'Role', 'Branch', 'Actions'].map((h) => <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600">{h}</th>)}
            </tr></thead>
            <tbody>
              {users.map((u) => {
                const sub = subsidiaries.find((s) => s.id === (u as unknown as { subsidiaryId?: string }).subsidiaryId)
                return (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold text-xs">{fullName(u).charAt(0).toUpperCase()}</div>
                        <span className="font-medium text-gray-800">{fullName(u)}</span>
                        {u.id === currentUser?.id && <span className="text-xs text-gray-400">(you)</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.email}</td>
                    <td className="px-4 py-3"><span className={`badge ${ROLE_COLORS[u.role] || 'badge-info'}`}><Shield className="w-3 h-3" />{ROLE_LABELS[u.role] || u.role}</span></td>
                    <td className="px-4 py-3 text-gray-500">{sub?.name || '—'}</td>
                    <td className="px-4 py-3">
                      {canManage && u.id !== currentUser?.id && (
                        <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Edit className="w-4 h-4" /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal.open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">{modal.user ? 'Edit User' : 'New User'}</h2>
              <button onClick={() => setModal({ open: false, user: null })} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{modal.user ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                <div className="relative"><KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" /><input className="input pl-9" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!modal.user} minLength={8} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <select className="input" value={form.subsidiaryId} onChange={(e) => setForm({ ...form, subsidiaryId: e.target.value })}>
                    <option value="">All branches</option>
                    {subsidiaries.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setModal({ open: false, user: null })} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{modal.user ? 'Save Changes' : 'Create User'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
