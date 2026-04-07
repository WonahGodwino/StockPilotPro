import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  isValidProvider,
  exchangeCodeForUserInfo,
  parseSsoState,
  getSsoProviders,
} from '@/lib/sso'
import { signAccessToken, signRefreshToken, storeRefreshToken } from '@/lib/jwt'
import { logAudit } from '@/lib/audit'
import { getActiveSubscriptionForTenant } from '@/lib/subscription-enforcement'

/**
 * GET /api/auth/sso/[provider]/callback?code=xxx&state=xxx
 *
 * OAuth2 callback handler. Exchanges the authorization code for user info,
 * looks up or links the user in the database, then redirects to the frontend
 * with JWT tokens in the URL fragment (never logged by servers).
 *
 * Only BUSINESS_ADMIN and SUPER_ADMIN accounts may authenticate via SSO.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const { provider } = params
  const frontendOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:5173'

  if (!isValidProvider(provider)) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=unsupported_provider`
    )
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const errorParam = searchParams.get('error')

  if (errorParam) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=${encodeURIComponent(errorParam)}`
    )
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=missing_params`
    )
  }

  const parsedState = parseSsoState(state)
  if (!parsedState) {
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=invalid_state`
    )
  }

  const { tenantId } = parsedState

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } })

    if (!tenant || !tenant.isActive || tenant.archived || !tenant.ssoEnabled) {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=tenant_not_found`
      )
    }

    const providers = getSsoProviders(tenant.ssoProviders)
    if (!providers.includes(provider)) {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=provider_not_enabled`
      )
    }

    const oauthUser = await exchangeCodeForUserInfo(provider, code)

    // Look up user by email, scoped to this tenant
    const user = await prisma.user.findFirst({
      where: {
        email: oauthUser.email,
        tenantId,
        isActive: true,
        archived: false,
      },
      include: { tenant: true },
    })

    // SSO is restricted to BUSINESS_ADMIN and SUPER_ADMIN
    if (!user) {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=user_not_found`
      )
    }

    if (user.role !== 'BUSINESS_ADMIN' && user.role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(
        `${frontendOrigin}/login?sso_error=role_not_permitted`
      )
    }

    // Check active subscription for non-super-admins.
    if (user.tenantId && user.role !== 'SUPER_ADMIN') {
      const activeSub = await getActiveSubscriptionForTenant(user.tenantId)
      if (!activeSub) {
        return NextResponse.redirect(
          `${frontendOrigin}/login?sso_error=subscription_expired`
        )
      }
    }

    // Upsert the SsoAccount link (unique on provider + providerUserId)
    await prisma.ssoAccount.upsert({
      where: { provider_providerUserId: { provider, providerUserId: oauthUser.providerUserId } },
      create: {
        userId: user.id,
        tenantId,
        provider,
        providerUserId: oauthUser.providerUserId,
        email: oauthUser.email,
        displayName: oauthUser.displayName,
      },
      update: {
        userId: user.id,
        email: oauthUser.email,
        displayName: oauthUser.displayName,
        updatedAt: new Date(),
      },
    })

    const jwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      subsidiaryId: user.subsidiaryId,
    }

    const accessToken = signAccessToken(jwtPayload)
    const refreshToken = signRefreshToken(jwtPayload)
    await storeRefreshToken(user.id, refreshToken)

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    await logAudit({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN',
      entity: 'auth',
      entityId: user.id,
      newValues: { method: 'sso', provider },
      req,
    })

    // Redirect to frontend SSO callback page.
    // Tokens are placed in the URL fragment so they are never sent to servers
    // and do not appear in access logs.
    const fragmentData = new URLSearchParams({
      accessToken,
      refreshToken,
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      ...(user.tenantId ? { tenantId: user.tenantId } : {}),
      ...(user.subsidiaryId ? { subsidiaryId: user.subsidiaryId } : {}),
      ...(user.tenant ? { tenantName: user.tenant.name, tenantSlug: user.tenant.slug, baseCurrency: user.tenant.baseCurrency || 'USD' } : {}),
    })

    return NextResponse.redirect(
      `${frontendOrigin}/sso-callback#${fragmentData.toString()}`
    )
  } catch (err) {
    console.error(`[SSO CALLBACK ${provider.toUpperCase()}]`, err)
    return NextResponse.redirect(
      `${frontendOrigin}/login?sso_error=server_error`
    )
  }
}
