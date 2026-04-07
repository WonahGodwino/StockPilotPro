import { useEffect, useState } from 'react'
import { Building2, CheckCircle2, Clock3 } from 'lucide-react'
import api from '@/lib/api'

interface AgentBusinessRow {
  id: string
  name: string
  email: string
  createdAt: string
  pendingRequests: number
  subscription: {
    id: string
    status: string
    expiryDate: string
    planName?: string
  } | null
}

interface AgentPerformance {
  totalBusinesses: number
  activeSubscriptions: number
  pendingRequests: number
  businesses: AgentBusinessRow[]
}

function Card({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`p-3 rounded-xl ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

export default function AgentDashboard() {
  const [data, setData] = useState<AgentPerformance | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ data: AgentPerformance }>('/reports/agent-performance')
      .then((res) => setData(res.data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="text-sm text-gray-500">Loading agent dashboard...</div>
  }

  if (!data) {
    return <div className="text-sm text-gray-500">Could not load your agent performance data.</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Agent Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Performance summary for businesses assigned to you.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="Businesses Brought" value={data.totalBusinesses} icon={Building2} color="bg-primary-100 text-primary-700" />
        <Card label="Active Subscriptions" value={data.activeSubscriptions} icon={CheckCircle2} color="bg-success-50 text-success-700" />
        <Card label="Pending Requests" value={data.pendingRequests} icon={Clock3} color="bg-warning-50 text-warning-700" />
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Assigned Businesses</h2>
        {data.businesses.length === 0 ? (
          <p className="text-sm text-gray-500">No businesses have been assigned to your account yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="py-2 text-left">Business</th>
                  <th className="py-2 text-left">Plan</th>
                  <th className="py-2 text-left">Subscription</th>
                  <th className="py-2 text-left">Pending Requests</th>
                </tr>
              </thead>
              <tbody>
                {data.businesses.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50">
                    <td className="py-2">
                      <p className="font-medium text-gray-900">{row.name}</p>
                      <p className="text-xs text-gray-500">{row.email}</p>
                    </td>
                    <td className="py-2 text-gray-700">{row.subscription?.planName || 'No active plan'}</td>
                    <td className="py-2 text-gray-700">{row.subscription?.status || 'N/A'}</td>
                    <td className="py-2 text-gray-700">{row.pendingRequests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
