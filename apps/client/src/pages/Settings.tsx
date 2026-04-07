import { Navigate } from 'react-router-dom'
import { useState } from 'react'
import { useAuthStore } from '@/store/auth.store'
import CurrencySettings from '@/components/settings/CurrencySettings'
import ExchangeRateSettings from '@/components/settings/ExchangeRateSettings'
import SubscriptionSettings from '@/components/settings/SubscriptionSettings'
import { Settings as SettingsIcon } from 'lucide-react'
import api from '@/lib/api'
import toast from 'react-hot-toast'
import { getApiErrorMessage } from '@/lib/apiError'

export default function Settings() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  if (!user) return <Navigate to="/dashboard" replace />

  const isAgent = user.role === 'AGENT'

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast.error('All password fields are required.')
      return
    }

    if (passwordForm.newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.')
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('New password and confirmation do not match.')
      return
    }

    setChangePasswordSubmitting(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      })

      toast.success('Password updated. Please sign in again.')
      logout()
      window.location.href = '/login'
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Failed to change password.'))
    } finally {
      setChangePasswordSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-gray-100 rounded-lg">
          <SettingsIcon className="w-5 h-5 text-gray-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">{isAgent ? 'Manage agent subscription workflows' : 'Manage your business preferences'}</p>
        </div>
      </div>

      {!isAgent && <CurrencySettings />}
      {!isAgent && <ExchangeRateSettings />}
      <SubscriptionSettings />

      <section className="card p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
          <p className="text-sm text-gray-500">Update your account password. You will be signed out after a successful change.</p>
        </div>

        <form onSubmit={handleChangePassword} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-gray-700">Current Password</label>
            <input
              type="password"
              className="input"
              value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
              autoComplete="current-password"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">New Password</label>
            <input
              type="password"
              className="input"
              value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Confirm New Password</label>
            <input
              type="password"
              className="input"
              value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>

          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="btn-primary" disabled={changePasswordSubmitting}>
              {changePasswordSubmitting ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
