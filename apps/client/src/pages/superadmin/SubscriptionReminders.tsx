import { useEffect, useMemo, useState } from 'react'
import { Mail, BellRing, Send, CalendarClock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '@/lib/api'
import { getSuperadminCacheKey, isOnlineNow, readSuperadminCache, writeSuperadminCache } from '@/lib/superadminCache'

type ReminderWindow = 'current_month' | 'next_month' | 'two_months'

type ReminderRow = {
  id: string
  tenantId: string
  tenantName: string
  tenantEmail: string
  planId: string
  planName: string
  expiryDate: string
  amount: number
  billingCurrency: string
  daysLeft: number
  adminEmails: string[]
}

type ReminderLogRow = {
  id: string
  tenantName: string
  subscriptionId: string | null
  mode: string
  channel: string
  status: string
  recipients: string[]
  daysLeft: number | null
  sentApp: boolean
  sentEmail: boolean
  sentAt: string
}

export default function SubscriptionRemindersPage() {
  const [windowType, setWindowType] = useState<ReminderWindow>('two_months')
  const [items, setItems] = useState<ReminderRow[]>([])
  const [logs, setLogs] = useState<ReminderLogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(isOnlineNow())

  const remindersCacheKey = getSuperadminCacheKey(`reminders:${windowType}`)
  const logsCacheKey = getSuperadminCacheKey('reminder-logs')

  const load = async (win: ReminderWindow) => {
    setLoading(true)
    try {
      const key = getSuperadminCacheKey(`reminders:${win}`)
      if (!isOnlineNow()) {
        const cached = readSuperadminCache<{ items: ReminderRow[] }>(key)
        if (cached) setItems(cached.items || [])
        return
      }

      const res = await api.get('/subscriptions/reminders', { params: { window: win } })
      setItems(res.data.data || [])
      writeSuperadminCache(key, { items: res.data.data || [], cachedAt: new Date().toISOString() })
    } catch {
      toast.error('Failed to load subscription reminders')
    } finally {
      setLoading(false)
    }
  }

  const loadLogs = async () => {
    setLoadingLogs(true)
    try {
      if (!isOnlineNow()) {
        const cached = readSuperadminCache<{ logs: ReminderLogRow[] }>(logsCacheKey)
        if (cached) setLogs(cached.logs || [])
        return
      }

      const res = await api.get('/subscriptions/reminders/logs', { params: { page: 1, limit: 20 } })
      setLogs(res.data.data || [])
      writeSuperadminCache(logsCacheKey, { logs: res.data.data || [], cachedAt: new Date().toISOString() })
    } catch {
      toast.error('Failed to load reminder delivery logs')
    } finally {
      setLoadingLogs(false)
    }
  }

  useEffect(() => {
    void load(windowType)
  }, [windowType])

  useEffect(() => {
    void loadLogs()
  }, [])

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true)
      void load(windowType)
      void loadLogs()
    }
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [windowType])

  const sendAutoReminders = async () => {
    if (!isOnlineNow()) {
      toast.error('Reconnect to send reminders')
      return
    }

    try {
      setSendingId('AUTO')
      const res = await api.post('/subscriptions/reminders', { mode: 'auto', channel: 'both' })
      const data = res.data?.data
      toast.success(`Auto reminders done: ${data?.sentAppCount || 0} app, ${data?.sentEmailCount || 0} email`)
      void load(windowType)
      void loadLogs()
    } catch {
      toast.error('Failed to send automatic reminders')
    } finally {
      setSendingId(null)
    }
  }

  const sendManualReminder = async (subscriptionId: string) => {
    if (!isOnlineNow()) {
      toast.error('Reconnect to send reminders')
      return
    }

    try {
      setSendingId(subscriptionId)
      const res = await api.post('/subscriptions/reminders', {
        subscriptionId,
        mode: 'manual',
        channel: 'both',
      })
      const data = res.data?.data
      toast.success(`Reminder sent: ${data?.sentAppCount || 0} app, ${data?.sentEmailCount || 0} email`)
      void loadLogs()
    } catch {
      toast.error('Failed to send reminder')
    } finally {
      setSendingId(null)
    }
  }

  const sendSmtpTest = async () => {
    if (!isOnlineNow()) {
      toast.error('Reconnect to test SMTP')
      return
    }

    try {
      setSendingId('SMTP_TEST')
      await api.post('/subscriptions/reminders/test-email', {})
      toast.success('SMTP test email sent successfully')
      void loadLogs()
    } catch {
      toast.error('SMTP test failed. Check SMTP configuration.')
    } finally {
      setSendingId(null)
    }
  }

  const summary = useMemo(() => {
    const within30 = items.filter((i) => i.daysLeft <= 30 && i.daysLeft >= 0).length
    const next30 = items.filter((i) => i.daysLeft > 30 && i.daysLeft <= 60).length
    return { within30, next30, total: items.length }
  }, [items])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Subscription Reminders</h1>
          <p className="text-sm text-gray-500 mt-1">
            Notify tenant owners/admins before expiry to avoid service disruption.
          </p>
          {!isOnline && <p className="text-xs text-amber-600 mt-1">Offline mode: showing cached reminders and logs.</p>}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={sendSmtpTest} disabled={sendingId === 'SMTP_TEST'}>
            <Mail className="w-4 h-4" />
            {sendingId === 'SMTP_TEST' ? 'Testing SMTP...' : 'Test SMTP'}
          </button>
          <button className="btn-primary" onClick={sendAutoReminders} disabled={sendingId === 'AUTO'}>
            <BellRing className="w-4 h-4" />
            {sendingId === 'AUTO' ? 'Sending...' : 'Send Auto Reminders'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">Expiring This Month</p>
          <p className="text-2xl font-bold text-warning-600 mt-1">{summary.within30}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">Upcoming Next Month</p>
          <p className="text-2xl font-bold text-primary-600 mt-1">{summary.next30}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase">Total in 2-Month Window</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{summary.total}</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {([
          ['two_months', 'Next 2 Months'],
          ['current_month', 'Current Month'],
          ['next_month', 'Upcoming Month'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            className={`px-3 py-1.5 rounded-lg text-sm border ${windowType === value ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
            onClick={() => setWindowType(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Expiry</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Days Left</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Recipients</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading reminders...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-400">No subscriptions found for this window.</td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{row.tenantName}</p>
                      <p className="text-xs text-gray-500">{row.tenantEmail}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.planName}</td>
                    <td className="px-4 py-3 text-gray-700">
                      <div className="inline-flex items-center gap-1.5">
                        <CalendarClock className="w-4 h-4 text-gray-400" />
                        {new Date(row.expiryDate).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${row.daysLeft <= 30 ? 'text-warning-700' : 'text-primary-700'}`}>
                        {row.daysLeft}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-700 truncate max-w-[260px]" title={row.adminEmails.join(', ')}>
                        {row.adminEmails.join(', ')}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn-secondary"
                          onClick={() => sendManualReminder(row.id)}
                          disabled={sendingId === row.id}
                          title="Send app + email reminder"
                        >
                          <Send className="w-4 h-4" />
                          {sendingId === row.id ? 'Sending...' : 'Send Reminder'}
                        </button>
                        <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                          <Mail className="w-3.5 h-3.5" />
                          <BellRing className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Reminder Delivery Logs</h2>
          <button className="btn-secondary" onClick={() => { void loadLogs() }} disabled={loadingLogs}>
            {loadingLogs ? 'Refreshing...' : 'Refresh Logs'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">When</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tenant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Mode</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Recipients</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingLogs ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading logs...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">No reminder logs yet.</td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{new Date(log.sentAt).toLocaleString()}</td>
                    <td className="px-4 py-3 text-gray-900 font-medium">{log.tenantName}</td>
                    <td className="px-4 py-3 text-gray-700 uppercase">{log.mode || '-'}</td>
                    <td className="px-4 py-3 text-gray-700 uppercase">{log.channel || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        log.status === 'SUCCESS' ? 'bg-success-50 text-success-700' : log.status === 'PARTIAL' ? 'bg-warning-50 text-warning-700' : 'bg-danger-50 text-danger-700'
                      }`}>
                        {log.status || 'UNKNOWN'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 truncate max-w-[320px]" title={log.recipients.join(', ')}>
                      {log.recipients.join(', ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
