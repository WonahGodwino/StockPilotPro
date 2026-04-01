import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { signAccessToken, signRefreshToken, storeRefreshToken } from '@/lib/jwt'
import { getClientIp, handleOptions } from '@/lib/auth'
import {
  clearAuthFailures,
  consumeRateLimitDistributed,
  getAuthLockoutState,
  recordAuthFailure,
} from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

export async function OPTIONS() {
  return handleOptions()
}

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    const body = await req.json()
    const { email, password } = loginSchema.parse(body)

    const lockout = await getAuthLockoutState(email, clientIp)
    if (lockout.locked) {
      return NextResponse.json(
        {
          error:
            lockout.reason === 'account'
              ? 'Account temporarily locked due to repeated failed attempts.'
              : 'Too many failed attempts from your network. Try again later.',
        },
        {
          status: 423,
          headers: { 'Retry-After': String(lockout.retryAfterSec) },
        }
      )
    }

    const rateKey = `auth:login:${clientIp}:${email.toLowerCase()}`
    const rate = await consumeRateLimitDistributed(rateKey, 10, 15 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(rate.retryAfterSec),
            'X-RateLimit-Remaining': String(rate.remaining),
          },
        }
      )
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    })

    if (!user || !user.isActive || user.archived) {
      await recordAuthFailure(email, clientIp)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const isValid = await bcrypt.compare(password, user.password ?? '')
    if (!isValid) {
      await recordAuthFailure(email, clientIp)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Check subscription for non-super-admins
    if (user.tenantId && user.role !== 'SUPER_ADMIN') {
      const now = new Date()
      // Auto-expire any ACTIVE subscriptions whose expiry date has passed
      await prisma.subscription.updateMany({
        where: {
          tenantId: user.tenantId,
          status: 'ACTIVE',
          expiryDate: { lt: now },
        },
        data: { status: 'EXPIRED' },
      })
      const activeSubscription = await prisma.subscription.findFirst({
        where: { tenantId: user.tenantId, status: 'ACTIVE', expiryDate: { gte: now } },
      })
      if (!activeSubscription) {
        return NextResponse.json({ error: 'Subscription expired or inactive. Contact your administrator.' }, { status: 403 })
      }
    }

    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      subsidiaryId: user.subsidiaryId,
    }

    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)
    await storeRefreshToken(user.id, refreshToken)

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastSeenAt: new Date() },
    })

    await clearAuthFailures(email, clientIp)
    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN',
      entity: 'auth',
      entityId: user.id,
      req,
    })

    return NextResponse.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        subsidiaryId: user.subsidiaryId,
        tenant: user.tenant ? { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug, baseCurrency: user.tenant.baseCurrency } : null,
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[AUTH LOGIN]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
