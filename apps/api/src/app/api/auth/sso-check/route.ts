import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handleOptions, getClientIp } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'
import { getSsoProviders } from '@/lib/sso'

const schema = z.object({ email: z.string().email() })

export async function OPTIONS() {
  return handleOptions()
}

/**
 * POST /api/auth/sso-check
 *
 * Public endpoint that checks whether SSO is available for the account
 * identified by the provided email address.
 *
 * Returns:
 *   { ssoEnabled: boolean, providers: string[], tenantId: string | null }
 *
 * This is intentionally low-information – it only reveals SSO availability,
 * not whether an account exists, to avoid user enumeration.
 */
export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req)
    const rate = await consumeRateLimitDistributed(`sso:check:${clientIp}`, 30, 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfterSec) } }
      )
    }

    const body = await req.json()
    const { email } = schema.parse(body)

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        role: true,
        tenantId: true,
        isActive: true,
        archived: true,
        tenant: {
          select: { ssoEnabled: true, ssoProviders: true, isActive: true, archived: true },
        },
      },
    })

    // Only reveal SSO status for admin roles with an active tenant
    if (
      !user ||
      !user.isActive ||
      user.archived ||
      (user.role !== 'BUSINESS_ADMIN' && user.role !== 'SUPER_ADMIN') ||
      !user.tenant ||
      !user.tenant.isActive ||
      user.tenant.archived ||
      !user.tenant.ssoEnabled
    ) {
      return NextResponse.json({ ssoEnabled: false, providers: [], tenantId: null })
    }

    const providers = getSsoProviders(user.tenant.ssoProviders)

    return NextResponse.json({
      ssoEnabled: true,
      providers,
      tenantId: user.tenantId,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 422 })
    }
    console.error('[SSO CHECK]', err)
    return NextResponse.json({ ssoEnabled: false, providers: [], tenantId: null })
  }
}
