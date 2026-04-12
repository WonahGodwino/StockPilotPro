import { NextRequest, NextResponse } from 'next/server'
import { apiError, handleOptions } from '@/lib/auth'
import { runDatabaseBackup } from '@/lib/backup-jobs'

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
    console.log('[OPS BACKUP RUN]', result)
    return NextResponse.json({ data: result }, { status: result.success ? 200 : 500 })
  } catch (err) {
    console.error('[OPS BACKUP RUN POST]', err)
    return apiError('Internal server error', 500)
  }
}
