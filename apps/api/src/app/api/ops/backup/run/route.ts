import { NextRequest, NextResponse } from 'next/server'
import { apiError, handleOptions } from '@/lib/auth'
import { runDatabaseBackup } from '@/lib/backup-jobs'
import { prisma } from '@/lib/prisma'

type BackupRestoreDrillRunDelegate = {
  create(args: unknown): Promise<unknown>
}

const backupRestoreDrillRun = (prisma as unknown as { backupRestoreDrillRun: BackupRestoreDrillRunDelegate }).backupRestoreDrillRun

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.BACKUP_JOB_SECRET
  if (!secret) return false
  return req.headers.get('x-backup-job-secret') === secret
}

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return apiError('Unauthorized', 401)
    }

    const result = await runDatabaseBackup()

    await backupRestoreDrillRun.create({
      data: {
        status: result.success ? 'SUCCESS' : 'FAILED',
        triggerType: 'AUTOMATED',
        dbConnectivityOk: result.backupSuccess,
        backupVerificationOk: result.backupSuccess,
        restoreDrillOk: result.restore.configured ? result.restore.success : true,
        backupArtifactPath: result.filePath || null,
        backupArtifactMtime: result.artifactMtime ? new Date(result.artifactMtime) : null,
        backupArtifactAgeHours: result.artifactAgeHours,
        errorMessage: result.error || result.restore.error || null,
        checkPayload: {
          backup: {
            success: result.backupSuccess,
            sizeBytes: result.sizeBytes,
            durationMs: result.durationMs,
          },
          restore: result.restore,
        },
        initiatedByUserId: null,
        initiatedByTenantId: null,
        startedAt: result.startedAt ? new Date(result.startedAt) : new Date(),
        completedAt: result.completedAt ? new Date(result.completedAt) : new Date(),
      },
    })

    console.log('[OPS BACKUP RUN]', result)
    return NextResponse.json({ data: result }, { status: result.success ? 200 : 500 })
  } catch (err) {
    console.error('[OPS BACKUP RUN POST]', err)
    return apiError('Internal server error', 500)
  }
}
