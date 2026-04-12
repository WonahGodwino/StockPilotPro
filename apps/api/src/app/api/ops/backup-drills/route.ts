import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

type BackupRestoreDrillRunDelegate = {
  findMany(args: unknown): Promise<Array<{
    id: string
    status: string
    triggerType: string
    dbConnectivityOk: boolean
    backupVerificationOk: boolean
    restoreDrillOk: boolean
    backupArtifactPath: string | null
    backupArtifactMtime: Date | null
    backupArtifactAgeHours: number | null
    errorMessage: string | null
    checkPayload: unknown
    initiatedByUserId: string | null
    initiatedByTenantId: string | null
    startedAt: Date
    completedAt: Date | null
    createdAt: Date
  }>>
}

const backupRestoreDrillRun = (prisma as unknown as { backupRestoreDrillRun: BackupRestoreDrillRunDelegate }).backupRestoreDrillRun

export async function OPTIONS() {
  return handleOptions()
}

export async function GET(req: NextRequest) {
  try {
    const user = authenticate(req)
    if (!isSuperAdmin(user)) {
      return apiError('Forbidden: Only SUPER_ADMIN can access backup drill operations', 403)
    }

    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || 20)
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 20

    const rows = await backupRestoreDrillRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    })

    const now = Date.now()
    const thirtyDaysAgo = new Date(now - (30 * 24 * 60 * 60 * 1000))
    const recent30Days = rows.filter((row) => row.startedAt >= thirtyDaysAgo)
    const success30Days = recent30Days.filter((row) => row.status === 'SUCCESS').length
    const successRate30Days = recent30Days.length > 0
      ? Number(((success30Days / recent30Days.length) * 100).toFixed(1))
      : 0

    const lastRun = rows[0] || null
    const lastSuccessfulRun = rows.find((row) => row.status === 'SUCCESS') || null

    const recommendedCadenceHours = Number(process.env.BACKUP_DRILL_RECOMMENDED_CADENCE_HOURS || 168)
    const nextRecommendedRunAt = lastRun
      ? new Date(lastRun.startedAt.getTime() + (recommendedCadenceHours * 60 * 60 * 1000))
      : new Date(now)

    const isOverdue = nextRecommendedRunAt.getTime() < now

    return NextResponse.json({
      data: {
        summary: {
          totalRuns: rows.length,
          successRate30Days,
          lastRun,
          lastSuccessfulRun,
          nextRecommendedRunAt,
          recommendedCadenceHours,
          isOverdue,
        },
        rows,
      },
    })
  } catch (err) {
    console.error('[OPS BACKUP DRILLS GET]', err)
    return apiError('Internal server error', 500)
  }
}
