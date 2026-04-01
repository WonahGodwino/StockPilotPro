import { useState } from 'react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'
import toast from 'react-hot-toast'
import { Globe, Loader2 } from 'lucide-react'

/**
 * CurrencySettings — lets a BUSINESS_ADMIN configure the tenant's base currency.
 * All reports, dashboards, and sales will display in this currency.
 * SUPER_ADMIN can also update their assigned tenant's currency.
 */
export default function CurrencySettings() {
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const accessToken = useAuthStore((s) => s.accessToken)
  const refreshToken = useAuthStore((s) => s.refreshToken)

  const currentCurrency = user?.tenant?.baseCurrency || 'USD'
  const [selected, setSelected] = useState(currentCurrency)
  const [saving, setSaving] = useState(false)

  if (!user || user.role === 'SALESPERSON') return null

  // Avoid a blank settings panel when tenant context is missing.
  if (!user.tenant || !user.tenantId) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-50 rounded-lg">
            <Globe className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Base Currency</h3>
            <p className="text-sm text-gray-600 mt-1">
              Currency settings are unavailable because this account is not linked to a company profile.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const handleSave = async () => {
    if (selected === currentCurrency) return
    setSaving(true)
    try {
      const tenantId = user.tenantId
      if (!tenantId) throw new Error('Unable to determine tenant ID')
      
      await api.patch(`/tenants/${tenantId}`, { baseCurrency: selected })
      // Update local auth state so the new currency is reflected immediately
      if (user.tenant) {
        setAuth(
          { ...user, tenant: { ...user.tenant, baseCurrency: selected } },
          accessToken!,
          refreshToken!
        )
      }
      toast.success(`Base currency updated to ${selected}`)
    } catch (err: unknown) {
      const errorMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      toast.error(errorMsg || 'Failed to update currency')
      console.error('Currency update failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-indigo-50 rounded-lg">
          <Globe className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Base Currency</h3>
          <p className="text-xs text-gray-500">
            Reports and dashboards display in this currency. Subscription billing remains in USD.
          </p>
        </div>
      </div>
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
          <select
            className="input"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.symbol} {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || selected === currentCurrency}
          className="btn-primary"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save
        </button>
      </div>
    </div>
  )
}
