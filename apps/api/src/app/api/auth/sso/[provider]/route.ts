import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isValidProvider, buildAuthorizationUrl, buildSsoState, getSsoProviders } from '@/lib/sso'
import { handleOptions } from '@/lib/auth'
import { consumeRateLimitDistributed } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/auth'
import { randomBytes } from 'crypto'

export async function OPTIONS() {
  return handleOptions()
}

/**
 * GET /api/auth/sso/[provider]?tenantId=xxx
 *
 * Initiates the OAuth2 authorization code flow for the specified provider.
 * Validates that the tenant has SSO enabled for the requested provider, then
 * redirects the browser to the OAuth consent screen.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const { provider } = params
  const frontendOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173'
  const clientIp = getClientIp(req)

  const rate = await consumeRateLimitDistributed(`sso:init:${clientIp}`, 20, 60 * 1000)
  if (!rate.allowed) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=too_many_requests`
    )
  }

  if (!isValidProvider(provider)) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=unsupported_provider`
    )
  }

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenantId')

  if (!tenantId) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=missing_tenant`
    )
  }

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })

    if (!tenant || !tenant.isActive || tenant.archived) {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=tenant_not_found`
      )
    }

    if (!tenant.ssoEnabled) {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=sso_disabled`
      )
    }

    const providers = getSsoProviders(tenant.ssoProviders)
    if (!providers.includes(provider)) {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=provider_not_enabled`
      )
    }

    const nonce = randomBytes(16).toString('hex')
    const state = buildSsoState(tenantId, nonce)
    const authUrl = buildAuthorizationUrl(provider, state)

    return NextResponse.redirect(authUrl)
  } catch (err) {
    console.error(`[SSO INIT ${provider.toUpperCase()}]`, err)
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=server_error`
    )
  }
}
