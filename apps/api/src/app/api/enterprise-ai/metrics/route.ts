import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { EnterpriseAccessError, requireEnterpriseAiAccess } from '@/lib/enterprise-ai'
import { resolveMetricsTenantScope } from '@/lib/enterprise-ai-route-policy'

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    const access = await requireEnterpriseAiAccess(user)
    const { searchParams } = new URL(req.url)
    const requestedTenantId = searchParams.get('tenantId') || undefined

    const tenantId = resolveMetricsTenantScope(user.role, requestedTenantId, access.tenantId)

    const [recommendationCounts, metricsRows] = await Promise.all([
      prisma.enterpriseAiRecommendation.groupBy({
        by: ['status', 'recommendationType'],
        where: { tenantId },
        _count: { _all: true },
      }),
      prisma.enterpriseAiMetric.findMany({
        where: { tenantId },
        orderBy: { measuredAt: 'desc' },
        take: 100,
      }),
    ])

    const totalRecommendations = recommendationCounts.reduce((sum, row) => sum + row._count._all, 0)
    const acceptedRecommendations = recommendationCounts
      .filter((row) => row.status === 'ACCEPTED')
      .reduce((sum, row) => sum + row._count._all, 0)

    const adoptionRate = totalRecommendations > 0 ? acceptedRecommendations / totalRecommendations : 0

    const byType = recommendationCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.recommendationType] = (acc[row.recommendationType] || 0) + row._count._all
      return acc
    }, {})

    const alerts: Array<{ key: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; message: string }> = []
    if (totalRecommendations >= 20 && adoptionRate < 0.2) {
      alerts.push({
        key: 'adoption_rate_low',
        severity: 'HIGH',
        message: 'Recommendation adoption rate is below 20% for a meaningful sample size.',
      })
    }
    if (totalRecommendations === 0) {
      alerts.push({
        key: 'no_recommendations_generated',
        severity: 'MEDIUM',
        message: 'No enterprise AI recommendations have been generated yet.',
      })
    }

    return NextResponse.json({
      data: {
        tenantId,
        totals: {
          totalRecommendations,
          acceptedRecommendations,
          adoptionRate,
        },
        byType,
        alerts,
        recentMetrics: metricsRows.map((row) => ({
          id: row.id,
          metricKey: row.metricKey,
          metricValue: Number(row.metricValue),
          dimensions: row.dimensions,
          measuredAt: row.measuredAt,
        })),
      },
    })
  } catch (err) {
    if (err instanceof EnterpriseAccessError) {
      return NextResponse.json({ error: err.message, metadata: err.metadata }, { status: err.status })
    }
    console.error('[ENTERPRISE AI METRICS GET]', err)
    return apiError('Internal server error', 500)
  }
}
