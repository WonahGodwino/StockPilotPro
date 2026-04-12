import { prisma } from '@/lib/prisma'
import { buildEnterpriseFeatureSnapshot } from '@/lib/enterprise-ai'
import { hasEnterpriseAiFeature } from '@/lib/enterprise-ai-policy'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { sendEmail } from '@/lib/mailer'
import { Prisma } from '@prisma/client'
import {
  buildScheduledRecommendationPayloads,
  deriveAdaptiveAlerts,
  evaluateAlertSuppression,
  getDefaultEnterpriseAiAlertPolicy,
  resolveAlertDedupeHours,
  resolveAlertPolicyFromSignals,
  shouldPrecomputeForSnapshot,
} from '@/lib/enterprise-ai-jobs-logic'

export type EnterpriseAiRefreshJobOptions = {
  tenantLimit?: number
  staleMinutes?: number
  staleContextHours?: number
  precomputeMinTxCount?: number
  dryRun?: boolean
}

export type EnterpriseAiRefreshTenantResult = {
  tenantId: string
  snapshotRefreshed: boolean
  precomputedRecommendations: number
  staleContextsInvalidated: number
  adaptiveAlertsEmitted: number
  externalSignalsUsed: number
  durationMs: number
  error?: string
}

export type EnterpriseAiRefreshJobResult = {
  startedAt: string
  finishedAt: string
  durationMs: number
  dryRun: boolean
  processedTenants: number
  refreshedSnapshots: number
  precomputedRecommendations: number
  staleContextsInvalidated: number
  adaptiveAlertsEmitted: number
  failedTenants: number
  tenantResults: EnterpriseAiRefreshTenantResult[]
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function runEnterpriseAiRefreshJob(options: EnterpriseAiRefreshJobOptions = {}): Promise<EnterpriseAiRefreshJobResult> {
  const startedAt = Date.now()
  const tenantLimit = Math.min(100, Math.max(1, options.tenantLimit || Number(process.env.ENTERPRISE_AI_JOB_TENANT_LIMIT || 20)))
  const staleMinutes = Math.min(240, Math.max(5, options.staleMinutes || Number(process.env.ENTERPRISE_AI_JOB_STALE_MINUTES || 45)))
  const staleContextHours = Math.min(24 * 30, Math.max(6, options.staleContextHours || Number(process.env.ENTERPRISE_AI_STALE_CONTEXT_HOURS || 48)))
  const precomputeMinTxCount = Math.max(1, options.precomputeMinTxCount || Number(process.env.ENTERPRISE_AI_PRECOMPUTE_MIN_TX_COUNT || 120))
  const dryRun = options.dryRun === true

  const now = new Date()
  const staleContextBefore = new Date(now.getTime() - staleContextHours * 60 * 60 * 1000)
  const recentRecommendationWindow = new Date(now.getTime() - 12 * 60 * 60 * 1000)
  const defaultAlertPolicy = getDefaultEnterpriseAiAlertPolicy()

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      expiryDate: { gt: now },
      tenant: { isActive: true, archived: false },
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      plan: { select: { features: true } },
      tenant: { select: { id: true } },
    },
    take: tenantLimit * 3,
  })

  const tenantIds = [...new Set(
    subscriptions
      .filter((row) => {
        const features = row.plan?.features
        return hasEnterpriseAiFeature(features, 'ENTERPRISE_AI_ENABLED') || hasEnterpriseAiFeature(features, 'ENTERPRISE_PACKAGE')
      })
      .map((row) => row.tenant.id)
      .filter(Boolean),
  )].slice(0, tenantLimit)

  const tenantResults: EnterpriseAiRefreshTenantResult[] = []
  let refreshedSnapshots = 0
  let precomputedRecommendations = 0
  let staleContextsInvalidated = 0
  let adaptiveAlertsEmitted = 0
  let failedTenants = 0

  for (const tenantId of tenantIds) {
    const tenantStart = Date.now()
    try {
      const latest = await prisma.enterpriseAiFeatureSnapshot.findFirst({
        where: { tenantId },
        orderBy: { generatedAt: 'desc' },
      })

      const recentSignals = await prisma.enterpriseAiSignal.findMany({
        where: {
          OR: [
            { signalClass: 'PUBLIC' },
            { signalClass: 'PLATFORM' },
            { signalClass: 'TENANT', tenantId },
          ],
          effectiveDate: { gte: new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { effectiveDate: 'desc' },
        take: 60,
        select: {
          signalClass: true,
          source: true,
          signalKey: true,
          signalValue: true,
          tags: true,
        },
      })

      let snapshotValue: unknown = latest?.featureSnapshot
      let snapshotRefreshed = false

      const staleMs = staleMinutes * 60 * 1000
      const stale = !latest || (Date.now() - latest.generatedAt.getTime() > staleMs)

      if (!dryRun && stale) {
        const refreshed = await buildEnterpriseFeatureSnapshot(tenantId)
        snapshotValue = refreshed.featureSnapshot
        snapshotRefreshed = true
        refreshedSnapshots += 1
      }

      let createdCount = 0
      if (!dryRun && snapshotValue && shouldPrecomputeForSnapshot(snapshotValue, precomputeMinTxCount)) {
        const payloads = buildScheduledRecommendationPayloads(snapshotValue, { signals: recentSignals })
        for (const payload of payloads) {
          const exists = await prisma.enterpriseAiRecommendation.findFirst({
            where: {
              tenantId,
              recommendationType: payload.recommendationType,
              createdAt: { gte: recentRecommendationWindow },
            },
            select: { id: true },
          })
          if (exists) continue

          await prisma.enterpriseAiRecommendation.create({
            data: {
              tenantId,
              recommendationType: payload.recommendationType,
              title: payload.title,
              summary: payload.summary,
              confidenceScore: payload.confidenceScore,
              riskScore: payload.riskScore,
              reasonCodes: payload.reasonCodes,
              sourceProvenance: payload.sourceProvenance,
              modelVersion: 'enterprise-scheduler-v1',
              inputSnapshot: {
                source: 'enterprise-refresh-job',
                generatedAt: now.toISOString(),
              },
              outputPayload: toJsonValue(payload.outputPayload),
            },
          })
          createdCount += 1
        }
      }
      precomputedRecommendations += createdCount

      let alertCount = 0
      const alertPolicy = resolveAlertPolicyFromSignals(recentSignals, defaultAlertPolicy)
      const priorityCounts: Record<'P1' | 'P2' | 'P3', number> = { P1: 0, P2: 0, P3: 0 }
      const suppressedCounts: Record<'PRIORITY_BELOW_MIN' | 'QUIET_HOURS' | 'ACK_COOLDOWN' | 'DEDUPE', number> = {
        PRIORITY_BELOW_MIN: 0,
        QUIET_HOURS: 0,
        ACK_COOLDOWN: 0,
        DEDUPE: 0,
      }
      const emittedAlerts: Array<{ priority: 'P1' | 'P2' | 'P3'; severity: 'LOW' | 'MEDIUM' | 'HIGH'; message: string }> = []
      if (!dryRun && snapshotValue) {
        const adaptiveAlerts = deriveAdaptiveAlerts(snapshotValue, { signals: recentSignals })
        for (const alert of adaptiveAlerts) {
          const latestMatching = await prisma.notification.findFirst({
            where: {
              tenantId,
              type: 'SYSTEM',
              title: `AI Alert ${alert.priority}: ${alert.alertKey}`,
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, isRead: true },
          })

          const suppression = evaluateAlertSuppression({
            alert,
            policy: alertPolicy,
            latestMatchingNotification: latestMatching,
            now,
          })
          if (suppression.suppressed) {
            suppressedCounts[suppression.reason || 'PRIORITY_BELOW_MIN'] += 1
            continue
          }

          const dedupeHours = resolveAlertDedupeHours(alertPolicy, alert.priority)
          const dedupeStart = new Date(now.getTime() - dedupeHours * 60 * 60 * 1000)
          if (latestMatching && latestMatching.createdAt >= dedupeStart) {
            suppressedCounts.DEDUPE += 1
            continue
          }

          await prisma.notification.create({
            data: {
              tenantId,
              type: 'SYSTEM',
              title: `AI Alert ${alert.priority}: ${alert.alertKey}`,
              message: `[${alert.priority}/${alert.severity}] ${alert.message}`,
            },
          })
          alertCount += 1
          priorityCounts[alert.priority] += 1
          emittedAlerts.push({
            priority: alert.priority,
            severity: alert.severity,
            message: alert.message,
          })
        }

        if (alertCount > 0) {
          const admins = await prisma.user.findMany({
            where: {
              tenantId,
              role: 'BUSINESS_ADMIN',
              archived: false,
              isActive: true,
            },
            select: { email: true },
          })
          const adminEmails = admins.map((x) => x.email).filter(Boolean)

          if (adminEmails.length > 0) {
            const text = [
              'StockPilot Enterprise AI detected risk signals requiring attention.',
              '',
              ...emittedAlerts.slice(0, 3).map((a) => `- [${a.priority}/${a.severity}] ${a.message}`),
              '',
              'Review Enterprise AI recommendations and action trackers in your dashboard.',
            ].join('\n')

            await sendEmail({
              to: adminEmails,
              subject: 'StockPilot AI Alert: Business Risk Signals Detected',
              text,
            })
          }
        }
      }
      adaptiveAlertsEmitted += alertCount

      let invalidatedCount = 0
      if (!dryRun) {
        const staleUpdate = await prisma.enterpriseAiRecommendation.updateMany({
          where: {
            tenantId,
            recommendationType: 'NL_ASSISTANT',
            status: 'OPEN',
            createdAt: { lt: staleContextBefore },
          },
          data: {
            status: 'NOT_RELEVANT',
            actedAt: now,
            feedbackNote: 'Auto-invalidated by scheduled refresh job due to stale context.',
          },
        })
        invalidatedCount = staleUpdate.count
      }
      staleContextsInvalidated += invalidatedCount

      const durationMs = Date.now() - tenantStart

      if (!dryRun) {
        await prisma.enterpriseAiMetric.createMany({
          data: [
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_job_run',
              metricValue: 1,
              dimensions: { staleMinutes, staleContextHours },
            },
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_job_duration_ms',
              metricValue: durationMs,
              dimensions: { staleMinutes, staleContextHours },
            },
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_precomputed_count',
              metricValue: createdCount,
              dimensions: { precomputeMinTxCount },
            },
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_stale_invalidated_count',
              metricValue: invalidatedCount,
              dimensions: { staleContextHours },
            },
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_alerts_emitted_count',
              metricValue: alertCount,
              dimensions: {
                staleMinutes,
                p1: priorityCounts.P1,
                p2: priorityCounts.P2,
                p3: priorityCounts.P3,
              },
            },
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_alerts_suppressed_count',
              metricValue: suppressedCounts.PRIORITY_BELOW_MIN + suppressedCounts.QUIET_HOURS + suppressedCounts.ACK_COOLDOWN + suppressedCounts.DEDUPE,
              dimensions: {
                minPriority: alertPolicy.minPriorityToNotify,
                quietHours: `${alertPolicy.quietHoursStartUtc ?? 'none'}-${alertPolicy.quietHoursEndUtc ?? 'none'}`,
                belowMinPriority: suppressedCounts.PRIORITY_BELOW_MIN,
                quietHoursSuppressed: suppressedCounts.QUIET_HOURS,
                ackCooldownSuppressed: suppressedCounts.ACK_COOLDOWN,
                dedupeSuppressed: suppressedCounts.DEDUPE,
              },
            },
            {
              tenantId,
              metricKey: 'enterprise_ai_refresh_external_signals_used',
              metricValue: recentSignals.length,
              dimensions: { lookbackDays: 21 },
            },
          ],
        })

        await logAudit({
          tenantId,
          action: 'ENTERPRISE_AI_REFRESH_JOB_RUN',
          entity: 'EnterpriseAiScheduler',
          newValues: {
            snapshotRefreshed,
            precomputedRecommendations: createdCount,
            staleContextsInvalidated: invalidatedCount,
            adaptiveAlertsEmitted: alertCount,
            alertsSuppressed: suppressedCounts,
            alertPolicy,
            externalSignalsUsed: recentSignals.length,
            durationMs,
            staleMinutes,
            staleContextHours,
            precomputeMinTxCount,
          },
        })
      }

      tenantResults.push({
        tenantId,
        snapshotRefreshed,
        precomputedRecommendations: createdCount,
        staleContextsInvalidated: invalidatedCount,
        adaptiveAlertsEmitted: alertCount,
        externalSignalsUsed: recentSignals.length,
        durationMs,
      })
    } catch (err) {
      failedTenants += 1
      const durationMs = Date.now() - tenantStart
      const error = err instanceof Error ? err.message : 'Unknown tenant refresh failure'

      logger.error('enterprise-ai refresh job tenant failed', {
        tenantId,
        durationMs,
        err,
      })

      tenantResults.push({
        tenantId,
        snapshotRefreshed: false,
        precomputedRecommendations: 0,
        staleContextsInvalidated: 0,
        adaptiveAlertsEmitted: 0,
        externalSignalsUsed: 0,
        durationMs,
        error,
      })
    }
  }

  const durationMs = Date.now() - startedAt
  const finishedAt = new Date().toISOString()

  if (!dryRun) {
    await prisma.enterpriseAiMetric.create({
      data: {
        tenantId: null,
        metricKey: 'enterprise_ai_refresh_job_batch_duration_ms',
        metricValue: durationMs,
        dimensions: {
          processedTenants: tenantIds.length,
          refreshedSnapshots,
          precomputedRecommendations,
          staleContextsInvalidated,
          adaptiveAlertsEmitted,
          failedTenants,
          staleMinutes,
          staleContextHours,
          precomputeMinTxCount,
        },
      },
    })
  }

  return {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt,
    durationMs,
    dryRun,
    processedTenants: tenantIds.length,
    refreshedSnapshots,
    precomputedRecommendations,
    staleContextsInvalidated,
    adaptiveAlertsEmitted,
    failedTenants,
    tenantResults,
  }
}