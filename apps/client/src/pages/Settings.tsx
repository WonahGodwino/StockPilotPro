import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import CurrencySettings from '@/components/settings/CurrencySettings'
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings'
import SubscriptionSettings from '@/components/settings/SubscriptionSettings'
import { Settings as SettingsIcon } from 'lucide-react'

export default function Settings() {
  const user = useAuthStore((s) => s.user)

  if (!user || user.role === 'SALESPERSON') return <Navigate to="/dashboard" replace />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gray-100 rounded-lg">
          <SettingsIcon className="w-5 h-5 text-gray-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Manage your business preferences</p>
        </div>
      </div>

      <CurrencySettings />
      <ExchangeRateSettings />
      <SubscriptionSettings />
    </div>
  )
}
