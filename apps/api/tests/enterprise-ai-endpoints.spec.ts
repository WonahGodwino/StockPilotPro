import { strict as assert } from 'assert'
import {
  isAlertPolicyAllowedForRole,
  isActionTrackerAllowedForRole,
  isSimulationTypeAllowedForRole,
  isRecommendationTypeAllowedForRole,
  resolveMetricsTenantScope,
  resolveSignalTenantScope,
} from '../src/lib/enterprise-ai-route-policy'
import {
  buildScheduledRecommendationPayloads,
  deriveAdaptiveAlerts,
  evaluateAlertSuppression,
  getDefaultEnterpriseAiAlertPolicy,
  parseEnterpriseAiAlertPolicy,
  resolveAlertDedupeHours,
  resolveAlertPolicyFromSignals,
  shouldPrecomputeForSnapshot,
} from '../src/lib/enterprise-ai-jobs-logic'
import { attachActionTracker, createActionTracker, extractActionTracker, updateActionTrackerState } from '../src/lib/enterprise-ai-action-tracker'

function mustThrow(fn: () => void, contains: string) {
  let threw = false
  try {
    fn()
  } catch (err) {
    threw = true
    assert.ok((err as Error).message.includes(contains))
  }
  assert.ok(threw, `Expected throw containing: ${contains}`)
}

// Endpoint policy: recommendation visibility/generation by role
assert.equal(isRecommendationTypeAllowedForRole('SUPER_ADMIN', 'ANOMALY_DETECTION'), true)
assert.equal(isRecommendationTypeAllowedForRole('BUSINESS_ADMIN', 'ANOMALY_DETECTION'), false)
assert.equal(isRecommendationTypeAllowedForRole('BUSINESS_ADMIN', 'DEMAND_FORECAST'), true)
assert.equal(isRecommendationTypeAllowedForRole('SALESPERSON', 'DEMAND_FORECAST'), false)

// Endpoint policy: simulation execution by role
assert.equal(isSimulationTypeAllowedForRole('SUPER_ADMIN', 'PRICE_ADJUSTMENT'), true)
assert.equal(isSimulationTypeAllowedForRole('BUSINESS_ADMIN', 'STOCK_TRANSFER'), true)
assert.equal(isSimulationTypeAllowedForRole('SALESPERSON', 'EXPENSE_CAP'), false)

// Endpoint policy: action tracker role scope
assert.equal(isActionTrackerAllowedForRole('SUPER_ADMIN'), true)
assert.equal(isActionTrackerAllowedForRole('BUSINESS_ADMIN'), true)
assert.equal(isActionTrackerAllowedForRole('SALESPERSON'), false)

// Endpoint policy: alert policy role scope
assert.equal(isAlertPolicyAllowedForRole('SUPER_ADMIN'), true)
assert.equal(isAlertPolicyAllowedForRole('BUSINESS_ADMIN'), true)
assert.equal(isAlertPolicyAllowedForRole('SALESPERSON'), false)

// Endpoint policy: metrics tenant scoping
assert.equal(resolveMetricsTenantScope('SUPER_ADMIN', 'tenant-b', 'tenant-a'), 'tenant-b')
assert.equal(resolveMetricsTenantScope('SUPER_ADMIN', undefined, 'tenant-a'), 'tenant-a')
assert.equal(resolveMetricsTenantScope('BUSINESS_ADMIN', 'tenant-b', 'tenant-a'), 'tenant-a')

// Endpoint policy: signal ingestion tenant isolation
assert.equal(
  resolveSignalTenantScope({
    role: 'SUPER_ADMIN',
    signalClass: 'PUBLIC',
    accessTenantId: 'tenant-a',
  }),
  null,
)

mustThrow(
  () => resolveSignalTenantScope({
    role: 'BUSINESS_ADMIN',
    signalClass: 'PLATFORM',
    accessTenantId: 'tenant-a',
  }),
  'Only SUPER_ADMIN can ingest public/platform signals',
)

assert.equal(
  resolveSignalTenantScope({
    role: 'BUSINESS_ADMIN',
    signalClass: 'TENANT',
    payloadTenantId: 'tenant-a',
    accessTenantId: 'tenant-a',
  }),
  'tenant-a',
)

mustThrow(
  () => resolveSignalTenantScope({
    role: 'BUSINESS_ADMIN',
    signalClass: 'TENANT',
    payloadTenantId: 'tenant-b',
    accessTenantId: 'tenant-a',
  }),
  'tenant mismatch',
)

// Scheduler precompute guardrail logic
assert.equal(shouldPrecomputeForSnapshot({ horizon: { last30: { txCount: 180 } } }, 120), true)
assert.equal(shouldPrecomputeForSnapshot({ horizon: { last30: { txCount: 35 } } }, 120), false)

const scheduledPayloads = buildScheduledRecommendationPayloads({
  horizonDeltas: { h30: { revenuePct: 8.5, expensePct: 2.1, netPct: 12.8 } },
  branchMetrics: [{ branchName: 'Central', margin: 2000, revenue: 5000, expense: 3000, score: 88 }],
})
assert.equal(scheduledPayloads.length, 2)
assert.equal(scheduledPayloads[0].recommendationType, 'BRANCH_PERFORMANCE')
assert.equal(scheduledPayloads[1].recommendationType, 'CASHFLOW_FORECAST')

const scheduledWithPressure = buildScheduledRecommendationPayloads(
  {
    horizon: { last30: { txCount: 280 } },
    horizonDeltas: { h30: { revenuePct: -4.2, expensePct: 18.4, netPct: -22.1 } },
    branchMetrics: [
      { branchName: 'North', margin: -500, revenue: 1500, expense: 2000, score: 42 },
      { branchName: 'Central', margin: 900, revenue: 2600, expense: 1700, score: 79 },
    ],
  },
  {
    signals: [
      {
        signalClass: 'PUBLIC',
        source: 'market-watch',
        signalKey: 'inflation-index',
        signalValue: { trend: 'up' },
        tags: ['inflation', 'supply-chain'],
      },
    ],
  },
)
assert.equal(scheduledWithPressure.some((p) => p.recommendationType === 'EXPENSE_RISK_ALERT'), true)

const adaptiveAlerts = deriveAdaptiveAlerts(
  {
    horizon: { last30: { txCount: 120 } },
    horizonDeltas: { h30: { revenuePct: -6.5, expensePct: 21.3, netPct: -15.6 } },
  },
  {
    signals: [
      {
        signalClass: 'PLATFORM',
        source: 'macro-feed',
        signalKey: 'fuel-cost-pressure',
        signalValue: { level: 'high' },
        tags: ['fuel', 'cost pressure'],
      },
    ],
  },
)
assert.equal(adaptiveAlerts.length >= 2, true)
assert.equal(adaptiveAlerts.some((a) => a.alertKey === 'expense_growth_critical'), true)
assert.equal(adaptiveAlerts.some((a) => a.priority === 'P1'), true)

const softAlerts = deriveAdaptiveAlerts({
  horizon: { last30: { txCount: 42 } },
  horizonDeltas: { h30: { revenuePct: 1.4, expensePct: 2.2, netPct: -3.1 } },
})
assert.equal(softAlerts.some((a) => a.alertKey === 'soft_margin_watch'), true)
assert.equal(softAlerts.some((a) => a.priority === 'P3' && a.severity === 'LOW'), true)

const parsedAlertPolicy = parseEnterpriseAiAlertPolicy({
  minPriorityToNotify: 'P2',
  quietHoursStartUtc: 22,
  quietHoursEndUtc: 6,
  suppressAfterAckHours: 12,
  dedupeHoursByPriority: { P1: 1, P2: 4, P3: 10 },
})
assert.equal(parsedAlertPolicy.minPriorityToNotify, 'P2')
assert.equal(parsedAlertPolicy.quietHoursStartUtc, 22)
assert.equal(parsedAlertPolicy.quietHoursEndUtc, 6)

const baseAlertPolicy = getDefaultEnterpriseAiAlertPolicy()
const resolvedAlertPolicy = resolveAlertPolicyFromSignals(
  [{ signalClass: 'TENANT', signalKey: 'alert_policy', signalValue: parsedAlertPolicy }],
  baseAlertPolicy,
)
assert.equal(resolvedAlertPolicy.minPriorityToNotify, 'P2')
assert.equal(resolveAlertDedupeHours(resolvedAlertPolicy, 'P2'), 4)

const belowPrioritySuppressed = evaluateAlertSuppression({
  alert: {
    priority: 'P3',
    alertKey: 'soft_margin_watch',
    severity: 'LOW',
    message: 'soft',
    reasonCodes: ['EARLY_MONITORING'],
  },
  policy: resolvedAlertPolicy,
  now: new Date('2026-04-08T12:00:00.000Z'),
})
assert.equal(belowPrioritySuppressed.suppressed, true)
assert.equal(belowPrioritySuppressed.reason, 'PRIORITY_BELOW_MIN')

const quietPolicy = {
  ...resolvedAlertPolicy,
  minPriorityToNotify: 'P3' as const,
  quietHoursStartUtc: 22,
  quietHoursEndUtc: 6,
}
const quietSuppressed = evaluateAlertSuppression({
  alert: {
    priority: 'P2',
    alertKey: 'external_pressure_watch',
    severity: 'MEDIUM',
    message: 'watch',
    reasonCodes: ['MARKET_AWARENESS'],
  },
  policy: quietPolicy,
  now: new Date('2026-04-08T23:00:00.000Z'),
})
assert.equal(quietSuppressed.suppressed, true)
assert.equal(quietSuppressed.reason, 'QUIET_HOURS')

const ackSuppressed = evaluateAlertSuppression({
  alert: {
    priority: 'P1',
    alertKey: 'expense_growth_critical',
    severity: 'HIGH',
    message: 'critical',
    reasonCodes: ['EXPENSE_SURGE'],
  },
  policy: {
    ...resolvedAlertPolicy,
    minPriorityToNotify: 'P3',
    quietHoursStartUtc: null,
    quietHoursEndUtc: null,
    suppressAfterAckHours: 24,
  },
  latestMatchingNotification: {
    createdAt: new Date('2026-04-08T05:00:00.000Z'),
    isRead: true,
  },
  now: new Date('2026-04-08T08:00:00.000Z'),
})
assert.equal(ackSuppressed.suppressed, true)
assert.equal(ackSuppressed.reason, 'ACK_COOLDOWN')

// Action tracker helper lifecycle behavior
const seededTracker = createActionTracker({
  ownerUserId: 'user-a',
  dueDate: '2026-05-01T00:00:00.000Z',
  expectedImpactScore: 35,
  impactNotes: 'Initial impact hypothesis',
  actorUserId: 'user-admin',
  nowIso: '2026-04-07T10:00:00.000Z',
})
const payloadWithTracker = attachActionTracker({}, seededTracker)
const parsedTracker = extractActionTracker(payloadWithTracker)
assert.ok(parsedTracker)
assert.equal(parsedTracker?.status, 'TODO')
assert.equal(parsedTracker?.ownerUserId, 'user-a')

const progressed = updateActionTrackerState({
  current: seededTracker,
  actorUserId: 'user-admin',
  nowIso: '2026-04-07T11:00:00.000Z',
  status: 'IN_PROGRESS',
  progressNote: 'Owner started execution',
  realizedImpactScore: 12,
})
assert.equal(progressed.status, 'IN_PROGRESS')
assert.equal(progressed.realizedImpactScore, 12)
assert.equal(progressed.history.length, seededTracker.history.length + 1)

console.log('enterprise-ai-endpoints.spec: all assertions passed')
