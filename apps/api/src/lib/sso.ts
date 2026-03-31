/**
 * SSO OAuth2 helpers for Google and Microsoft providers.
 * Uses the Authorization Code flow – backend-driven.
 */

import { createHmac, timingSafeEqual } from 'crypto'

export type SsoProvider = 'google' | 'microsoft'

const ALLOWED_PROVIDERS: SsoProvider[] = ['google', 'microsoft']

export function isValidProvider(provider: string): provider is SsoProvider {
  return ALLOWED_PROVIDERS.includes(provider as SsoProvider)
}

// ─── Google ───────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

// ─── Microsoft ────────────────────────────────────────────────────────────────

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const MICROSOFT_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me'

// ─── Shared ───────────────────────────────────────────────────────────────────

export interface OAuthUserInfo {
  providerUserId: string
  email: string
  firstName: string
  lastName: string
  displayName: string
}

function getRedirectUri(provider: SsoProvider): string {
  const base = process.env.API_BASE_URL || 'http://localhost:3000'
  return `${base}/api/auth/sso/${provider}/callback`
}

/**
 * Build the OAuth2 authorization URL for the given provider.
 */
export function buildAuthorizationUrl(provider: SsoProvider, state: string): string {
  const redirectUri = getRedirectUri(provider)

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured')

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'select_account',
    })
    return `${GOOGLE_AUTH_URL}?${params.toString()}`
  }

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID
    if (!clientId) throw new Error('MICROSOFT_CLIENT_ID is not configured')

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile User.Read',
      state,
      response_mode: 'query',
    })
    return `${MICROSOFT_AUTH_URL}?${params.toString()}`
  }

  throw new Error(`Unsupported provider: ${provider}`)
}

/**
 * Exchange an authorization code for tokens, then fetch user info.
 */
export async function exchangeCodeForUserInfo(
  provider: SsoProvider,
  code: string
): Promise<OAuthUserInfo> {
  const redirectUri = getRedirectUri(provider)

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('Google OAuth credentials not configured')

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      throw new Error(`Google token exchange failed: ${err}`)
    }

    const tokenData = await tokenRes.json() as { access_token: string }
    const { access_token } = tokenData

    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    if (!userRes.ok) throw new Error('Failed to fetch Google user info')

    const info = await userRes.json() as {
      sub: string
      email: string
      given_name?: string
      family_name?: string
      name?: string
    }

    return {
      providerUserId: info.sub,
      email: info.email,
      firstName: info.given_name || info.name?.split(' ')[0] || '',
      lastName: info.family_name || info.name?.split(' ').slice(1).join(' ') || '',
      displayName: info.name || info.email,
    }
  }

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
    if (!clientId || !clientSecret) throw new Error('Microsoft OAuth credentials not configured')

    const tokenRes = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid email profile User.Read',
      }).toString(),
    })

    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      throw new Error(`Microsoft token exchange failed: ${err}`)
    }

    const tokenData = await tokenRes.json() as { access_token: string }
    const { access_token } = tokenData

    const userRes = await fetch(MICROSOFT_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    if (!userRes.ok) throw new Error('Failed to fetch Microsoft user info')

    const info = await userRes.json() as {
      id: string
      mail?: string
      userPrincipalName?: string
      givenName?: string
      surname?: string
      displayName?: string
    }

    const email = info.mail || info.userPrincipalName || ''
    const displayName = info.displayName || email

    return {
      providerUserId: info.id,
      email,
      firstName: info.givenName || displayName.split(' ')[0] || '',
      lastName: info.surname || displayName.split(' ').slice(1).join(' ') || '',
      displayName,
    }
  }

  throw new Error(`Unsupported provider: ${provider}`)
}

/**
 * Extract and normalize the ssoProviders array from a tenant record.
 */
export function getSsoProviders(ssoProviders: unknown): string[] {
  return Array.isArray(ssoProviders) ? (ssoProviders as string[]) : []
}

/**
 * Build and HMAC-sign an opaque SSO state token carrying tenantId and nonce.
 * Format: base64url(JSON) + "." + base64url(HMAC-SHA256 signature)
 */
export function buildSsoState(tenantId: string, nonce: string): string {
  const payload = Buffer.from(JSON.stringify({ tenantId, nonce })).toString('base64url')
  const sig = hmacSign(payload)
  return `${payload}.${sig}`
}

export function parseSsoState(state: string): { tenantId: string; nonce: string } | null {
  try {
    const dotIndex = state.lastIndexOf('.')
    if (dotIndex === -1) return null

    const payload = state.slice(0, dotIndex)
    const sig = state.slice(dotIndex + 1)

    if (!hmacVerify(payload, sig)) return null

    const decoded = Buffer.from(payload, 'base64url').toString('utf8')
    const parsed = JSON.parse(decoded) as { tenantId: string; nonce: string }
    if (typeof parsed.tenantId !== 'string' || typeof parsed.nonce !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function hmacSign(data: string): string {
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production'
  return createHmac('sha256', secret).update(data).digest('base64url')
}

function hmacVerify(data: string, signature: string): boolean {
  try {
    const expected = hmacSign(data)
    const a = Buffer.from(expected, 'base64url')
    const b = Buffer.from(signature, 'base64url')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

