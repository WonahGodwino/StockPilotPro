import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { revokeRefreshToken } from '@/lib/jwt'
import { authenticate, getClientIp, handleOptions } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'

const schema = z.object({ refreshToken: z.string() })

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    const rate = await consumeRateLimitDistributed(`auth:logout:${clientIp}`, 60, 15 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many logout requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      )
    }

    const user = authenticate(req) // ensure user is authenticated
    const body = await req.json()
    const { refreshToken } = schema.parse(body)
    await revokeRefreshToken(refreshToken)

    await logAudit({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'LOGOUT',
      entity: 'auth',
      entityId: user.userId,
      req,
    })

    return NextResponse.json({ message: 'Logged out successfully' })
  } catch {
    return NextResponse.json({ message: 'Logged out' })
  }
}
