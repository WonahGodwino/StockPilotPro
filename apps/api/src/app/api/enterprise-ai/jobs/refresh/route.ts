import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError, handleOptions } from '@/lib/auth'
import { runEnterpriseAiRefreshJob } from '@/lib/enterprise-ai-jobs'

const postSchema = z.object({
  tenantLimit: z.number().int().min(1).max(100).optional(),
  staleMinutes: z.number().int().min(5).max(240).optional(),
  staleContextHours: z.number().int().min(6).max(24 * 30).optional(),
  precomputeMinTxCount: z.number().int().min(1).max(100000).optional(),
  dryRun: z.boolean().optional(),
})

function isAuthorized(req: NextRequest): boolean {
  const configuredSecret = process.env.ENTERPRISE_AI_JOB_SECRET
  if (!configuredSecret) return false
  const suppliedSecret = req.headers.get('x-enterprise-job-secret')
  return suppliedSecret === configuredSecret
}

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return apiError('Unauthorized job trigger', 401)
    }

    const body = await req.json().catch(() => ({}))
    const payload = postSchema.parse(body)

    const result = await runEnterpriseAiRefreshJob(payload)
    return NextResponse.json({ data: result })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[ENTERPRISE AI JOBS REFRESH POST]', err)
    return apiError('Internal server error', 500)
  }
}