/**
 * GET /api/health
 *
 * Uptime / liveness endpoint used by load-balancers, uptime-monitoring services
 * (e.g. UptimeRobot, Checkly, AWS Route-53 health checks), and alerting pipelines.
 *
 * Response shape:
 * {
 *   "status": "ok" | "degraded" | "error",
 *   "timestamp": "<ISO-8601>",
 *   "uptime": <process uptime in seconds>,
 *   "version": "<npm package version>",
 *   "checks": {
 *     "database": { "status": "ok" | "error", "latencyMs": <number> },
 *     "redis":    { "status": "ok" | "unavailable" | "error", "latencyMs": <number> }
 *   }
 * }
 *
 * HTTP status codes:
 *   200 – all checks pass (status "ok") or non-critical component degraded (status "degraded")
 *   503 – database unreachable (status "error")
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withRedis } from '@/lib/redis'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/tracing'
import { NextRequest } from 'next/server'

type CheckResult = {
  status: 'ok' | 'error' | 'unavailable'
  latencyMs: number
}

async function checkDatabase(): Promise<CheckResult> {
  const start = Date.now()
  try {
    await prisma.$queryRaw`SELECT 1`
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch {
    return { status: 'error', latencyMs: Date.now() - start }
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now()
  try {
    const pong = await withRedis((redis) => redis.ping())
    if (pong === null) {
      // Redis is not configured — treat as unavailable, not an error
      return { status: 'unavailable', latencyMs: Date.now() - start }
    }
    return { status: 'ok', latencyMs: Date.now() - start }
  } catch {
    return { status: 'error', latencyMs: Date.now() - start }
  }
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)

  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()])

  const dbOk = db.status === 'ok'
  const redisOk = redis.status === 'ok' || redis.status === 'unavailable'

  const overallStatus = !dbOk ? 'error' : !redisOk ? 'degraded' : 'ok'
  const httpStatus = overallStatus === 'error' ? 503 : 200

  const body = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    version: process.env.npm_package_version ?? 'unknown',
    checks: {
      database: db,
      redis,
    },
  }

  logger.info('health check', {
    requestId,
    action: 'HEALTH_CHECK',
    overallStatus,
    dbStatus: db.status,
    dbLatencyMs: db.latencyMs,
    redisStatus: redis.status,
    redisLatencyMs: redis.latencyMs,
  })

  const response = NextResponse.json(body, { status: httpStatus })
  response.headers.set('x-request-id', requestId)
  // Prevent health-check responses from being cached
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  return response
}
