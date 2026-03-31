import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { verifyRefreshToken, rotateRefreshToken } from '@/lib/jwt'
import { getClientIp, handleOptions } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'

const schema = z.object({ refreshToken: z.string() })

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    const rate = await consumeRateLimitDistributed(`auth:refresh:${clientIp}`, 30, 15 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many token refresh attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      )
    }

    const body = await req.json()
    const { refreshToken } = schema.parse(body)

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
    if (!stored || stored.expiresAt < new Date()) {
      return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
    }

    const payload = verifyRefreshToken(refreshToken)

    const { accessToken, refreshToken: newRefresh } = await rotateRefreshToken(refreshToken, payload)

    return NextResponse.json({ accessToken, refreshToken: newRefresh })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[AUTH REFRESH]', err)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
