import { NextRequest, NextResponse } from 'next/server'
import { stat } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { authenticate, apiError, handleOptions } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/rbac'

type BackupRestoreDrillRunDelegate = {
  create(args: unknown): Promise<{
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
  }>
}

const backupRestoreDrillRun = (prisma as unknown as { backupRestoreDrillRun: BackupRestoreDrillRunDelegate }).backupRestoreDrillRun

export async function OPTIONS() {
  return handleOptions()
}

function toHours(deltaMs: number): number {
  return Number((deltaMs / (1000 * 60 * 60)).toFixed(2))
}

export async function POST(_req: NextRequest) {
  const startedAt = new Date()

  try {
    const user = authenticate(_req)
    if (!isSuperAdmin(user)) {
      return apiError('Forbidden: Only SUPER_ADMIN can run backup drills', 403)
    }

    let dbConnectivityOk = false
    let backupVerificationOk = false
    let restoreDrillOk = false
    let backupArtifactMtime: Date | null = null
    let backupArtifactAgeHours: number | null = null
    let errorMessage: string | null = null

    const backupArtifactPath = process.env.BACKUP_ARTIFACT_PATH || null
    const maxBackupAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS || 48)

    // 1) DB connectivity probe
    await prisma.$queryRaw`SELECT 1`
    dbConnectivityOk = true

    // 2) Backup artifact verification (path-based)
    if (backupArtifactPath) {
      try {
        const meta = await stat(backupArtifactPath)
        backupArtifactMtime = meta.mtime
        backupArtifactAgeHours = toHours(Date.now() - meta.mtime.getTime())
        backupVerificationOk = backupArtifactAgeHours <= maxBackupAgeHours
      } catch (backupErr) {
        backupVerificationOk = false
        errorMessage = `Backup artifact check failed: ${(backupErr as Error).message}`
      }
    } else {
      backupVerificationOk = false
      errorMessage = 'BACKUP_ARTIFACT_PATH is not configured'
    }

    // 3) Restore drill simulation: create/read temp table in a transaction
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('CREATE TEMP TABLE IF NOT EXISTS "__backup_restore_drill_tmp" (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)')
        await tx.$executeRawUnsafe('TRUNCATE "__backup_restore_drill_tmp"')
        await tx.$executeRawUnsafe("INSERT INTO \"__backup_restore_drill_tmp\" (id, payload) VALUES (1, 'restore-probe')")
        const result = await tx.$queryRawUnsafe<Array<{ count: number }>>('SELECT COUNT(*)::int AS count FROM "__backup_restore_drill_tmp"')
        const count = Number(result?.[0]?.count || 0)
        if (count !== 1) {
          throw new Error('Restore drill probe returned unexpected row count')
        }
      })
      restoreDrillOk = true
    } catch (restoreErr) {
      restoreDrillOk = false
      errorMessage = errorMessage
        ? `${errorMessage}; Restore drill failed: ${(restoreErr as Error).message}`
        : `Restore drill failed: ${(restoreErr as Error).message}`
    }

    const status = dbConnectivityOk && backupVerificationOk && restoreDrillOk ? 'SUCCESS' : 'FAILED'
    const completedAt = new Date()

    const row = await backupRestoreDrillRun.create({
      data: {
        status,
        triggerType: 'MANUAL',
        dbConnectivityOk,
        backupVerificationOk,
        restoreDrillOk,
        backupArtifactPath,
        backupArtifactMtime,
        backupArtifactAgeHours,
        errorMessage,
        checkPayload: {
          checks: {
            dbConnectivityOk,
            backupVerificationOk,
            restoreDrillOk,
          },
          backup: {
            backupArtifactPath,
            maxBackupAgeHours,
            backupArtifactAgeHours,
            backupArtifactMtime,
          },
        },
        initiatedByUserId: user.userId,
        initiatedByTenantId: user.tenantId || null,
        startedAt,
        completedAt,
      },
    })

    return NextResponse.json({ data: row }, { status: 201 })
  } catch (err) {
    console.error('[OPS BACKUP DRILLS RUN POST]', err)

    return apiError('Internal server error', 500)
  }
}
