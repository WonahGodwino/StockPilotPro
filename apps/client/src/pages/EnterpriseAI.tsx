import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Bot, Sparkles, ShieldAlert, RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import toast from 'react-hot-toast'

type Recommendation = {
  id: string
  recommendationType: string
  status: string
  title: string
  summary: string
  confidenceScore?: number | null
  riskScore?: number | null
  outputPayload?: unknown
  createdAt: string
}

export default function EnterpriseAIPage() {
  const user = useAuthStore((s) => s.user)
  const [loading, setLoading] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [branchRows, setBranchRows] = useState<Array<{ branchName: string; revenue: number; expense: number; margin: number; score: number }>>([])
  const [assistantPrompt, setAssistantPrompt] = useState('Summarize branch performance priorities for this week')
  const [assistantReplies, setAssistantReplies] = useState<Array<{ id: string; prompt: string; response: string; createdAt: string }>>([])

  const canAccess = user?.role === 'SUPER_ADMIN' || user?.role === 'BUSINESS_ADMIN'

  const loadBranchCopilot = async () => {
    setLoading(true)
    try {
      await api.post('/enterprise-ai/recommendations', {
        recommendationType: 'BRANCH_PERFORMANCE',
      })

      const { data } = await api.get<{ data: Recommendation[] }>('/enterprise-ai/recommendations?recommendationType=BRANCH_PERFORMANCE&limit=1')
      const top = data.data?.[0]
      const ranked = ((top?.outputPayload as { rankedBranches?: Array<{ branchName: string; revenue: number; expense: number; margin: number; score: number }> } | undefined)?.rankedBranches || [])
      setBranchRows(ranked)
      setBlocked(null)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load branch copilot'
      if (status === 403) setBlocked(msg)
      else toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const sendAssistantPrompt = async (e: FormEvent) => {
    e.preventDefault()
    if (!assistantPrompt.trim()) return
    setLoading(true)
    try {
      const { data } = await api.post<{ data: Recommendation }>('/enterprise-ai/recommendations', {
        recommendationType: 'NL_ASSISTANT',
        prompt: assistantPrompt,
      })

      const payload = (data.data.outputPayload as { response?: string } | undefined)
      setAssistantReplies((prev) => [
        {
          id: data.data.id,
          prompt: assistantPrompt,
          response: payload?.response || data.data.summary,
          createdAt: data.data.createdAt,
        },
        ...prev,
      ])
      setBlocked(null)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to query assistant'
      if (status === 403) setBlocked(msg)
      else toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (canAccess) {
      void loadBranchCopilot()
    }
  }, [canAccess])

  const rankingSummary = useMemo(() => {
    if (!branchRows.length) return 'No branch performance recommendations yet.'
    const lead = branchRows[0]
    return `${lead.branchName} currently leads with margin ${lead.margin.toFixed(2)}.`
  }, [branchRows])

  if (!user) return <Navigate to="/login" replace />
  if (!canAccess) return <Navigate to="/dashboard" replace />

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise AI Console</h1>
          <p className="text-sm text-gray-500 mt-1">Branch performance copilot and natural-language assistant for Enterprise tenants.</p>
        </div>
        <button className="btn-primary" onClick={loadBranchCopilot} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Insights
        </button>
      </div>

      {blocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-700 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900">Enterprise upgrade required</p>
              <p className="text-sm text-amber-800 mt-1">{blocked}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Branch Performance Copilot</h2>
          </div>
          <p className="text-sm text-gray-600">{rankingSummary}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[580px]">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500">
                  <th className="py-2 text-left">Branch</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">Expense</th>
                  <th className="py-2 text-right">Margin</th>
                  <th className="py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {branchRows.length === 0 ? (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={5}>No branch ranking available yet.</td>
                  </tr>
                ) : (
                  branchRows.map((row) => (
                    <tr key={row.branchName} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-900">{row.branchName}</td>
                      <td className="py-2 text-right">{row.revenue.toFixed(2)}</td>
                      <td className="py-2 text-right">{row.expense.toFixed(2)}</td>
                      <td className="py-2 text-right">{row.margin.toFixed(2)}</td>
                      <td className="py-2 text-right">{row.score.toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-600" />
            <h2 className="font-semibold text-gray-900">Natural Language Assistant</h2>
          </div>

          <form className="space-y-3" onSubmit={sendAssistantPrompt}>
            <textarea
              className="input min-h-[110px]"
              value={assistantPrompt}
              onChange={(e) => setAssistantPrompt(e.target.value)}
              placeholder="Ask for scoped recommendations, e.g. Which branch should reduce discount leakage this week?"
            />
            <button className="btn-primary" type="submit" disabled={loading}>Ask Assistant</button>
          </form>

          <div className="space-y-3 max-h-[320px] overflow-auto">
            {assistantReplies.length === 0 ? (
              <p className="text-sm text-gray-500">No assistant response yet.</p>
            ) : (
              assistantReplies.map((reply) => (
                <div key={reply.id} className="rounded-lg border border-gray-100 p-3 bg-gray-50">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Prompt</p>
                  <p className="text-sm text-gray-800 mt-1">{reply.prompt}</p>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mt-3">Response</p>
                  <p className="text-sm text-gray-800 mt-1">{reply.response}</p>
                  <p className="text-[11px] text-gray-400 mt-2">{new Date(reply.createdAt).toLocaleString()}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
