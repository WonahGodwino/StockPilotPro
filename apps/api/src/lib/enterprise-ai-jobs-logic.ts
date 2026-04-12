type RecommendationType = 'BRANCH_PERFORMANCE' | 'CASHFLOW_FORECAST' | 'EXPENSE_RISK_ALERT'

export type ScheduledSignalLike = {
  signalClass?: 'PUBLIC' | 'PLATFORM' | 'TENANT'
  source?: string
  signalKey?: string
  signalValue?: unknown
  tags?: unknown
}

export type AdaptiveAlert = {
  priority: 'P1' | 'P2' | 'P3'
  alertKey: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  message: string
  reasonCodes: string[]
}

export type EnterpriseAiAlertPolicy = {
  minPriorityToNotify: 'P1' | 'P2' | 'P3'
  quietHoursStartUtc: number | null
  quietHoursEndUtc: number | null
  suppressAfterAckHours: number
  dedupeHoursByPriority: {
    P1: number
    P2: number
    P3: number
  }
}

export type AlertSuppressionReason = 'PRIORITY_BELOW_MIN' | 'QUIET_HOURS' | 'ACK_COOLDOWN'

type AlertRuleContext = {
  txCount: number
  revenuePct: number
  expensePct: number
  netPct: number
  externalSeverity: 'LOW' | 'MEDIUM' | 'HIGH'
}

type AlertRule = {
  priority: 'P1' | 'P2' | 'P3'
  alertKey: string
  reasonCodes: string[]
  when: (ctx: AlertRuleContext) => boolean
  message: (ctx: AlertRuleContext) => string
}

type SnapshotLike = {
  horizon?: {
    last30?: {
      txCount?: number
      revenue?: number
      expense?: number
      net?: number
    }
  }
  horizonDeltas?: {
    h30?: {
      revenuePct?: number
      netPct?: number
      expensePct?: number
    }
  }
  branchMetrics?: Array<{
    branchName?: string
    revenue?: number
    expense?: number
    margin?: number
    score?: number
  }>
}

function toNumber(value: unknown): number {
  return Number(value || 0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
}

function toPriority(value: unknown): 'P1' | 'P2' | 'P3' | null {
  const raw = String(value || '').trim().toUpperCase()
  if (raw === 'P1' || raw === 'P2' || raw === 'P3') return raw
  return null
}

function toHour(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < 0 || rounded > 23) return null
  return rounded
}

const PRIORITY_RANK: Record<'P1' | 'P2' | 'P3', number> = {
  P1: 3,
  P2: 2,
  P3: 1,
}

export function getDefaultEnterpriseAiAlertPolicy(): EnterpriseAiAlertPolicy {
  const minPriority = toPriority(process.env.ENTERPRISE_AI_ALERT_MIN_PRIORITY) || 'P3'
  const quietStart = toHour(process.env.ENTERPRISE_AI_ALERT_QUIET_START_UTC)
  const quietEnd = toHour(process.env.ENTERPRISE_AI_ALERT_QUIET_END_UTC)

  return {
    minPriorityToNotify: minPriority,
    quietHoursStartUtc: quietStart,
    quietHoursEndUtc: quietEnd,
    suppressAfterAckHours: clamp(Number(process.env.ENTERPRISE_AI_ALERT_ACK_SUPPRESS_HOURS || 24), 1, 24 * 14),
    dedupeHoursByPriority: {
      P1: clamp(Number(process.env.ENTERPRISE_AI_ALERT_DEDUPE_HOURS_P1 || 2), 1, 48),
      P2: clamp(Number(process.env.ENTERPRISE_AI_ALERT_DEDUPE_HOURS_P2 || 8), 1, 72),
      P3: clamp(Number(process.env.ENTERPRISE_AI_ALERT_DEDUPE_HOURS_P3 || 24), 1, 24 * 7),
    },
  }
}

export function parseEnterpriseAiAlertPolicy(value: unknown): Partial<EnterpriseAiAlertPolicy> {
  const data = toRecord(value)
  const dedupeRecord = toRecord(data.dedupeHoursByPriority)
  const minPriority = toPriority(data.minPriorityToNotify)

  const dedupeP1 = Number(dedupeRecord.P1)
  const dedupeP2 = Number(dedupeRecord.P2)
  const dedupeP3 = Number(dedupeRecord.P3)

  return {
    minPriorityToNotify: minPriority || undefined,
    quietHoursStartUtc: toHour(data.quietHoursStartUtc),
    quietHoursEndUtc: toHour(data.quietHoursEndUtc),
    suppressAfterAckHours: Number.isFinite(Number(data.suppressAfterAckHours))
      ? clamp(Number(data.suppressAfterAckHours), 1, 24 * 14)
      : undefined,
    dedupeHoursByPriority: {
      P1: Number.isFinite(dedupeP1) ? clamp(dedupeP1, 1, 48) : undefined,
      P2: Number.isFinite(dedupeP2) ? clamp(dedupeP2, 1, 72) : undefined,
      P3: Number.isFinite(dedupeP3) ? clamp(dedupeP3, 1, 24 * 7) : undefined,
    } as EnterpriseAiAlertPolicy['dedupeHoursByPriority'],
  }
}

export function resolveAlertPolicyFromSignals(
  signals: ScheduledSignalLike[],
  fallback: EnterpriseAiAlertPolicy,
): EnterpriseAiAlertPolicy {
  const policySignal = signals.find((signal) =>
    signal.signalClass === 'TENANT' && String(signal.signalKey || '').toLowerCase() === 'alert_policy',
  )

  if (!policySignal) return fallback

  const patch = parseEnterpriseAiAlertPolicy(policySignal.signalValue)
  const patchDedupe = patch.dedupeHoursByPriority || ({} as Partial<EnterpriseAiAlertPolicy['dedupeHoursByPriority']>)

  return {
    minPriorityToNotify: patch.minPriorityToNotify || fallback.minPriorityToNotify,
    quietHoursStartUtc: patch.quietHoursStartUtc ?? fallback.quietHoursStartUtc,
    quietHoursEndUtc: patch.quietHoursEndUtc ?? fallback.quietHoursEndUtc,
    suppressAfterAckHours: patch.suppressAfterAckHours || fallback.suppressAfterAckHours,
    dedupeHoursByPriority: {
      P1: patchDedupe.P1 || fallback.dedupeHoursByPriority.P1,
      P2: patchDedupe.P2 || fallback.dedupeHoursByPriority.P2,
      P3: patchDedupe.P3 || fallback.dedupeHoursByPriority.P3,
    },
  }
}

function isInQuietHours(now: Date, policy: EnterpriseAiAlertPolicy): boolean {
  const start = policy.quietHoursStartUtc
  const end = policy.quietHoursEndUtc
  if (start === null || end === null || start === end) return false

  const hour = now.getUTCHours()
  if (start < end) {
    return hour >= start && hour < end
  }
  return hour >= start || hour < end
}

export function resolveAlertDedupeHours(policy: EnterpriseAiAlertPolicy, priority: AdaptiveAlert['priority']): number {
  return policy.dedupeHoursByPriority[priority]
}

export function evaluateAlertSuppression(options: {
  alert: AdaptiveAlert
  policy: EnterpriseAiAlertPolicy
  latestMatchingNotification?: { createdAt: Date; isRead: boolean } | null
  now?: Date
}): { suppressed: boolean; reason?: AlertSuppressionReason } {
  const now = options.now || new Date()
  if (PRIORITY_RANK[options.alert.priority] < PRIORITY_RANK[options.policy.minPriorityToNotify]) {
    return { suppressed: true, reason: 'PRIORITY_BELOW_MIN' }
  }

  if (isInQuietHours(now, options.policy)) {
    return { suppressed: true, reason: 'QUIET_HOURS' }
  }

  const latest = options.latestMatchingNotification
  if (latest?.isRead) {
    const ackSuppressMs = options.policy.suppressAfterAckHours * 60 * 60 * 1000
    const ageMs = now.getTime() - latest.createdAt.getTime()
    if (ageMs >= 0 && ageMs < ackSuppressMs) {
      return { suppressed: true, reason: 'ACK_COOLDOWN' }
    }
  }

  return { suppressed: false }
}

function calcExternalPressure(signals: ScheduledSignalLike[]): {
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  expensePressureScore: number
  demandOpportunityScore: number
  sources: string[]
} {
  let expensePressureScore = 0
  let demandOpportunityScore = 0
  const sources = new Set<string>()

  for (const signal of signals) {
    const source = String(signal.source || '').trim()
    if (source) sources.add(source)

    const tags = toStringArray(signal.tags).join(' ').toLowerCase()
    const key = String(signal.signalKey || '').toLowerCase()
    const blob = JSON.stringify(toRecord(signal.signalValue)).toLowerCase()
    const signalText = `${key} ${tags} ${blob}`

    if (/inflation|fx|currency|fuel|import|freight|supply|shortage|cost pressure/.test(signalText)) {
      expensePressureScore += 1
    }
    if (/demand surge|seasonal demand|consumer demand|growth trend|category growth/.test(signalText)) {
      demandOpportunityScore += 1
    }
    if (/regulatory|compliance|tax increase|duty/.test(signalText)) {
      expensePressureScore += 0.7
    }
  }

  const weightedExpense = clamp(expensePressureScore / 6, 0, 1)
  const weightedDemand = clamp(demandOpportunityScore / 5, 0, 1)
  const maxScore = Math.max(weightedExpense, weightedDemand)
  const severity: 'LOW' | 'MEDIUM' | 'HIGH' = maxScore >= 0.75 ? 'HIGH' : maxScore >= 0.4 ? 'MEDIUM' : 'LOW'

  return {
    severity,
    expensePressureScore: weightedExpense,
    demandOpportunityScore: weightedDemand,
    sources: [...sources].slice(0, 6),
  }
}

function toSnapshotLike(value: unknown): SnapshotLike {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as SnapshotLike
}

export function shouldPrecomputeForSnapshot(snapshot: unknown, minTxCount: number): boolean {
  const cast = toSnapshotLike(snapshot)
  const txCount = toNumber(cast.horizon?.last30?.txCount)
  return txCount >= minTxCount
}

export function buildScheduledRecommendationPayloads(
  snapshot: unknown,
  options?: { signals?: ScheduledSignalLike[] }
): Array<{
  recommendationType: RecommendationType
  title: string
  summary: string
  confidenceScore: number
  riskScore: number
  reasonCodes: string[]
  sourceProvenance: string[]
  outputPayload: Record<string, unknown>
}> {
  const cast = toSnapshotLike(snapshot)
  const txCount = toNumber(cast.horizon?.last30?.txCount)
  const dataQuality = clamp(txCount / 300, 0.35, 0.95)
  const topBranch = [...(cast.branchMetrics || [])]
    .sort((a, b) => toNumber(b.margin) - toNumber(a.margin))
    .slice(0, 1)[0]
  const weakBranch = [...(cast.branchMetrics || [])]
    .sort((a, b) => toNumber(a.margin) - toNumber(b.margin))
    .slice(0, 1)[0]

  const revenuePct = toNumber(cast.horizonDeltas?.h30?.revenuePct)
  const netPct = toNumber(cast.horizonDeltas?.h30?.netPct)
  const expensePct = toNumber(cast.horizonDeltas?.h30?.expensePct)
  const externalPressure = calcExternalPressure(options?.signals || [])

  const branchRisk = clamp(
    (weakBranch && toNumber(weakBranch.margin) < 0 ? 0.22 : 0) +
    (netPct < 0 ? 0.16 : 0) +
    externalPressure.expensePressureScore * 0.12,
    0.12,
    0.92,
  )

  const cashflowRisk = clamp(
    (expensePct > 8 ? 0.22 : 0.08) +
    (netPct < -5 ? 0.3 : netPct < 0 ? 0.16 : 0) +
    externalPressure.expensePressureScore * 0.28,
    0.14,
    0.95,
  )

  const payloads: Array<{
    recommendationType: RecommendationType
    title: string
    summary: string
    confidenceScore: number
    riskScore: number
    reasonCodes: string[]
    sourceProvenance: string[]
    outputPayload: Record<string, unknown>
  }> = [
    {
      recommendationType: 'BRANCH_PERFORMANCE',
      title: 'Scheduled branch performance refresh',
      summary: topBranch?.branchName
        ? `${topBranch.branchName} currently leads margin performance. Prioritize coaching for branches below baseline${weakBranch?.branchName ? `, especially ${weakBranch.branchName}` : ''}.`
        : 'Branch performance was refreshed; assign owners to low-margin branches for this cycle.',
      confidenceScore: Number((0.58 + dataQuality * 0.34).toFixed(4)),
      riskScore: Number(branchRisk.toFixed(4)),
      reasonCodes: ['SCHEDULED_REFRESH', 'BRANCH_MARGIN_MONITORING', 'TENANT_ADAPTIVE_SCORING'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', 'tenant:products', ...(externalPressure.sources.length ? ['public/platform:signals'] : [])],
      outputPayload: {
        mode: 'scheduled-precompute',
        topBranch: topBranch || null,
        weakBranch: weakBranch || null,
        dataQuality,
        externalPressure,
      },
    },
    {
      recommendationType: 'CASHFLOW_FORECAST',
      title: 'Scheduled cashflow guardrail refresh',
      summary: `30-day deltas: revenue ${revenuePct.toFixed(2)}%, expense ${expensePct.toFixed(2)}%, net ${netPct.toFixed(2)}%. External pressure: ${externalPressure.severity}.`,
      confidenceScore: Number((0.54 + dataQuality * 0.36).toFixed(4)),
      riskScore: Number(cashflowRisk.toFixed(4)),
      reasonCodes: ['SCHEDULED_REFRESH', 'NET_POSITION_DRIFT', 'EXTERNAL_PRESSURE_ADJUSTMENT'],
      sourceProvenance: ['tenant:sales', 'tenant:expenses', ...(externalPressure.sources.length ? ['public/platform:signals'] : [])],
      outputPayload: {
        mode: 'scheduled-precompute',
        revenuePct,
        expensePct,
        netPct,
        dataQuality,
        externalPressure,
      },
    },
  ]

  const shouldCreateExpenseAlert =
    netPct < -4 ||
    expensePct > 14 ||
    externalPressure.expensePressureScore >= 0.7

  if (shouldCreateExpenseAlert) {
    payloads.push({
      recommendationType: 'EXPENSE_RISK_ALERT',
      title: 'Adaptive expense pressure alert',
      summary: `Expense pressure detected for this tenant: expense delta ${expensePct.toFixed(2)}%, net delta ${netPct.toFixed(2)}%, external severity ${externalPressure.severity}.`,
      confidenceScore: Number((0.5 + dataQuality * 0.35).toFixed(4)),
      riskScore: Number(clamp(cashflowRisk + 0.08, 0.25, 0.98).toFixed(4)),
      reasonCodes: ['ADAPTIVE_EXPENSE_PRESSURE', 'TENANT_SPECIFIC_BASELINE', 'PROACTIVE_ALERTING'],
      sourceProvenance: ['tenant:expenses', 'tenant:sales', ...(externalPressure.sources.length ? ['public/platform:signals'] : [])],
      outputPayload: {
        mode: 'scheduled-alert',
        expensePct,
        netPct,
        externalPressure,
        businessContext: {
          txCount,
          topBranch: topBranch?.branchName || null,
          weakBranch: weakBranch?.branchName || null,
        },
      },
    })
  }

  return payloads
}

export function deriveAdaptiveAlerts(snapshot: unknown, options?: { signals?: ScheduledSignalLike[] }): AdaptiveAlert[] {
  const cast = toSnapshotLike(snapshot)
  const revenuePct = toNumber(cast.horizonDeltas?.h30?.revenuePct)
  const netPct = toNumber(cast.horizonDeltas?.h30?.netPct)
  const expensePct = toNumber(cast.horizonDeltas?.h30?.expensePct)
  const txCount = toNumber(cast.horizon?.last30?.txCount)
  const external = calcExternalPressure(options?.signals || [])

  const ctx: AlertRuleContext = {
    txCount,
    revenuePct,
    expensePct,
    netPct,
    externalSeverity: external.severity,
  }

  const severityByPriority: Record<'P1' | 'P2' | 'P3', 'HIGH' | 'MEDIUM' | 'LOW'> = {
    P1: 'HIGH',
    P2: 'MEDIUM',
    P3: 'LOW',
  }

  const rules: AlertRule[] = [
    {
      priority: 'P1',
      alertKey: 'net_decline_critical',
      reasonCodes: ['NET_DECLINE', 'TENANT_SPECIFIC_BASELINE'],
      when: (x) => x.txCount > 40 && x.netPct < -8,
      message: (x) => `Net performance declined by ${x.netPct.toFixed(2)}% over the last 30 days. Immediate branch and cost controls are recommended.`,
    },
    {
      priority: 'P1',
      alertKey: 'expense_growth_critical',
      reasonCodes: ['EXPENSE_SURGE', 'COST_CONTROL_REQUIRED'],
      when: (x) => x.expensePct > 16,
      message: (x) => `Expense growth reached ${x.expensePct.toFixed(2)}% over the last 30 days. Validate category outliers and supplier terms.`,
    },
    {
      priority: 'P2',
      alertKey: 'external_pressure_watch',
      reasonCodes: ['EXTERNAL_SIGNAL_PRESSURE', 'MARKET_AWARENESS'],
      when: (x) => x.externalSeverity !== 'LOW' && (x.expensePct > 8 || x.revenuePct < 0),
      message: (x) => `External market pressure is ${x.externalSeverity.toLowerCase()} and may affect this tenant's margin trajectory.`,
    },
    {
      priority: 'P3',
      alertKey: 'soft_margin_watch',
      reasonCodes: ['MARGIN_SOFTENING', 'EARLY_MONITORING'],
      when: (x) => x.netPct < 0 && x.netPct >= -8 && x.txCount > 20,
      message: (x) => `Net trend is softening (${x.netPct.toFixed(2)}%). Track branch discounting and controllable costs this week.`,
    },
  ]

  return rules
    .filter((rule) => rule.when(ctx))
    .map((rule) => ({
      priority: rule.priority,
      alertKey: rule.alertKey,
      severity: severityByPriority[rule.priority],
      message: rule.message(ctx),
      reasonCodes: rule.reasonCodes,
    }))
}
