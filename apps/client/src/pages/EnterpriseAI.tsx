import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Bot, Sparkles, ShieldAlert, RefreshCw, CalendarDays, ClipboardCheck, TrendingUp, SlidersHorizontal, Gauge, Save, Printer, Trash2, Search, Download, FileText } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { useAppStore } from '@/store/app.store'
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

type AssistantBrief = {
  summary: string
  comparativeInsights: string[]
  actions: string[]
  risks: string[]
  followUpQuestions: string[]
  alerts?: Array<{
    severity: 'critical' | 'warning' | 'info'
    message: string
    actionRequired: string
  }>
}

type AssistantIncomeBreakdown = {
  totalIncome: number
  salesIncome: number
  subscriptionIncome: number
  hasSubscriptionIncomeSource?: boolean
  streamMix: {
    salesPct: number
    subscriptionPct: number
  }
}

type AssistantReply = {
  id: string
  prompt: string
  response: string
  createdAt: string
  currencyCode?: string
  incomeBreakdown?: AssistantIncomeBreakdown
  conversationId?: string
  provider?: string
  sourceRecommendationId?: string
  brief?: AssistantBrief
}

function shouldShowSubscriptionIncomeRow(incomeBreakdown?: AssistantIncomeBreakdown): boolean {
  if (!incomeBreakdown) return false
  return Boolean(incomeBreakdown.hasSubscriptionIncomeSource) || Number(incomeBreakdown.subscriptionIncome) > 0
}

type AssistantLibraryResponse = {
  data: AssistantReply[]
}

type AssistantLibrarySaveResponse = {
  data: AssistantReply
}

type ActionTrackerStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'

type ActionTrackerState = {
  ownerUserId: string
  dueDate: string | null
  status: ActionTrackerStatus
  expectedImpactScore: number | null
  realizedImpactScore: number | null
  impactNotes: string | null
  progressNote: string | null
  updatedAt: string
}

type ActionItem = {
  recommendationId: string
  recommendationType: string
  title: string
  summary: string
  recommendationStatus: string
  createdAt: string
  updatedAt: string
  tracker: ActionTrackerState
}

type ActionListResponse = {
  data: {
    tenantId: string
    total: number
    statusCounts: Record<string, number>
    items: ActionItem[]
  }
}

type ActionUpdateDraft = {
  status: ActionTrackerStatus
  realizedImpactScore: string
  progressNote: string
}

type AlertPriority = 'P1' | 'P2' | 'P3'

type AlertPolicyDraft = {
  minPriorityToNotify: AlertPriority
  quietHoursStartUtc: string
  quietHoursEndUtc: string
  suppressAfterAckHours: string
  dedupeP1Hours: string
  dedupeP2Hours: string
  dedupeP3Hours: string
}

type AlertPolicyResponse = {
  data: {
    tenantId: string
    source: 'defaults' | 'tenant-signal'
    signalId: string | null
    updatedAt: string | null
    updatedByUserId: string | null
    policy: {
      minPriorityToNotify: AlertPriority
      quietHoursStartUtc: number | null
      quietHoursEndUtc: number | null
      suppressAfterAckHours: number
      dedupeHoursByPriority: {
        P1: number
        P2: number
        P3: number
      }
    }
    revisions: Array<{
      id: string
      effectiveDate: string
      createdByUserId: string
      source: string
      tags: string[]
      policy: {
        minPriorityToNotify: AlertPriority
        quietHoursStartUtc: number | null
        quietHoursEndUtc: number | null
        suppressAfterAckHours: number
        dedupeHoursByPriority: {
          P1: number
          P2: number
          P3: number
        }
      }
    }>
  }
}

type MetricsResponse = {
  data: {
    tenantId: string
    recentMetrics: Array<{
      id: string
      metricKey: string
      metricValue: number
      dimensions: unknown
      measuredAt: string
    }>
  }
}

type ReliabilityPanelData = {
  groundingQualityAvg: number | null
  fallbackRate: number | null
  responseP95LatencyMs: number | null
  externalProviderAvgLatencyMs: number | null
  freshnessHours: number | null
  sampleSize: number
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

function toHourOrEmpty(value: number | null): string {
  if (value === null || Number.isNaN(Number(value))) return ''
  return String(value)
}

function clampIntString(raw: string, min: number, max: number): string {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return ''
  return String(Math.max(min, Math.min(max, Math.round(parsed))))
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPrintListSection(title: string, items: string[]): string {
  if (!items.length) return ''
  const rendered = items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')
  return `<section><h3>${escapeHtml(title)}</h3><ul>${rendered}</ul></section>`
}

type IssueTone = 'critical' | 'moderate' | 'positive' | 'info'

function getIssueTone(severity: 'critical' | 'warning' | 'info', message: string): IssueTone {
  const text = message.toLowerCase()
  const hasNegatedUrgency = /(no\s+critical|no\s+urgent|no\s+stockout|without\s+critical|resolved\s+critical)/.test(text)
  const isPositive = /(improv|improved|increase|grew|growth|profitable|healthy|stable|resolved|adequate|above\s+threshold|good|excellent|on\s+track|success|achievement|no\s+critical|no\s+urgent|no\s+stockout)/.test(text)
  const isUrgent = /(urgent|immediate|critical|stockout|operating\s+at\s+a\s+loss|business\s+is\s+operating\s+at\s+a\s+loss|emergency|high\s+risk|crashed|collapsed)/.test(text)
  const isModerate = /(moderate|warning|risk|declin|spike|thin\s+margin|unresolved|attention|important|monitor)/.test(text)

  if (isPositive && !isUrgent) return 'positive'
  if (severity === 'critical' && !hasNegatedUrgency) return 'critical'
  if (severity === 'warning') return 'moderate'
  if (isUrgent && !hasNegatedUrgency) return 'critical'
  if (isModerate) return 'moderate'
  return 'info'
}

function getIssueToneUi(tone: IssueTone): { label: string; classes: string } {
  if (tone === 'critical') {
    return { label: '🚨 Critical', classes: 'border-rose-200 bg-rose-50 text-rose-700' }
  }
  if (tone === 'moderate') {
    return { label: '⚠ Moderate', classes: 'border-amber-200 bg-amber-50 text-amber-700' }
  }
  if (tone === 'positive') {
    return { label: '✅ Achievement', classes: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
  }
  return { label: 'ℹ Info', classes: 'border-sky-200 bg-sky-50 text-sky-700' }
}

function buildAutoDetectedIssueList(reply: AssistantReply): Array<{
  severity: 'critical' | 'warning' | 'info'
  message: string
  actionRequired: string
}> {
  const issues = (reply.brief?.alerts || [])
    .filter((item) => item && typeof item.message === 'string' && item.message.trim())
    .map((item) => ({
      severity: item.severity,
      message: item.message.trim(),
      actionRequired: (item.actionRequired || '').trim() || 'Review and take action',
    }))

  if (issues.length > 0) return issues

  const fallback = (reply.brief?.risks || [])
    .filter((item) => typeof item === 'string' && item.trim())
    .slice(0, 4)
    .map((risk) => {
      const lower = risk.toLowerCase()
      const hasNegatedUrgency = /(no\s+critical|no\s+urgent|no\s+stockout|without\s+critical|resolved\s+critical)/.test(lower)
      const isPositive = /(improv|improved|increase|grew|growth|profitable|healthy|stable|resolved|adequate|above\s+threshold|good|excellent|on\s+track|success|achievement|no\s+critical|no\s+urgent|no\s+stockout)/.test(lower)
      const severity: 'critical' | 'warning' | 'info' = (!hasNegatedUrgency && /(critical|urgent|immediate|stockout|operating at a loss|business is operating at a loss|loss|emergency|high risk|crashed|collapsed)/.test(lower))
        ? 'critical'
        : (/(moderate|risk|declin|spike|warning|thin margin|unresolved|attention|important|monitor)/.test(lower))
          ? 'warning'
          : isPositive
            ? 'info'
            : 'info'

      return {
        severity,
        message: risk.trim(),
        actionRequired: 'Review this risk in the latest assistant recheck',
      }
    })

  return fallback
}

function buildIncomeStreamsText(reply: AssistantReply, fallbackCurrency: string): string {
  if (!reply.incomeBreakdown) return 'Income streams unavailable for this entry.'

  const currency = reply.currencyCode || fallbackCurrency
  const breakdown = reply.incomeBreakdown
  const showSubscription = shouldShowSubscriptionIncomeRow(breakdown)

  const lines = [
    `Total Income: ${currency} ${Number(breakdown.totalIncome).toLocaleString()}`,
    `Sales: ${currency} ${Number(breakdown.salesIncome).toLocaleString()} (${Number(breakdown.streamMix.salesPct).toFixed(1)}%)`,
  ]

  if (showSubscription) {
    lines.push(
      `Subscription: ${currency} ${Number(breakdown.subscriptionIncome).toLocaleString()} (${Number(breakdown.streamMix.subscriptionPct).toFixed(1)}%)`,
    )
  }

  return lines.join('\n')
}

function buildIncomeStreamsHtml(reply: AssistantReply, fallbackCurrency: string): string {
  if (!reply.incomeBreakdown) return ''

  const currency = escapeHtml(reply.currencyCode || fallbackCurrency)
  const breakdown = reply.incomeBreakdown
  const showSubscription = shouldShowSubscriptionIncomeRow(breakdown)

  return `
    <section>
      <h3>Income Streams (30d)</h3>
      <ul>
        <li>Total Income: ${currency} ${escapeHtml(Number(breakdown.totalIncome).toLocaleString())}</li>
        <li>Sales: ${currency} ${escapeHtml(Number(breakdown.salesIncome).toLocaleString())} (${escapeHtml(Number(breakdown.streamMix.salesPct).toFixed(1))}%)</li>
        ${showSubscription
          ? `<li>Subscription: ${currency} ${escapeHtml(Number(breakdown.subscriptionIncome).toLocaleString())} (${escapeHtml(Number(breakdown.streamMix.subscriptionPct).toFixed(1))}%)</li>`
          : ''}
      </ul>
    </section>
  `
}

function buildIssuesText(reply: AssistantReply): string {
  const issues = buildAutoDetectedIssueList(reply)
  if (!issues.length) return 'No auto-detected issues.'
  return issues
    .map((issue) => {
      const tone = getIssueTone(issue.severity, issue.message)
      const label = tone === 'critical' ? 'CRITICAL' : tone === 'moderate' ? 'MODERATE' : tone === 'positive' ? 'POSITIVE' : 'INFO'
      return `[${label}] ${issue.message} | Action: ${issue.actionRequired}`
    })
    .join('\n')
}

function buildIssuesHtml(reply: AssistantReply): string {
  const issues = buildAutoDetectedIssueList(reply)
  if (!issues.length) return ''

  const rendered = issues
    .map((issue) => {
      const tone = getIssueTone(issue.severity, issue.message)
      const label = tone === 'critical' ? 'CRITICAL' : tone === 'moderate' ? 'MODERATE' : tone === 'positive' ? 'POSITIVE' : 'INFO'
      const severity = escapeHtml(label)
      const message = escapeHtml(issue.message)
      const action = escapeHtml(issue.actionRequired)
      return `<li><strong>[${severity}]</strong> ${message}<br /><em>Action:</em> ${action}</li>`
    })
    .join('')

  return `<section><h3>AI Auto-Detected Issues</h3><ul>${rendered}</ul></section>`
}

function buildAssistantPrintHtml(reply: AssistantReply): string {
  const prompt = escapeHtml(reply.prompt)
  const response = escapeHtml(reply.response).replace(/\n/g, '<br />')
  const provider = reply.provider ? `<p><strong>Provider:</strong> ${escapeHtml(reply.provider)}</p>` : ''
  const createdAt = new Date(reply.createdAt).toLocaleString()
  const incomeSection = buildIncomeStreamsHtml(reply, 'NGN')
  const issuesSection = buildIssuesHtml(reply)

  const briefSection = reply.brief
    ? `
      <section>
        <h3>Structured Brief</h3>
        <p><strong>Summary:</strong> ${escapeHtml(reply.brief.summary)}</p>
        ${buildPrintListSection('Comparative Insights', reply.brief.comparativeInsights)}
        ${buildPrintListSection('Actions', reply.brief.actions)}
        ${buildPrintListSection('Risks', reply.brief.risks)}
        ${buildPrintListSection('Follow-up Questions', reply.brief.followUpQuestions)}
        ${issuesSection}
      </section>
    `
    : ''

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Saved Enterprise AI Assistant Result</title>
        <style>
          body { font-family: "Segoe UI", Arial, sans-serif; margin: 24px; color: #111827; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          h2 { margin-top: 22px; margin-bottom: 8px; font-size: 16px; }
          h3 { margin-top: 16px; margin-bottom: 6px; font-size: 14px; }
          p, li { font-size: 13px; line-height: 1.6; }
          .meta { color: #4b5563; font-size: 12px; margin-bottom: 12px; }
          .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; background: #f9fafb; }
          ul { margin: 8px 0 0 18px; }
          @media print {
            body { margin: 12mm; }
          }
        </style>
      </head>
      <body>
        <h1>Enterprise AI Assistant Record</h1>
        <p class="meta">Generated: ${escapeHtml(createdAt)}</p>
        ${provider}

        <h2>Prompt</h2>
        <div class="card"><p>${prompt}</p></div>

        <h2>Response</h2>
        <div class="card"><p>${response}</p></div>

        ${incomeSection}

        ${briefSection}
      </body>
    </html>
  `
}

function printHtmlDocument(html: string): boolean {
  try {
    const printWindow = window.open('about:blank', '_blank', 'width=960,height=760')
    if (printWindow) {
      // Keep a detached opener to reduce cross-window coupling while retaining a usable handle.
      printWindow.opener = null
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()

      const triggerPopupPrint = () => {
        try {
          printWindow.focus()
          printWindow.print()
        } catch {
          // The iframe fallback below handles environments that block popup printing.
        }
      }

      if (printWindow.document.readyState === 'complete') {
        setTimeout(triggerPopupPrint, 80)
      } else {
        printWindow.addEventListener('load', () => setTimeout(triggerPopupPrint, 80), { once: true })
      }

      return true
    }
  } catch {
    // Fall back to iframe-based print below.
  }

  try {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'
    iframe.setAttribute('aria-hidden', 'true')

    document.body.appendChild(iframe)

    const frameWindow = iframe.contentWindow
    const frameDocument = frameWindow?.document
    if (!frameWindow || !frameDocument) {
      iframe.remove()
      return false
    }

    frameDocument.open()
    frameDocument.write(html)
    frameDocument.close()

    const triggerIframePrint = () => {
      try {
        frameWindow.focus()
        frameWindow.print()
      } finally {
        setTimeout(() => iframe.remove(), 1500)
      }
    }

    if (frameDocument.readyState === 'complete') {
      setTimeout(triggerIframePrint, 80)
    } else {
      iframe.addEventListener('load', () => setTimeout(triggerIframePrint, 80), { once: true })
    }

    return true
  } catch {
    return false
  }
}

function toCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""')
  return `"${escaped}"`
}

const MAX_ASSISTANT_PROMPT_LENGTH = 2000

function truncateForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function appendPromptLinesWithinLimit(target: string[], lines: string[], maxLength: number): number {
  let added = 0
  for (const line of lines) {
    const candidate = [...target, line].join('\n')
    if (candidate.length > maxLength) break
    target.push(line)
    added += 1
  }
  return added
}

function extractPriorityFocusFromReply(reply: AssistantReply): {
  priorityActions: string[]
  unresolvedIssues: string[]
} {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

  const actionCandidates = new Set<string>()
  const riskCandidates = new Set<string>()

  for (const item of reply.brief?.actions || []) {
    const cleaned = normalize(item)
    if (cleaned) actionCandidates.add(cleaned)
  }
  for (const item of reply.brief?.risks || []) {
    const cleaned = normalize(item)
    if (cleaned) riskCandidates.add(cleaned)
  }

  const responseLines = reply.response
    .split(/\r?\n/)
    .map((line) => normalize(line))
    .filter(Boolean)

  for (const line of responseLines) {
    const actionLike = /(p1|p2|priority|urgent|immediate|next\s*7\s*days|action|todo|to-do|reorder|follow-up)/i.test(line)
    const issueLike = /(risk|issue|unresolved|pending|blocker|worse|critical|warning|stockout|loss|declin)/i.test(line)

    if (actionLike && line.length <= 220) {
      actionCandidates.add(line)
    }
    if (issueLike && line.length <= 220) {
      riskCandidates.add(line)
    }
  }

  const byPriorityThenLength = (a: string, b: string): number => {
    const rank = (value: string): number => {
      const lower = value.toLowerCase()
      if (/\bp1\b|critical|urgent|immediate/.test(lower)) return 0
      if (/\bp2\b|important|high\s+priority/.test(lower)) return 1
      if (/\bp3\b|monitor/.test(lower)) return 2
      return 3
    }
    return rank(a) - rank(b) || a.length - b.length
  }

  const priorityActions = Array.from(actionCandidates)
    .sort(byPriorityThenLength)
    .slice(0, 12)

  const unresolvedIssues = Array.from(riskCandidates)
    .sort(byPriorityThenLength)
    .slice(0, 12)

  return { priorityActions, unresolvedIssues }
}

export default function EnterpriseAIPage() {
  const user = useAuthStore((s) => s.user)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const baseCurrency = user?.tenant?.baseCurrency || 'USD'
  const [loading, setLoading] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [branchRows, setBranchRows] = useState<Array<{ branchName: string; revenue: number; expense: number; margin: number; score: number }>>([])
  const [assistantPrompt, setAssistantPrompt] = useState('Summarize branch performance priorities for this week')
  const [assistantReplies, setAssistantReplies] = useState<AssistantReply[]>([])
  const [savedAssistantReplies, setSavedAssistantReplies] = useState<AssistantReply[]>([])
  const [assistantSavePendingIds, setAssistantSavePendingIds] = useState<Record<string, boolean>>({})
  const [assistantDeletePendingIds, setAssistantDeletePendingIds] = useState<Record<string, boolean>>({})
  const [assistantRecheckPendingIds, setAssistantRecheckPendingIds] = useState<Record<string, boolean>>({})
  const [deleteConfirmReply, setDeleteConfirmReply] = useState<AssistantReply | null>(null)
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false)
  const deleteDialogCancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const [loadedSavedReply, setLoadedSavedReply] = useState<AssistantReply | null>(null)
  const [savedAssistantSearch, setSavedAssistantSearch] = useState('')
  const [loadingSavedAssistant, setLoadingSavedAssistant] = useState(false)
  const [conversationId] = useState(() => `enterprise-ai-${Date.now()}`)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [actionStatusCounts, setActionStatusCounts] = useState<Record<string, number>>({})
  const [actionFilterStatus, setActionFilterStatus] = useState<'ALL' | ActionTrackerStatus>('ALL')
  const [actionFilterOverdueOnly, setActionFilterOverdueOnly] = useState(false)
  const [actionCandidates, setActionCandidates] = useState<Recommendation[]>([])
  const [selectedRecommendationId, setSelectedRecommendationId] = useState('')
  const [actionOwnerUserId, setActionOwnerUserId] = useState(user?.id || '')
  const [actionDueDate, setActionDueDate] = useState('')
  const [actionExpectedImpact, setActionExpectedImpact] = useState('')
  const [actionNotes, setActionNotes] = useState('')
  const [actionSaving, setActionSaving] = useState(false)
  const [actionDrafts, setActionDrafts] = useState<Record<string, ActionUpdateDraft>>({})
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null)
  const [alertPolicyDraft, setAlertPolicyDraft] = useState<AlertPolicyDraft>({
    minPriorityToNotify: 'P3',
    quietHoursStartUtc: '',
    quietHoursEndUtc: '',
    suppressAfterAckHours: '24',
    dedupeP1Hours: '2',
    dedupeP2Hours: '8',
    dedupeP3Hours: '24',
  })
  const [alertPolicyMeta, setAlertPolicyMeta] = useState<{ source: 'defaults' | 'tenant-signal'; updatedAt: string | null; signalId: string | null }>({
    source: 'defaults',
    updatedAt: null,
    signalId: null,
  })
  const [alertPolicyRevisions, setAlertPolicyRevisions] = useState<AlertPolicyResponse['data']['revisions']>([])
  const [alertPolicyLoading, setAlertPolicyLoading] = useState(false)
  const [alertPolicySaving, setAlertPolicySaving] = useState(false)
  const [restoringPolicyId, setRestoringPolicyId] = useState<string | null>(null)
  const [reliabilityLoading, setReliabilityLoading] = useState(false)
  const [reliability, setReliability] = useState<ReliabilityPanelData>({
    groundingQualityAvg: null,
    fallbackRate: null,
    responseP95LatencyMs: null,
    externalProviderAvgLatencyMs: null,
    freshnessHours: null,
    sampleSize: 0,
  })

  const canAccess = user?.role === 'SUPER_ADMIN' || user?.role === 'BUSINESS_ADMIN'

  const withTracker = (rec: Recommendation): boolean => {
    const payload = (rec.outputPayload && typeof rec.outputPayload === 'object' && !Array.isArray(rec.outputPayload))
      ? rec.outputPayload as Record<string, unknown>
      : null
    const tracker = payload?.actionTracker
    return Boolean(tracker && typeof tracker === 'object')
  }

  const loadBranchInsights = async () => {
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
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load branch insights'
      if (status === 403) setBlocked(msg)
      else toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  const refreshConsoleInsights = async () => {
    await Promise.all([
      loadBranchInsights(),
      loadSavedAssistantReplies(),
      loadReliabilityMetrics(),
    ])
  }

  const loadActionCandidates = async () => {
    try {
      const { data } = await api.get<{ data: Recommendation[] }>('/enterprise-ai/recommendations?sort=priority&status=OPEN&limit=25')
      const candidates = data.data.filter((rec) => !withTracker(rec))
      setActionCandidates(candidates)
      if (!selectedRecommendationId && candidates.length) {
        setSelectedRecommendationId(candidates[0].id)
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load action candidates'
      toast.error(msg)
    }
  }

  const loadActionItems = async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '40')
      if (actionFilterStatus !== 'ALL') params.set('status', actionFilterStatus)
      if (actionFilterOverdueOnly) params.set('overdueOnly', 'true')

      const { data } = await api.get<ActionListResponse>(`/enterprise-ai/actions?${params.toString()}`)
      setActionItems(data.data.items)
      setActionStatusCounts(data.data.statusCounts)

      const drafts: Record<string, ActionUpdateDraft> = {}
      for (const item of data.data.items) {
        drafts[item.recommendationId] = {
          status: item.tracker.status,
          realizedImpactScore: item.tracker.realizedImpactScore === null ? '' : String(item.tracker.realizedImpactScore),
          progressNote: item.tracker.progressNote || '',
        }
      }
      setActionDrafts(drafts)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load action tracker items'
      toast.error(msg)
    }
  }

  const loadAlertPolicy = async () => {
    setAlertPolicyLoading(true)
    try {
      const { data } = await api.get<AlertPolicyResponse>('/enterprise-ai/alerts/policy')
      const policy = data.data.policy
      setAlertPolicyDraft({
        minPriorityToNotify: policy.minPriorityToNotify,
        quietHoursStartUtc: toHourOrEmpty(policy.quietHoursStartUtc),
        quietHoursEndUtc: toHourOrEmpty(policy.quietHoursEndUtc),
        suppressAfterAckHours: String(policy.suppressAfterAckHours),
        dedupeP1Hours: String(policy.dedupeHoursByPriority.P1),
        dedupeP2Hours: String(policy.dedupeHoursByPriority.P2),
        dedupeP3Hours: String(policy.dedupeHoursByPriority.P3),
      })
      setAlertPolicyMeta({
        source: data.data.source,
        updatedAt: data.data.updatedAt,
        signalId: data.data.signalId,
      })
      setAlertPolicyRevisions(data.data.revisions || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load alert policy'
      toast.error(msg)
    } finally {
      setAlertPolicyLoading(false)
    }
  }

  const loadReliabilityMetrics = async () => {
    setReliabilityLoading(true)
    try {
      const { data } = await api.get<MetricsResponse>('/enterprise-ai/metrics')
      const rows = data.data.recentMetrics || []

      const grounding = rows.filter((row) => row.metricKey === 'assistant_grounding_quality_score')
      const responseLatency = rows.filter((row) => row.metricKey === 'assistant_response_latency_ms')
      const providerLatency = rows.filter((row) => row.metricKey === 'assistant_external_provider_latency_ms')
      const fallbackRows = rows.filter((row) => row.metricKey === 'assistant_external_provider_fallback_count')

      const groundingValues = grounding.map((row) => Number(row.metricValue)).filter((x) => Number.isFinite(x))
      const responseValues = responseLatency.map((row) => Number(row.metricValue)).filter((x) => Number.isFinite(x))
      const providerValues = providerLatency.map((row) => Number(row.metricValue)).filter((x) => Number.isFinite(x))

      const fallbackCount = fallbackRows.reduce((sum, row) => sum + Number(row.metricValue || 0), 0)
      const responseCount = responseLatency.length
      const latestGrounding = grounding[0]
      const latestFreshness = Number(toRecord(latestGrounding?.dimensions).freshnessHours)

      setReliability({
        groundingQualityAvg: groundingValues.length
          ? groundingValues.reduce((sum, v) => sum + v, 0) / groundingValues.length
          : null,
        fallbackRate: responseCount > 0 ? fallbackCount / responseCount : null,
        responseP95LatencyMs: percentile(responseValues, 95),
        externalProviderAvgLatencyMs: providerValues.length
          ? providerValues.reduce((sum, v) => sum + v, 0) / providerValues.length
          : null,
        freshnessHours: Number.isFinite(latestFreshness) ? latestFreshness : null,
        sampleSize: responseCount,
      })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load reliability metrics'
      toast.error(msg)
    } finally {
      setReliabilityLoading(false)
    }
  }

  const saveAlertPolicy = async (e: FormEvent) => {
    e.preventDefault()
    setAlertPolicySaving(true)
    try {
      const payload = {
        minPriorityToNotify: alertPolicyDraft.minPriorityToNotify,
        quietHoursStartUtc: alertPolicyDraft.quietHoursStartUtc.trim() === '' ? null : Number(clampIntString(alertPolicyDraft.quietHoursStartUtc, 0, 23)),
        quietHoursEndUtc: alertPolicyDraft.quietHoursEndUtc.trim() === '' ? null : Number(clampIntString(alertPolicyDraft.quietHoursEndUtc, 0, 23)),
        suppressAfterAckHours: Number(clampIntString(alertPolicyDraft.suppressAfterAckHours, 1, 24 * 14) || '24'),
        dedupeHoursByPriority: {
          P1: Number(clampIntString(alertPolicyDraft.dedupeP1Hours, 1, 48) || '2'),
          P2: Number(clampIntString(alertPolicyDraft.dedupeP2Hours, 1, 72) || '8'),
          P3: Number(clampIntString(alertPolicyDraft.dedupeP3Hours, 1, 24 * 7) || '24'),
        },
      }

      const { data } = await api.patch<AlertPolicyResponse>('/enterprise-ai/alerts/policy', payload)
      toast.success('Alert policy updated')
      const saved = data.data.policy
      setAlertPolicyDraft({
        minPriorityToNotify: saved.minPriorityToNotify,
        quietHoursStartUtc: toHourOrEmpty(saved.quietHoursStartUtc),
        quietHoursEndUtc: toHourOrEmpty(saved.quietHoursEndUtc),
        suppressAfterAckHours: String(saved.suppressAfterAckHours),
        dedupeP1Hours: String(saved.dedupeHoursByPriority.P1),
        dedupeP2Hours: String(saved.dedupeHoursByPriority.P2),
        dedupeP3Hours: String(saved.dedupeHoursByPriority.P3),
      })
      setAlertPolicyMeta({
        source: data.data.source,
        updatedAt: data.data.updatedAt,
        signalId: data.data.signalId,
      })
      setAlertPolicyRevisions(data.data.revisions || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update alert policy'
      toast.error(msg)
    } finally {
      setAlertPolicySaving(false)
    }
  }

  const restoreAlertPolicy = async (revisionId: string) => {
    setRestoringPolicyId(revisionId)
    try {
      const { data } = await api.patch<AlertPolicyResponse>('/enterprise-ai/alerts/policy', {
        restoreSignalId: revisionId,
      })
      toast.success('Policy restored from revision')
      const saved = data.data.policy
      setAlertPolicyDraft({
        minPriorityToNotify: saved.minPriorityToNotify,
        quietHoursStartUtc: toHourOrEmpty(saved.quietHoursStartUtc),
        quietHoursEndUtc: toHourOrEmpty(saved.quietHoursEndUtc),
        suppressAfterAckHours: String(saved.suppressAfterAckHours),
        dedupeP1Hours: String(saved.dedupeHoursByPriority.P1),
        dedupeP2Hours: String(saved.dedupeHoursByPriority.P2),
        dedupeP3Hours: String(saved.dedupeHoursByPriority.P3),
      })
      setAlertPolicyMeta({
        source: data.data.source,
        updatedAt: data.data.updatedAt,
        signalId: data.data.signalId,
      })
      setAlertPolicyRevisions(data.data.revisions || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to restore policy revision'
      toast.error(msg)
    } finally {
      setRestoringPolicyId(null)
    }
  }

  const runAssistantPrompt = async (promptText: string): Promise<boolean> => {
    const normalizedPrompt = promptText.trim()
    if (!normalizedPrompt) return false
    const safePrompt = truncateForPrompt(normalizedPrompt, MAX_ASSISTANT_PROMPT_LENGTH)
    setLoading(true)
    try {
      const { data } = await api.post<{ data: Recommendation }>('/enterprise-ai/recommendations', {
        recommendationType: 'NL_ASSISTANT',
        prompt: safePrompt,
        conversationId,
      })

      const payload = (data.data.outputPayload as {
        response?: string
        provider?: string
        brief?: AssistantBrief
        currencyCode?: string
        incomeBreakdown?: AssistantIncomeBreakdown
      } | undefined)
      setAssistantReplies((prev) => [
        {
          id: data.data.id,
          prompt: safePrompt,
          response: payload?.response || data.data.summary,
          createdAt: data.data.createdAt,
          currencyCode: payload?.currencyCode,
          incomeBreakdown: payload?.incomeBreakdown,
          conversationId,
          provider: payload?.provider,
          brief: payload?.brief,
        },
        ...prev,
      ])
      await loadReliabilityMetrics()
      setBlocked(null)
      return true
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } })?.response?.status
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to query assistant'
      if (status === 403) setBlocked(msg)
      else toast.error(msg)
      return false
    } finally {
      setLoading(false)
    }
  }

  const sendAssistantPrompt = async (e: FormEvent) => {
    e.preventDefault()
    await runAssistantPrompt(assistantPrompt)
  }

  const loadSavedAssistantReplies = async () => {
    setLoadingSavedAssistant(true)
    try {
      const { data } = await api.get<AssistantLibraryResponse>('/enterprise-ai/assistant-library?limit=25')
      setSavedAssistantReplies(data.data || [])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to load saved assistant responses'
      toast.error(msg)
    } finally {
      setLoadingSavedAssistant(false)
    }
  }

  const saveAssistantReply = async (reply: AssistantReply) => {
    setAssistantSavePendingIds((prev) => ({ ...prev, [reply.id]: true }))
    try {
      const { data } = await api.post<AssistantLibrarySaveResponse>('/enterprise-ai/assistant-library', {
        prompt: reply.prompt,
        response: reply.response,
        currencyCode: reply.currencyCode || baseCurrency,
        incomeBreakdown: reply.incomeBreakdown,
        conversationId: reply.conversationId || conversationId,
        provider: reply.provider,
        sourceRecommendationId: reply.id,
        brief: reply.brief,
      })
      const saved = data.data
      if (saved) {
        setSavedAssistantReplies((prev) => {
          const deduped = prev.filter((item) => item.id !== saved.id)
          return [saved, ...deduped]
        })
      } else {
        await loadSavedAssistantReplies()
      }
      toast.success('Assistant response saved for later')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to save assistant response'
      toast.error(msg)
    } finally {
      setAssistantSavePendingIds((prev) => ({ ...prev, [reply.id]: false }))
    }
  }

  const printAssistantReply = (reply: AssistantReply) => {
    let html = ''
    try {
      html = buildAssistantPrintHtml(reply)
    } catch {
      toast.error('Unable to prepare this response for printing.')
      return
    }

    const opened = printHtmlDocument(html)
    if (!opened) {
      toast.error('Unable to render print preview. Please try again.')
      return
    }
  }

  const printAutoDetectedIssues = (issues: Array<{
    severity: 'critical' | 'warning' | 'info'
    message: string
    actionRequired: string
    createdAt: string
    prompt: string
  }>) => {
    if (!issues.length) {
      toast.error('No auto-detected issues to print')
      return
    }

    const rendered = issues.map((issue) => {
      const tone = getIssueTone(issue.severity, issue.message)
      const label = tone === 'critical' ? 'CRITICAL' : tone === 'moderate' ? 'MODERATE' : tone === 'positive' ? 'ACHIEVEMENT' : 'INFO'
      return `<li><strong>[${escapeHtml(label)}]</strong> ${escapeHtml(issue.message)}<br /><em>Action:</em> ${escapeHtml(issue.actionRequired)}<br /><em>Source prompt:</em> ${escapeHtml(truncateForPrompt(issue.prompt, 180))}<br /><em>Detected:</em> ${escapeHtml(new Date(issue.createdAt).toLocaleString())}</li>`
    }).join('')

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Auto-Detected Issues</title>
          <style>
            body { font-family: "Segoe UI", Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            p, li { font-size: 13px; line-height: 1.6; }
            ul { margin: 10px 0 0 18px; }
          </style>
        </head>
        <body>
          <h1>AI Auto-Detected Issues</h1>
          <p>Generated: ${escapeHtml(new Date().toLocaleString())}</p>
          <ul>${rendered}</ul>
        </body>
      </html>
    `

    const opened = printHtmlDocument(html)
    if (!opened) {
      toast.error('Unable to render print preview. Please try again.')
    }
  }

  const deleteSavedAssistantReply = async (reply: AssistantReply) => {
    const id = reply.id
    setAssistantDeletePendingIds((prev) => ({ ...prev, [id]: true }))
    try {
      await api.delete(`/enterprise-ai/assistant-library/${id}`)
      setSavedAssistantReplies((prev) => prev.filter((item) => item.id !== id))
      if (loadedSavedReply?.id === id) {
        setLoadedSavedReply(null)
      }
      toast.success('Saved assistant entry deleted')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to delete saved assistant entry'
      toast.error(msg)
    } finally {
      setAssistantDeletePendingIds((prev) => ({ ...prev, [id]: false }))
      setDeleteDialogVisible(false)
      setDeleteConfirmReply(null)
    }
  }

  const openDeleteConfirmDialog = (reply: AssistantReply) => {
    setDeleteConfirmReply(reply)
    setDeleteDialogVisible(false)
    requestAnimationFrame(() => setDeleteDialogVisible(true))
  }

  const closeDeleteConfirmDialog = () => {
    if (!deleteConfirmReply) return
    if (assistantDeletePendingIds[deleteConfirmReply.id]) return
    setDeleteDialogVisible(false)
    setDeleteConfirmReply(null)
  }

  const buildFollowUpRecheckPrompt = (reply: AssistantReply): string => {
    const { priorityActions, unresolvedIssues } = extractPriorityFocusFromReply(reply)
    const priorPrompt = truncateForPrompt(reply.prompt, 420)
    const previousResponseCurrency = (reply.currencyCode || '').trim().toUpperCase() || null
    const currencyChanged = Boolean(previousResponseCurrency && previousResponseCurrency !== baseCurrency)

    const draftLines = [
      'Follow-up recheck request:',
      `I previously received this assistant guidance on ${new Date(reply.createdAt).toLocaleString()}.`,
      `CURRENCY_CONTEXT_CURRENT_BASE: ${baseCurrency}`,
      previousResponseCurrency ? `CURRENCY_CONTEXT_PREVIOUS_RESPONSE: ${previousResponseCurrency}` : '',
      'Conversion rule: use tenant saved exchange rates only. Do not use live or inferred market rates.',
      currencyChanged
        ? `Currency instruction: present all money in ${baseCurrency}, and include previous-currency value in brackets where relevant (example: ${baseCurrency} 1,000 (${previousResponseCurrency} ...)).`
        : `Currency instruction: present all money in ${baseCurrency}.`,
      '',
      'Original prompt:',
      priorPrompt,
      '',
      'Original key pending actions/TODO (prioritized):',
    ]

    if (priorityActions.length === 0) {
      draftLines.push('No explicit prior actions were detected.')
    } else {
      const actionLines = priorityActions.map((item, idx) => `${idx + 1}. ${item}`)
      const addedActions = appendPromptLinesWithinLimit(draftLines, actionLines, MAX_ASSISTANT_PROMPT_LENGTH)
      const omittedActions = actionLines.length - addedActions
      if (omittedActions > 0) {
        appendPromptLinesWithinLimit(
          draftLines,
          [`[${omittedActions} additional action item(s) omitted to stay within prompt size limits]`],
          MAX_ASSISTANT_PROMPT_LENGTH,
        )
      }
    }

    draftLines.push('', 'Original unresolved issues/risks (prioritized):')

    if (unresolvedIssues.length === 0) {
      draftLines.push('No explicit prior unresolved issues were detected.')
    } else {
      const riskLines = unresolvedIssues.map((item, idx) => `${idx + 1}. ${item}`)
      const addedRisks = appendPromptLinesWithinLimit(draftLines, riskLines, MAX_ASSISTANT_PROMPT_LENGTH)
      const omittedRisks = riskLines.length - addedRisks
      if (omittedRisks > 0) {
        appendPromptLinesWithinLimit(
          draftLines,
          [`[${omittedRisks} additional risk item(s) omitted to stay within prompt size limits]`],
          MAX_ASSISTANT_PROMPT_LENGTH,
        )
      }
    }

    appendPromptLinesWithinLimit(draftLines, [
      '',
      'Please reassess current status versus those actions and risks using latest tenant data.',
      'Return a concise progress recheck with:',
      '1) What has improved',
      '2) What is still unresolved',
      '3) What got worse or remains high risk',
      '4) Updated next 3 priority actions for the next 7 days',
    ], MAX_ASSISTANT_PROMPT_LENGTH)

    return draftLines.join('\n')
  }

  const loadSavedReplyOnly = (reply: AssistantReply) => {
    const followUpPrompt = buildFollowUpRecheckPrompt(reply)
    setLoadedSavedReply(reply)
    setAssistantPrompt(followUpPrompt)
    toast.success('Saved entry loaded to prompt for follow-up.')
  }

  const injectLoadedReplyRecheckPrompt = (reply: AssistantReply) => {
    const followUpPrompt = buildFollowUpRecheckPrompt(reply)
    setLoadedSavedReply(reply)
    setAssistantPrompt(followUpPrompt)
    toast.success('Follow-up recheck prompt prepared. Review and submit when ready.')
  }

  const loadSavedReplyForRecheck = async (reply: AssistantReply) => {
    const followUpPrompt = buildFollowUpRecheckPrompt(reply)
    setLoadedSavedReply(reply)
    setAssistantPrompt(followUpPrompt)
    setAssistantRecheckPendingIds((prev) => ({ ...prev, [reply.id]: true }))
    try {
      const ok = await runAssistantPrompt(followUpPrompt)
      if (ok) {
        toast.success('Saved entry loaded and follow-up recheck generated')
      } else {
        toast.error('Follow-up recheck failed. Please retry with a shorter prompt.')
      }
    } finally {
      setAssistantRecheckPendingIds((prev) => ({ ...prev, [reply.id]: false }))
    }
  }

  const exportSavedEntriesCsv = (entries: AssistantReply[]) => {
    if (!entries.length) {
      toast.error('No saved entries to export')
      return
    }

    const header = ['id', 'createdAt', 'provider', 'prompt', 'response', 'autoDetectedIssueCount', 'autoDetectedIssues']
    const rows = entries.map((entry) => [
      entry.id,
      entry.createdAt,
      entry.provider || '',
      entry.prompt,
      entry.response,
      buildAutoDetectedIssueList(entry).length,
      buildIssuesText(entry),
    ])

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => toCsvCell(String(cell))).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `saved-enterprise-ai-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV export started')
  }

  const exportSavedEntriesPdf = async (entries: AssistantReply[]) => {
    if (!entries.length) {
      toast.error('No saved entries to export')
      return
    }

    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 40
      const contentWidth = pageWidth - margin * 2
      let cursorY = margin

      const colors = {
        brand: [37, 99, 235] as const,
        text: [17, 24, 39] as const,
        muted: [107, 114, 128] as const,
        cardBg: [249, 250, 251] as const,
        cardBorder: [229, 231, 235] as const,
        sectionTitle: [30, 64, 175] as const,
      }

      const newPage = () => {
        doc.addPage()
        cursorY = margin
      }

      const ensurePageSpace = (requiredHeight: number) => {
        if (cursorY + requiredHeight > pageHeight - margin) newPage()
      }

      const writeWrapped = (
        text: string,
        fontSize = 11,
        lineHeight = 15,
        color: readonly [number, number, number] = colors.text,
      ) => {
        doc.setFontSize(fontSize)
        doc.setTextColor(color[0], color[1], color[2])
        const lines = doc.splitTextToSize(text, contentWidth) as string[]
        for (const line of lines) {
          ensurePageSpace(lineHeight)
          doc.text(line, margin, cursorY)
          cursorY += lineHeight
        }
      }

      const writeCardSection = (title: string, value: string) => {
        const cardPadding = 10
        const titleHeight = 18
        const lineHeight = 13
        const maxCardTextWidth = contentWidth - cardPadding * 2
        const fullLines = doc.splitTextToSize(value || 'N/A', maxCardTextWidth) as string[]
        const sectionGap = 10
        let remainingLines = [...fullLines]
        let continued = false

        while (remainingLines.length) {
          const availableHeight = pageHeight - margin - cursorY
          const maxLines = Math.max(1, Math.floor((availableHeight - titleHeight - cardPadding * 2) / lineHeight))
          if (maxLines <= 1) {
            newPage()
            continue
          }

          const chunk = remainingLines.splice(0, maxLines)
          const cardHeight = cardPadding * 2 + titleHeight + chunk.length * lineHeight

          ensurePageSpace(cardHeight + sectionGap)

          doc.setDrawColor(colors.cardBorder[0], colors.cardBorder[1], colors.cardBorder[2])
          doc.setFillColor(colors.cardBg[0], colors.cardBg[1], colors.cardBg[2])
          doc.roundedRect(margin, cursorY, contentWidth, cardHeight, 8, 8, 'FD')

          doc.setFont('helvetica', 'bold')
          doc.setFontSize(11)
          doc.setTextColor(colors.sectionTitle[0], colors.sectionTitle[1], colors.sectionTitle[2])
          doc.text(continued ? `${title} (cont.)` : title, margin + cardPadding, cursorY + cardPadding + 10)

          doc.setFont('helvetica', 'normal')
          doc.setFontSize(10)
          doc.setTextColor(colors.text[0], colors.text[1], colors.text[2])

          let lineY = cursorY + cardPadding + titleHeight + 10
          for (const line of chunk) {
            doc.text(line, margin + cardPadding, lineY)
            lineY += lineHeight
          }

          cursorY += cardHeight + sectionGap
          continued = true
        }
      }

      const listToText = (title: string, items: string[]) => {
        if (!items.length) return `${title}: none`
        return items.map((item) => `- ${item}`).join('\n')
      }

      doc.setFillColor(colors.brand[0], colors.brand[1], colors.brand[2])
      doc.roundedRect(margin, cursorY, contentWidth, 58, 10, 10, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16)
      doc.text(`Saved Enterprise AI Assistant Entries (${entries.length})`, margin + 14, cursorY + 24)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text(`Generated ${new Date().toLocaleString()}`, margin + 14, cursorY + 43)
      cursorY += 74

      entries.forEach((entry, index) => {
        ensurePageSpace(70)

        doc.setDrawColor(colors.cardBorder[0], colors.cardBorder[1], colors.cardBorder[2])
        doc.line(margin, cursorY, pageWidth - margin, cursorY)
        cursorY += 12

        doc.setFillColor(239, 246, 255)
        doc.roundedRect(margin, cursorY, contentWidth, 26, 6, 6, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(11)
        doc.setTextColor(30, 64, 175)
        doc.text(`Entry ${index + 1}`, margin + 10, cursorY + 17)
        cursorY += 34

        doc.setFont('helvetica', 'normal')
        writeWrapped(`Created: ${new Date(entry.createdAt).toLocaleString()}`, 10, 13, colors.muted)
        if (entry.provider) writeWrapped(`Provider: ${entry.provider}`, 10, 13, colors.muted)
        cursorY += 8

        writeCardSection('Prompt', entry.prompt)
        writeCardSection('Response', entry.response)
        writeCardSection('Income Streams (30d)', buildIncomeStreamsText(entry, baseCurrency))

        if (entry.brief) {
          writeCardSection('Structured Brief Summary', entry.brief.summary)
          writeCardSection('Actions', listToText('Actions', entry.brief.actions))
          writeCardSection('Comparative Insights', listToText('Comparative Insights', entry.brief.comparativeInsights))
          writeCardSection('Risks', listToText('Risks', entry.brief.risks))
        }

        writeCardSection('AI Auto-Detected Issues', buildIssuesText(entry))

        cursorY += 6
      })

      const pageCount = doc.getNumberOfPages()
      for (let i = 1; i <= pageCount; i += 1) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(colors.muted[0], colors.muted[1], colors.muted[2])
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 18, { align: 'right' })
      }

      doc.save(`saved-enterprise-ai-${new Date().toISOString().slice(0, 10)}.pdf`)
      toast.success('PDF export downloaded')
    } catch {
      toast.error('Unable to generate PDF export. Please try again.')
    }
  }

  const createActionFromRecommendation = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedRecommendationId) {
      toast.error('Select a recommendation to track')
      return
    }

    setActionSaving(true)
    try {
      await api.post('/enterprise-ai/actions', {
        recommendationId: selectedRecommendationId,
        ownerUserId: actionOwnerUserId || undefined,
        dueDate: actionDueDate ? new Date(actionDueDate).toISOString() : undefined,
        expectedImpactScore: actionExpectedImpact ? Number(actionExpectedImpact) : undefined,
        impactNotes: actionNotes || undefined,
      })
      toast.success('Action tracker created')
      setActionExpectedImpact('')
      setActionDueDate('')
      setActionNotes('')
      await Promise.all([loadActionItems(), loadActionCandidates()])
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create action tracker'
      toast.error(msg)
    } finally {
      setActionSaving(false)
    }
  }

  const updateActionItem = async (recommendationId: string) => {
    const draft = actionDrafts[recommendationId]
    if (!draft) return
    setUpdatingActionId(recommendationId)
    try {
      await api.patch(`/enterprise-ai/actions/${recommendationId}`, {
        status: draft.status,
        realizedImpactScore: draft.realizedImpactScore.trim() === '' ? undefined : Number(draft.realizedImpactScore),
        progressNote: draft.progressNote.trim() || undefined,
      })
      toast.success('Action updated')
      await loadActionItems()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to update action'
      toast.error(msg)
    } finally {
      setUpdatingActionId(null)
    }
  }

  useEffect(() => {
    if (canAccess) {
      void loadBranchInsights()
      void loadActionCandidates()
      void loadActionItems()
      void loadAlertPolicy()
      void loadReliabilityMetrics()
      void loadSavedAssistantReplies()
    }
  }, [canAccess])

  useEffect(() => {
    if (canAccess) {
      void loadActionItems()
    }
  }, [actionFilterStatus, actionFilterOverdueOnly])

  useEffect(() => {
    if (user?.id) setActionOwnerUserId(user.id)
  }, [user?.id])

  useEffect(() => {
    if (!deleteConfirmReply) return

    const isDeleting = Boolean(assistantDeletePendingIds[deleteConfirmReply.id])
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        setDeleteDialogVisible(false)
        setDeleteConfirmReply(null)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!isDeleting) {
      setTimeout(() => {
        deleteDialogCancelButtonRef.current?.focus()
      }, 0)
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [deleteConfirmReply, assistantDeletePendingIds])

  const rankingSummary = useMemo(() => {
    if (!branchRows.length) return 'No branch performance recommendations yet.'
    const lead = branchRows[0]
    return `${lead.branchName} currently leads with margin ${lead.margin.toFixed(2)}.`
  }, [branchRows])

  const actionSummary = useMemo(() => {
    const total = actionItems.length
    const overdue = actionItems.filter((item) => {
      if (!item.tracker.dueDate) return false
      if (item.tracker.status === 'DONE' || item.tracker.status === 'CANCELLED') return false
      return new Date(item.tracker.dueDate).getTime() < Date.now()
    }).length
    const inProgress = actionStatusCounts.IN_PROGRESS || 0
    const done = actionStatusCounts.DONE || 0
    return { total, overdue, inProgress, done }
  }, [actionItems, actionStatusCounts])

  const savedSourceIds = useMemo(() => {
    return new Set(savedAssistantReplies.map((item) => item.sourceRecommendationId).filter((id): id is string => Boolean(id)))
  }, [savedAssistantReplies])

  const filteredSavedAssistantReplies = useMemo(() => {
    const needle = savedAssistantSearch.trim().toLowerCase()
    if (!needle) return savedAssistantReplies
    return savedAssistantReplies.filter((item) => {
      return item.prompt.toLowerCase().includes(needle)
        || item.response.toLowerCase().includes(needle)
        || (item.provider || '').toLowerCase().includes(needle)
    })
  }, [savedAssistantReplies, savedAssistantSearch])

  const loadedSavedReplyFocus = useMemo(() => {
    if (!loadedSavedReply) {
      return { priorityActions: [] as string[], unresolvedIssues: [] as string[] }
    }
    return extractPriorityFocusFromReply(loadedSavedReply)
  }, [loadedSavedReply])

  const autoDetectedIssues = useMemo(() => {
    const sourceReplies = assistantReplies.length ? assistantReplies : savedAssistantReplies
    const top = sourceReplies.slice(0, 6)
    const deduped = new Map<string, {
      severity: 'critical' | 'warning' | 'info'
      message: string
      actionRequired: string
      createdAt: string
      prompt: string
    }>()

    for (const reply of top) {
      const issues = buildAutoDetectedIssueList(reply)
      for (const issue of issues) {
        const key = `${issue.severity}:${issue.message.toLowerCase()}`
        if (!deduped.has(key)) {
          deduped.set(key, {
            ...issue,
            createdAt: reply.createdAt,
            prompt: reply.prompt,
          })
        }
      }
    }

    const weight = { critical: 0, warning: 1, info: 2 }
    return Array.from(deduped.values())
      .sort((a, b) => {
        const severityDelta = weight[a.severity] - weight[b.severity]
        if (severityDelta !== 0) return severityDelta
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      .slice(0, 8)
  }, [assistantReplies, savedAssistantReplies])

  if (!user) return <Navigate to="/login" replace />
  if (!canAccess) return <Navigate to="/dashboard" replace />

  return (
    <div className="relative w-full overflow-hidden">
      <div className={`pointer-events-none absolute inset-y-0 right-0 hidden lg:block ${sidebarOpen ? 'w-64' : 'w-16'}`}>
        <div className="h-full border-l border-cyan-100/80 bg-gradient-to-b from-cyan-50 via-white to-indigo-50" />
        <div className={`absolute inset-x-3 top-6 space-y-3 pointer-events-auto transition-opacity ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`}>
          <div className="rounded-xl border border-cyan-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-700">AI Focus Rail</p>
            <p className="mt-1 text-xs text-slate-600">Actionable zones for pending priorities and unresolved issues.</p>
          </div>
          <div className="rounded-xl border border-indigo-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Priority Levels</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-700">P1 Urgent</span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">P2 Important</span>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">P3 Monitor</span>
            </div>
          </div>
          <div className="rounded-xl border border-amber-200/80 bg-white/90 p-3 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">AI Auto-Detected Issues</p>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                  {autoDetectedIssues.length}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700 transition-colors hover:bg-sky-100"
                  onClick={() => printAutoDetectedIssues(autoDetectedIssues)}
                >
                  <Printer className="w-3 h-3" /> Print
                </button>
              </div>
            </div>

            {autoDetectedIssues.length === 0 ? (
              <p className="mt-2 text-xs text-slate-600">No anomalies surfaced yet.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {autoDetectedIssues.slice(0, 4).map((issue, idx) => {
                  const tone = getIssueTone(issue.severity, issue.message)
                  const toneUi = getIssueToneUi(tone)

                  return (
                    <div key={`${issue.severity}-rail-${idx}`} className="rounded-lg border border-slate-200 bg-white p-2">
                      <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${toneUi.classes}`}>
                        {toneUi.label}
                      </span>
                      <p className="mt-1 text-[11px] font-medium text-slate-800 leading-tight">{issue.message}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`relative p-4 sm:p-6 space-y-6 w-full ${sidebarOpen ? 'lg:max-w-[calc(100%-16rem)]' : 'lg:max-w-[calc(100%-4rem)]'}`}
      >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise AI Console</h1>
          <p className="text-sm text-gray-500 mt-1">Branch performance insights and Enterprise Assistant for Enterprise tenants.</p>
        </div>
        <button className="btn-primary" onClick={() => { void refreshConsoleInsights() }} disabled={loading}>
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

      <div className="space-y-6">
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h2 className="font-semibold text-gray-900">Branch Performance Insights</h2>
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
            <h2 className="font-semibold text-gray-900">Enterprise Assistant</h2>
          </div>

          <form className="space-y-3" onSubmit={sendAssistantPrompt}>
            {loadedSavedReply && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Loaded For Follow-up Recheck</p>
                <p className="text-sm text-indigo-900 mt-1"><span className="font-semibold">Original prompt:</span> {loadedSavedReply.prompt}</p>
                {loadedSavedReplyFocus.priorityActions.length ? (
                  <ul className="list-disc pl-5 text-sm text-indigo-900 mt-2 space-y-1">
                    {loadedSavedReplyFocus.priorityActions.slice(0, 6).map((item, idx) => (
                      <li key={`${loadedSavedReply.id}-loaded-action-${idx}`}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                {loadedSavedReplyFocus.unresolvedIssues.length ? (
                  <div className="mt-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Unresolved Issues</p>
                    <ul className="list-disc pl-5 text-sm text-indigo-900 mt-1 space-y-1">
                      {loadedSavedReplyFocus.unresolvedIssues.slice(0, 5).map((item, idx) => (
                        <li key={`${loadedSavedReply.id}-loaded-risk-${idx}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                    onClick={() => injectLoadedReplyRecheckPrompt(loadedSavedReply)}
                  >
                    Use For Prompt
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={assistantRecheckPendingIds[loadedSavedReply.id] || loading}
                    onClick={() => { void loadSavedReplyForRecheck(loadedSavedReply) }}
                  >
                    <TrendingUp className="w-4 h-4" /> {assistantRecheckPendingIds[loadedSavedReply.id] ? 'Rechecking...' : 'Run Recheck Now'}
                  </button>
                </div>
              </div>
            )}
            <textarea
              className="input min-h-[110px]"
              value={assistantPrompt}
              onChange={(e) => setAssistantPrompt(e.target.value)}
              placeholder="Ask for scoped recommendations, e.g. Which branch should reduce discount leakage this week?"
            />
            <button className="btn-primary" type="submit" disabled={loading}>Ask Assistant</button>
          </form>

          <div className="space-y-3 max-h-[420px] lg:max-h-[520px] overflow-auto pr-1">
            {assistantReplies.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gradient-to-br from-white to-gray-50 p-5 text-center">
                <p className="text-sm font-medium text-gray-600">No assistant response yet.</p>
                <p className="text-xs text-gray-500 mt-1">Ask a focused question to start your strategy history.</p>
              </div>
            ) : (
              assistantReplies.map((reply) => (
                <div key={reply.id} className="rounded-xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/30 to-white p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      Assistant Reply
                    </span>
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-500">
                      {new Date(reply.createdAt).toLocaleString()}
                    </span>
                    {reply.provider && (
                      <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                        {reply.provider}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Prompt</p>
                    <p className="text-sm text-gray-800 mt-1 leading-relaxed">{reply.prompt}</p>
                  </div>

                  <div className="mt-3 rounded-lg border border-gray-100 bg-white p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Response</p>
                  {reply.brief ? (
                    <div className="mt-2 space-y-3">
                      {reply.incomeBreakdown && (
                        <div className="rounded-md border border-cyan-100 bg-cyan-50 p-3">
                          <p className="text-xs font-semibold text-cyan-700">Income Streams (30d)</p>
                          <div className={`mt-2 grid grid-cols-1 ${shouldShowSubscriptionIncomeRow(reply.incomeBreakdown) ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-2 text-xs`}>
                            <div className="rounded border border-cyan-200 bg-white p-2">
                              <p className="text-cyan-600 font-semibold">Total Income</p>
                              <p className="text-slate-800 mt-1">{reply.currencyCode || baseCurrency} {Number(reply.incomeBreakdown.totalIncome).toLocaleString()}</p>
                            </div>
                            <div className="rounded border border-cyan-200 bg-white p-2">
                              <p className="text-cyan-600 font-semibold">Sales</p>
                              <p className="text-slate-800 mt-1">{reply.currencyCode || baseCurrency} {Number(reply.incomeBreakdown.salesIncome).toLocaleString()} ({Number(reply.incomeBreakdown.streamMix.salesPct).toFixed(1)}%)</p>
                            </div>
                            {shouldShowSubscriptionIncomeRow(reply.incomeBreakdown) && (
                              <div className="rounded border border-cyan-200 bg-white p-2">
                                <p className="text-cyan-600 font-semibold">Subscription</p>
                                <p className="text-slate-800 mt-1">{reply.currencyCode || baseCurrency} {Number(reply.incomeBreakdown.subscriptionIncome).toLocaleString()} ({Number(reply.incomeBreakdown.streamMix.subscriptionPct).toFixed(1)}%)</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Summary</p>
                        <p className="text-sm text-gray-800 mt-1 leading-relaxed">{reply.brief.summary}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Comparative Insights</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.comparativeInsights.map((item, idx) => (
                            <li key={`${reply.id}-insight-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Actions (next 7 days)</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.actions.map((item, idx) => (
                            <li key={`${reply.id}-action-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Risks</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.risks.map((item, idx) => (
                            <li key={`${reply.id}-risk-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      {reply.brief.alerts && reply.brief.alerts.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-600">Auto-Detected Issues</p>
                          <div className="mt-1 space-y-2">
                            {reply.brief.alerts.map((alert, idx) => {
                              const tone = getIssueTone(alert.severity, alert.message)
                              const toneUi = getIssueToneUi(tone)

                              return (
                                <div key={`${reply.id}-alert-${idx}`} className="rounded-md border border-gray-200 bg-gray-50 p-2">
                                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${toneUi.classes}`}>
                                    {toneUi.label}
                                  </span>
                                  <p className="text-sm text-gray-900 mt-1">{alert.message}</p>
                                  <p className="text-xs text-gray-700 mt-1"><span className="font-semibold">Action:</span> {alert.actionRequired}</p>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-gray-600">Follow-up Questions</p>
                        <ul className="list-disc pl-5 text-sm text-gray-800 mt-1 space-y-1">
                          {reply.brief.followUpQuestions.map((item, idx) => (
                            <li key={`${reply.id}-followup-${idx}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      {reply.provider && (
                        <p className="text-[11px] text-gray-500">Generated via: {reply.provider}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-800 mt-1 whitespace-pre-line">{reply.response}</p>
                  )}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={assistantSavePendingIds[reply.id] || savedSourceIds.has(reply.id)}
                      onClick={() => { void saveAssistantReply(reply) }}
                    >
                      <Save className="w-4 h-4" />
                      {savedSourceIds.has(reply.id) ? 'Saved' : assistantSavePendingIds[reply.id] ? 'Saving...' : 'Save for later'}
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100"
                      onClick={() => printAssistantReply(reply)}
                    >
                      <Printer className="w-4 h-4" />
                      Print
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="pt-2 border-t border-gray-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Saved for later</p>
                <p className="text-[11px] text-gray-400 mt-0.5">Search, recheck progress, export, and print from your strategy archive.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100" type="button" onClick={() => { void exportSavedEntriesPdf(filteredSavedAssistantReplies) }}>
                  <FileText className="w-4 h-4" /> Export PDF
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100" type="button" onClick={() => exportSavedEntriesCsv(filteredSavedAssistantReplies)}>
                  <Download className="w-4 h-4" /> Export CSV
                </button>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => { void loadSavedAssistantReplies() }} disabled={loadingSavedAssistant}>
                  <RefreshCw className={`w-4 h-4 ${loadingSavedAssistant ? 'animate-spin' : ''}`} /> Refresh Saved
                </button>
              </div>
            </div>
            <div className="mt-2 relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
              <input
                className="input pl-8"
                value={savedAssistantSearch}
                onChange={(e) => setSavedAssistantSearch(e.target.value)}
                placeholder="Search saved prompts and responses"
              />
            </div>
            <div className="mt-2 space-y-2 max-h-64 lg:max-h-80 overflow-auto pr-1">
              {filteredSavedAssistantReplies.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">No saved assistant entries yet.</p>
                </div>
              ) : (
                filteredSavedAssistantReplies.map((reply) => (
                  <div key={reply.id} className="rounded-lg border border-gray-200 p-3 bg-white shadow-sm transition-all duration-200 hover:shadow-md hover:border-indigo-200">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Saved Reply</span>
                      {reply.provider && <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">{reply.provider}</span>}
                    </div>
                    <p className="text-xs text-gray-700 line-clamp-2"><span className="font-semibold">Prompt:</span> {reply.prompt}</p>
                    <p className="text-[11px] text-gray-500 mt-1 line-clamp-2"><span className="font-semibold">Response:</span> {reply.response}</p>
                    {reply.brief?.alerts && reply.brief.alerts.length > 0 && (
                      <p className="text-[11px] text-amber-700 mt-1 font-medium">Auto-detected issues: {reply.brief.alerts.length}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-gray-400">{new Date(reply.createdAt).toLocaleString()}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                          onClick={() => loadSavedReplyOnly(reply)}
                        >
                          <Search className="w-4 h-4" /> Load To Prompt
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={assistantRecheckPendingIds[reply.id] || loading}
                          onClick={() => { void loadSavedReplyForRecheck(reply) }}
                        >
                          <TrendingUp className="w-4 h-4" /> {assistantRecheckPendingIds[reply.id] ? 'Rechecking...' : 'Load & Recheck'}
                        </button>
                        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100" onClick={() => printAssistantReply(reply)}>
                          <Printer className="w-4 h-4" /> Print
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={assistantDeletePendingIds[reply.id]}
                          onClick={() => openDeleteConfirmDialog(reply)}
                        >
                          <Trash2 className="w-4 h-4" /> {assistantDeletePendingIds[reply.id] ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {deleteConfirmReply && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 transition-opacity duration-200 ${deleteDialogVisible ? 'opacity-100' : 'opacity-0'}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteConfirmDialog()
            }
          }}
        >
          <div
            className={`w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${deleteDialogVisible ? 'translate-y-0 scale-100' : 'translate-y-2 scale-95'}`}
            role="dialog"
            aria-modal="true"
            aria-label="Delete saved assistant entry"
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-lg font-semibold text-slate-900">Delete Saved Assistant Entry?</p>
              <p className="text-sm text-slate-500 mt-1">This action is permanent and cannot be undone.</p>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Prompt Preview</p>
                <p className="text-sm text-slate-800 mt-1">
                  {deleteConfirmReply.prompt.length > 200
                    ? `${deleteConfirmReply.prompt.slice(0, 200)}...`
                    : deleteConfirmReply.prompt}
                </p>
              </div>
              <p className="text-xs text-slate-500">Created: {new Date(deleteConfirmReply.createdAt).toLocaleString()}</p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className="btn-secondary"
                ref={deleteDialogCancelButtonRef}
                onClick={closeDeleteConfirmDialog}
                disabled={assistantDeletePendingIds[deleteConfirmReply.id]}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary bg-rose-600 hover:bg-rose-700"
                onClick={() => { void deleteSavedAssistantReply(deleteConfirmReply) }}
                disabled={assistantDeletePendingIds[deleteConfirmReply.id]}
              >
                {assistantDeletePendingIds[deleteConfirmReply.id] ? 'Deleting...' : 'Yes, Delete Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-cyan-700" />
            <h2 className="font-semibold text-gray-900">Reliability and Accuracy</h2>
          </div>
          <button className="btn-secondary" onClick={() => { void loadReliabilityMetrics() }} disabled={reliabilityLoading}>
            <RefreshCw className={`w-4 h-4 ${reliabilityLoading ? 'animate-spin' : ''}`} /> Refresh Metrics
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Track assistant quality in production using grounding score, fallback rate, and latency. Use this panel to detect drift before response quality degrades.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">Grounding Quality (avg)</p>
            <p className="text-lg font-semibold text-gray-900">
              {reliability.groundingQualityAvg === null ? 'n/a' : reliability.groundingQualityAvg.toFixed(2)}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">Fallback Rate</p>
            <p className="text-lg font-semibold text-gray-900">
              {reliability.fallbackRate === null ? 'n/a' : `${(reliability.fallbackRate * 100).toFixed(1)}%`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">Assistant Latency (p95)</p>
            <p className="text-lg font-semibold text-gray-900">
              {reliability.responseP95LatencyMs === null ? 'n/a' : `${Math.round(reliability.responseP95LatencyMs)}ms`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">External LLM Latency (avg)</p>
            <p className="text-lg font-semibold text-gray-900">
              {reliability.externalProviderAvgLatencyMs === null ? 'n/a' : `${Math.round(reliability.externalProviderAvgLatencyMs)}ms`}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">Data Freshness</p>
            <p className="text-lg font-semibold text-gray-900">
              {reliability.freshnessHours === null ? 'n/a' : `${reliability.freshnessHours.toFixed(1)}h`}
            </p>
          </div>
        </div>

        <p className="text-xs text-gray-500">Sample size: {reliability.sampleSize} assistant response metric(s).</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-violet-600" />
            <h2 className="font-semibold text-gray-900">Alert Fatigue Policy</h2>
          </div>
          <button className="btn-secondary" onClick={() => { void loadAlertPolicy() }} disabled={alertPolicyLoading}>
            <RefreshCw className={`w-4 h-4 ${alertPolicyLoading ? 'animate-spin' : ''}`} /> Refresh Policy
          </button>
        </div>

        <p className="text-sm text-gray-600">
          Tune enterprise alert noise controls for this tenant. Scheduler emits only alerts that pass priority, quiet-hours, ack-cooldown, and dedupe checks.
        </p>

        <form className="rounded-xl border border-gray-100 p-4 bg-gray-50 space-y-3" onSubmit={saveAlertPolicy}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            <label className="text-sm text-gray-700">
              Minimum priority
              <select
                className="input mt-1"
                value={alertPolicyDraft.minPriorityToNotify}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, minPriorityToNotify: e.target.value as AlertPriority }))}
              >
                <option value="P1">P1 only</option>
                <option value="P2">P1 + P2</option>
                <option value="P3">P1 + P2 + P3</option>
              </select>
            </label>

            <label className="text-sm text-gray-700">
              Quiet start (UTC hour)
              <input
                className="input mt-1"
                type="number"
                min={0}
                max={23}
                value={alertPolicyDraft.quietHoursStartUtc}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, quietHoursStartUtc: e.target.value }))}
                placeholder="blank = disabled"
              />
            </label>

            <label className="text-sm text-gray-700">
              Quiet end (UTC hour)
              <input
                className="input mt-1"
                type="number"
                min={0}
                max={23}
                value={alertPolicyDraft.quietHoursEndUtc}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, quietHoursEndUtc: e.target.value }))}
                placeholder="blank = disabled"
              />
            </label>

            <label className="text-sm text-gray-700">
              Suppress after read (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={336}
                value={alertPolicyDraft.suppressAfterAckHours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, suppressAfterAckHours: e.target.value }))}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm text-gray-700">
              Dedupe P1 (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={48}
                value={alertPolicyDraft.dedupeP1Hours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, dedupeP1Hours: e.target.value }))}
              />
            </label>
            <label className="text-sm text-gray-700">
              Dedupe P2 (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={72}
                value={alertPolicyDraft.dedupeP2Hours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, dedupeP2Hours: e.target.value }))}
              />
            </label>
            <label className="text-sm text-gray-700">
              Dedupe P3 (hours)
              <input
                className="input mt-1"
                type="number"
                min={1}
                max={168}
                value={alertPolicyDraft.dedupeP3Hours}
                onChange={(e) => setAlertPolicyDraft((prev) => ({ ...prev, dedupeP3Hours: e.target.value }))}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Source: {alertPolicyMeta.source} {alertPolicyMeta.updatedAt ? `• Updated ${new Date(alertPolicyMeta.updatedAt).toLocaleString()}` : ''}
            </p>
            <button className="btn-primary" type="submit" disabled={alertPolicySaving}>
              {alertPolicySaving ? 'Saving Policy...' : 'Save Policy'}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-100 p-4 bg-white space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-gray-800">Recent Policy Revisions</p>
            <p className="text-xs text-gray-500">Showing last {alertPolicyRevisions.length} revision(s)</p>
          </div>

          {alertPolicyRevisions.length === 0 ? (
            <p className="text-sm text-gray-500">No policy revisions found yet.</p>
          ) : (
            <div className="space-y-2 max-h-[280px] overflow-auto">
              {alertPolicyRevisions.map((revision, idx) => {
                const isCurrent = revision.id === alertPolicyMeta.signalId
                return (
                  <div key={revision.id} className="rounded-lg border border-gray-100 p-3 bg-gray-50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-gray-600">
                        Rev {idx + 1} • {new Date(revision.effectiveDate).toLocaleString()} • {revision.source}
                      </p>
                      <button
                        className="btn-secondary"
                        disabled={isCurrent || restoringPolicyId === revision.id}
                        onClick={() => { void restoreAlertPolicy(revision.id) }}
                      >
                        {isCurrent ? 'Current' : restoringPolicyId === revision.id ? 'Restoring...' : 'Restore'}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      min: {revision.policy.minPriorityToNotify} • quiet: {revision.policy.quietHoursStartUtc ?? 'none'}-{revision.policy.quietHoursEndUtc ?? 'none'} • ack: {revision.policy.suppressAfterAckHours}h
                    </p>
                    <p className="text-xs text-gray-500">
                      dedupe: P1 {revision.policy.dedupeHoursByPriority.P1}h / P2 {revision.policy.dedupeHoursByPriority.P2}h / P3 {revision.policy.dedupeHoursByPriority.P3}h
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-sky-600" />
            <h2 className="font-semibold text-gray-900">Action Tracker Board</h2>
          </div>
          <button className="btn-secondary" onClick={() => { void Promise.all([loadActionItems(), loadActionCandidates()]) }}>
            <RefreshCw className="w-4 h-4" /> Refresh Board
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-100 p-3 bg-gray-50">
            <p className="text-xs text-gray-500">Tracked Actions</p>
            <p className="text-lg font-semibold text-gray-900">{actionSummary.total}</p>
          </div>
          <div className="rounded-lg border border-rose-100 p-3 bg-rose-50">
            <p className="text-xs text-rose-700">Overdue</p>
            <p className="text-lg font-semibold text-rose-900">{actionSummary.overdue}</p>
          </div>
          <div className="rounded-lg border border-amber-100 p-3 bg-amber-50">
            <p className="text-xs text-amber-700">In Progress</p>
            <p className="text-lg font-semibold text-amber-900">{actionSummary.inProgress}</p>
          </div>
          <div className="rounded-lg border border-emerald-100 p-3 bg-emerald-50">
            <p className="text-xs text-emerald-700">Done</p>
            <p className="text-lg font-semibold text-emerald-900">{actionSummary.done}</p>
          </div>
        </div>

        <form className="rounded-xl border border-gray-100 p-4 bg-gray-50 space-y-3" onSubmit={createActionFromRecommendation}>
          <p className="text-sm font-medium text-gray-800">Create tracked action from recommendation</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <select className="input" value={selectedRecommendationId} onChange={(e) => setSelectedRecommendationId(e.target.value)}>
              {actionCandidates.length === 0 ? (
                <option value="">No open recommendations available</option>
              ) : (
                actionCandidates.map((rec) => (
                  <option key={rec.id} value={rec.id}>{rec.title}</option>
                ))
              )}
            </select>
            <input className="input" value={actionOwnerUserId} onChange={(e) => setActionOwnerUserId(e.target.value)} placeholder="Owner user id" />
            <input className="input" type="datetime-local" value={actionDueDate} onChange={(e) => setActionDueDate(e.target.value)} />
            <input className="input" type="number" min={-100} max={100} value={actionExpectedImpact} onChange={(e) => setActionExpectedImpact(e.target.value)} placeholder="Expected impact score (-100 to 100)" />
          </div>
          <textarea className="input" value={actionNotes} onChange={(e) => setActionNotes(e.target.value)} placeholder="Impact notes" />
          <button className="btn-primary" type="submit" disabled={actionSaving || actionCandidates.length === 0}>Create Action</button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[220px]" value={actionFilterStatus} onChange={(e) => setActionFilterStatus(e.target.value as 'ALL' | ActionTrackerStatus)}>
            <option value="ALL">All statuses</option>
            <option value="TODO">TODO</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="BLOCKED">BLOCKED</option>
            <option value="DONE">DONE</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={actionFilterOverdueOnly} onChange={(e) => setActionFilterOverdueOnly(e.target.checked)} />
            Overdue only
          </label>
        </div>

        <div className="space-y-3 max-h-[420px] overflow-auto">
          {actionItems.length === 0 ? (
            <p className="text-sm text-gray-500">No tracked actions yet.</p>
          ) : (
            actionItems.map((item) => {
              const draft = actionDrafts[item.recommendationId]
              const dueTs = item.tracker.dueDate ? new Date(item.tracker.dueDate).getTime() : null
              const overdue = dueTs !== null && dueTs < Date.now() && item.tracker.status !== 'DONE' && item.tracker.status !== 'CANCELLED'
              return (
                <div key={item.recommendationId} className="rounded-lg border border-gray-100 p-3 bg-white space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{item.recommendationType} • Owner: {item.tracker.ownerUserId}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${overdue ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                      {overdue ? 'OVERDUE' : item.tracker.status}
                    </span>
                  </div>

                  <p className="text-sm text-gray-700">{item.summary}</p>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2">
                      <p className="text-[11px] text-gray-500 uppercase">Expected Impact</p>
                      <p className="text-sm font-medium text-gray-900">{item.tracker.expectedImpactScore ?? 'n/a'}</p>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2">
                      <p className="text-[11px] text-gray-500 uppercase">Realized Impact</p>
                      <p className="text-sm font-medium text-gray-900">{item.tracker.realizedImpactScore ?? 'n/a'}</p>
                    </div>
                    <div className="rounded-md bg-gray-50 border border-gray-100 p-2">
                      <p className="text-[11px] text-gray-500 uppercase">Due</p>
                      <p className="text-sm font-medium text-gray-900">{item.tracker.dueDate ? new Date(item.tracker.dueDate).toLocaleString() : 'No due date'}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <select
                      className="input"
                      value={draft?.status || item.tracker.status}
                      onChange={(e) => setActionDrafts((prev) => ({
                        ...prev,
                        [item.recommendationId]: {
                          status: e.target.value as ActionTrackerStatus,
                          realizedImpactScore: prev[item.recommendationId]?.realizedImpactScore || '',
                          progressNote: prev[item.recommendationId]?.progressNote || '',
                        },
                      }))}
                    >
                      <option value="TODO">TODO</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="BLOCKED">BLOCKED</option>
                      <option value="DONE">DONE</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                    <input
                      className="input"
                      type="number"
                      min={-100}
                      max={100}
                      placeholder="Realized impact"
                      value={draft?.realizedImpactScore || ''}
                      onChange={(e) => setActionDrafts((prev) => ({
                        ...prev,
                        [item.recommendationId]: {
                          status: prev[item.recommendationId]?.status || item.tracker.status,
                          realizedImpactScore: e.target.value,
                          progressNote: prev[item.recommendationId]?.progressNote || '',
                        },
                      }))}
                    />
                    <button
                      className="btn-primary"
                      disabled={updatingActionId === item.recommendationId}
                      onClick={() => { void updateActionItem(item.recommendationId) }}
                    >
                      {updatingActionId === item.recommendationId ? 'Saving...' : 'Save Update'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-center">
                    <input
                      className="input"
                      placeholder="Progress note"
                      value={draft?.progressNote || ''}
                      onChange={(e) => setActionDrafts((prev) => ({
                        ...prev,
                        [item.recommendationId]: {
                          status: prev[item.recommendationId]?.status || item.tracker.status,
                          realizedImpactScore: prev[item.recommendationId]?.realizedImpactScore || '',
                          progressNote: e.target.value,
                        },
                      }))}
                    />
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <CalendarDays className="w-4 h-4" /> Updated {new Date(item.tracker.updatedAt).toLocaleString()}
                      <TrendingUp className="w-4 h-4 ml-2" /> Recommendation status: {item.recommendationStatus}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
