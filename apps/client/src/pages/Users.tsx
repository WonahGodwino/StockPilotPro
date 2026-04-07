import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'
import type { AuthUser, Subsidiary } from '@/types'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'
import { Plus, Edit, Shield, X, Loader2, KeyRound } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import {
  getCachedSubsidiariesForTenant,
  getCachedUsersForTenant,
  replaceCachedSubsidiariesForTenant,
  replaceCachedUsersForTenant,
} from '@/lib/db'

const ROLE_LABELS: Record<string, string> = { BUSINESS_ADMIN: 'Admin', SALESPERSON: 'Salesperson', SUPER_ADMIN: 'Super Admin', AGENT: 'Agent' }
const ROLE_COLORS: Record<string, string> = { BUSINESS_ADMIN: 'badge-warning', SALESPERSON: 'badge-info', SUPER_ADMIN: 'badge-danger', AGENT: 'badge-success' }

interface UserForm { name: string; email: string; password: string; role: string; subsidiaryId: string }
const emptyForm: UserForm = { name: '', email: '', password: '', role: 'SALESPERSON', subsidiaryId: '' }

interface SsoSettings { ssoEnabled: boolean; ssoProviders: string[] }

function splitName(name: string) {
  const parts = name.trim().split(/\s+/)
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || 'User' }
}

function fullName(u: AuthUser) {
  return `${u.firstName} ${u.lastName}`.trim()
}

function isCurrentlyOnline(lastSeenAt: string | undefined, timeoutMinutes: number): boolean {
  if (!lastSeenAt) return false
  const ts = new Date(lastSeenAt).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts <= timeoutMinutes * 60 * 1000
}

function SsoPanel({ tenantId }: { tenantId: string }) {
  const [sso, setSso] = useState<SsoSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<{ data: SsoSettings }>(`/tenants/${tenantId}/sso`)
      .then((res) => setSso(res.data.data))
      .catch(() => setSso({ ssoEnabled: false, ssoProviders: [] }))
  }, [tenantId])

  const toggleProvider = (provider: string, checked: boolean) => {
    if (!sso) return
    const newProviders = checked
      ? [...new Set([...sso.ssoProviders, provider])]
      : sso.ssoProviders.filter((p) => p !== provider)
    setSso({ ssoEnabled: newProviders.length > 0, ssoProviders: newProviders })
  }

  const save = async () => {
    if (!sso) return
    setSaving(true)
    try {
      await api.patch(`/tenants/${tenantId}/sso`, { ssoEnabled: sso.ssoEnabled, ssoProviders: sso.ssoProviders })
      toast.success('SSO settings saved')
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save SSO settings')
    } finally { setSaving(false) }
  }

  if (!sso) return <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Loading SSO settings…</div>

  return (
    <div className="bg-gray-50 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-semibold text-gray-700">SSO Authentication</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${sso.ssoEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
          {sso.ssoEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <p className="text-xs text-gray-500">Allow BUSINESS_ADMIN accounts to sign in via an external identity provider. Only admins may use SSO.</p>
      <div className="flex flex-wrap gap-4">
        {['google', 'microsoft'].map((provider) => (
          <label key={provider} className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded accent-indigo-600"
              checked={sso.ssoProviders.includes(provider)}
              onChange={(e) => toggleProvider(provider, e.target.checked)}
            />
            <span className="text-sm text-gray-700 capitalize">{provider}</span>
          </label>
        ))}
      </div>
      <button onClick={save} disabled={saving} className="btn-primary text-xs px-3 py-1.5 mt-1">
        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
        Save SSO Settings
      </button>
    </div>
  )
}

export default function Users() {
  const currentUser = useAuthStore((s) => s.user)
  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN'
  const isBusinessAdmin = currentUser?.role === 'BUSINESS_ADMIN'
  const [users, setUsers] = useState<AuthUser[]>([])
  const [subsidiaries, setSubsidiaries] = useState<Subsidiary[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ open: boolean; user: AuthUser | null }>({ open: false, user: null })
  const [form, setForm] = useState<UserForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [salespersonsOnly, setSalespersonsOnly] = useState(false)
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [staleHours, setStaleHours] = useState(24)
  const [staleLoading, setStaleLoading] = useState(false)
  const [sendingStaleAlerts, setSendingStaleAlerts] = useState(false)
  const [staleUsers, setStaleUsers] = useState<Array<{ id: string; firstName: string; lastName: string; hoursSinceLastSeen: number; thresholdHours: number }>>([])
  const [presenceTimeoutMinutes, setPresenceTimeoutMinutes] = useState(2)
  const [savingPresenceTimeout, setSavingPresenceTimeout] = useState(false)

  const canManage = isBusinessAdmin || isSuperAdmin
  const allowedRoles = isSuperAdmin ? ['AGENT'] : ['BUSINESS_ADMIN', 'SALESPERSON']

  if (!currentUser || currentUser.role === 'SALESPERSON') {
    return <Navigate to="/dashboard" replace />
  }

  const filteredUsers = users.filter((u) => {
    if (isSuperAdmin && u.role !== 'AGENT') return false
    if (salespersonsOnly && u.role !== 'SALESPERSON') return false
    if (onlineOnly && !isCurrentlyOnline(u.lastSeenAt, presenceTimeoutMinutes)) return false
    return true
  })

  const refreshOfflineUsersCache = useCallback(async () => {
    if (!navigator.onLine) return

    const [usersRes, subsRes] = await Promise.all([
      api.get<{ data: AuthUser[] }>(isSuperAdmin ? '/users?role=AGENT' : '/users'),
      isSuperAdmin ? Promise.resolve({ data: { data: [] as Subsidiary[] } }) : api.get<{ data: Subsidiary[] }>('/subsidiaries'),
    ])

    await replaceCachedUsersForTenant(currentUser?.tenantId ?? null, usersRes.data.data)
    if (!isSuperAdmin && currentUser?.tenantId) {
      await replaceCachedSubsidiariesForTenant(currentUser.tenantId, subsRes.data.data)
    }
  }, [currentUser?.tenantId, isSuperAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!navigator.onLine) {
        const cachedUsers = await getCachedUsersForTenant(currentUser?.tenantId ?? null, isSuperAdmin ? 'AGENT' : undefined)
        setUsers(cachedUsers)

        if (!isSuperAdmin && currentUser?.tenantId) {
          const cachedSubs = await getCachedSubsidiariesForTenant(currentUser.tenantId)
          setSubsidiaries(cachedSubs)
        } else {
          setSubsidiaries([])
        }
        return
      }

      const [usersRes, subsRes] = await Promise.all([
        api.get<{ data: AuthUser[] }>(isSuperAdmin ? '/users?role=AGENT' : '/users'),
        isSuperAdmin ? Promise.resolve({ data: { data: [] as Subsidiary[] } }) : api.get<{ data: Subsidiary[] }>('/subsidiaries'),
      ])
      setUsers(usersRes.data.data)
      setSubsidiaries(subsRes.data.data)

      await replaceCachedUsersForTenant(currentUser?.tenantId ?? null, usersRes.data.data)
      if (!isSuperAdmin && currentUser?.tenantId) {
        await replaceCachedSubsidiariesForTenant(currentUser.tenantId, subsRes.data.data)
      }
    } catch { toast.error('Failed to load users') } finally { setLoading(false) }
  }, [currentUser?.tenantId, isSuperAdmin])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onOnline = () => {
      void load()
      void refreshOfflineUsersCache()
    }

    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [load, refreshOfflineUsersCache])

  const loadStaleUsers = async () => {
    if (!canManage) return
    if (!navigator.onLine) return
    setStaleLoading(true)
    try {
      const res = await api.get<{ data: { staleUsers: Array<{ id: string; firstName: string; lastName: string; hoursSinceLastSeen: number; thresholdHours: number }> } }>(`/users/stale-alerts?hours=${staleHours}`)
      setStaleUsers(res.data.data.staleUsers || [])
    } catch {
      setStaleUsers([])
    } finally {
      setStaleLoading(false)
    }
  }

  const loadPresenceTimeout = async () => {
    if (!canManage) return
    if (!navigator.onLine) return
    try {
      const res = await api.get<{ data: { presenceTimeoutMinutes: number } }>('/tenants/presence-timeout')
      setPresenceTimeoutMinutes(Math.max(1, Number(res.data.data.presenceTimeoutMinutes || 2)))
    } catch {
      setPresenceTimeoutMinutes(2)
    }
  }

  const savePresenceTimeout = async (minutes: number) => {
    if (!navigator.onLine) {
      toast.error('Reconnect to update presence timeout')
      return
    }
    setSavingPresenceTimeout(true)
    try {
      const res = await api.patch<{ data: { presenceTimeoutMinutes: number } }>('/tenants/presence-timeout', { minutes })
      setPresenceTimeoutMinutes(Number(res.data.data.presenceTimeoutMinutes || minutes))
      toast.success('Presence timeout updated')
    } catch {
      toast.error('Failed to update presence timeout')
    } finally {
      setSavingPresenceTimeout(false)
    }
  }

  const sendStaleAlerts = async () => {
    if (!navigator.onLine) {
      toast.error('Reconnect to send stale-user alerts')
      return
    }
    setSendingStaleAlerts(true)
    try {
      const res = await api.post<{ data: { sent: number; skipped: number } }>(`/users/stale-alerts?hours=${staleHours}`)
      toast.success(`Sent ${res.data.data.sent} stale-user alert(s), skipped ${res.data.data.skipped}.`)
      await loadStaleUsers()
    } catch {
      toast.error('Failed to send stale-user alerts')
    } finally {
      setSendingStaleAlerts(false)
    }
  }

  useEffect(() => {
    void loadStaleUsers()
  }, [staleHours, canManage])

  useEffect(() => {
    void loadPresenceTimeout()
  }, [canManage])

  const openCreate = () => {
    setForm({ ...emptyForm, role: isSuperAdmin ? 'AGENT' : 'SALESPERSON', subsidiaryId: '' })
    setModal({ open: true, user: null })
  }
  const openEdit = (u: AuthUser) => {
    setForm({ name: fullName(u), email: u.email, password: '', role: u.role, subsidiaryId: u.subsidiaryId || '' })
    setModal({ open: true, user: u })
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      const { firstName, lastName } = splitName(form.name)
      const payload: Record<string, unknown> = { firstName, lastName, email: form.email, role: form.role, subsidiaryId: form.subsidiaryId || undefined }
      if (form.password) payload.password = form.password
      if (modal.user) { await api.put(`/users/${modal.user.id}`, payload); toast.success('User updated') }
      else { await api.post('/users', { ...payload, password: form.password }); toast.success('User created') }
      setModal({ open: false, user: null }); void load(); void refreshOfflineUsersCache()
    } catch (err: unknown) { toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filteredUsers.length} of {users.length} team member{users.length !== 1 ? 's' : ''}</p>
          {isSuperAdmin && (
            <p className="text-xs text-gray-500 mt-1">Showing platform agents only (AGENT users).</p>
          )}
        </div>
        {canManage && <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Add User</button>}
      </div>

      {isBusinessAdmin && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSalespersonsOnly((v) => !v)}
            className={`badge px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              salespersonsOnly ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Salespersons only
          </button>
          <button
            onClick={() => setOnlineOnly((v) => !v)}
            className={`badge px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors ${
              onlineOnly ? 'bg-success-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Online now only
          </button>
        </div>
      )}

      {canManage && (
        <div className="rounded-xl border border-gray-100 bg-white p-3 flex flex-wrap items-center gap-2">
          <p className="text-xs text-gray-600">Presence timeout:</p>
          {[1, 2, 5].map((m) => (
            <button
              key={m}
              disabled={savingPresenceTimeout}
              onClick={() => void savePresenceTimeout(m)}
              className={`badge px-2.5 py-1 text-xs ${presenceTimeoutMinutes === m ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {m} min
            </button>
          ))}
        </div>
      )}

      {canManage && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-amber-900">Stale Salesperson Activity</p>
              <p className="text-xs text-amber-800">
                {staleLoading ? 'Checking activity...' : `${staleUsers.length} salesperson(s) inactive for ${staleHours}+ hours`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                className="input text-xs py-1.5 px-2"
                value={staleHours}
                onChange={(e) => setStaleHours(Number(e.target.value))}
              >
                <option value={24}>24h threshold</option>
                <option value={72}>72h threshold</option>
              </select>
              <button onClick={sendStaleAlerts} disabled={sendingStaleAlerts} className="btn-secondary text-xs">
                {sendingStaleAlerts && <Loader2 className="w-3 h-3 animate-spin" />}
                Send Alerts
              </button>
            </div>
          </div>
          {staleUsers.length > 0 && (
            <div className="text-xs text-amber-900">
              {staleUsers.slice(0, 4).map((u) => (
                <div key={u.id}>{u.firstName} {u.lastName}: {u.hoursSinceLastSeen}h inactive</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SSO panel for BUSINESS_ADMIN */}
      {isBusinessAdmin && currentUser?.tenantId && (
        <SsoPanel tenantId={currentUser.tenantId} />
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50">
              {['Name', 'Email', 'Role', 'Presence', 'Last Seen', 'Branch', 'Actions'].map((h) => <th key={h} className="px-4 py-3 text-left font-semibold text-gray-600">{h}</th>)}
            </tr></thead>
            <tbody>
              {filteredUsers.map((u) => {
                const sub = subsidiaries.find((s) => s.id === (u as unknown as { subsidiaryId?: string }).subsidiaryId)
                const online = isCurrentlyOnline(u.lastSeenAt, presenceTimeoutMinutes)
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
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${online ? 'bg-success-50 text-success-700' : 'bg-gray-100 text-gray-600'}`}>
                        {online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{sub?.name || '—'}</td>
                    <td className="px-4 py-3">
                      {canManage && u.id !== currentUser?.id && (
                        <button onClick={() => openEdit(u)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><Edit className="w-4 h-4" /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400">No users match selected filters.</td>
                </tr>
              )}
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
                    {allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
                  <select className="input" value={form.subsidiaryId} onChange={(e) => setForm({ ...form, subsidiaryId: e.target.value })} disabled={isSuperAdmin}>
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
