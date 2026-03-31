import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, JWTPayload } from './jwt'
import { logger } from './logger'
import { getRequestId, setRequestIdHeader } from './tracing'

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }
  return null
}

export function getClientIp(req: NextRequest): string {
  const forwardedFor = req.headers.get('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  const realIp = req.headers.get('x-real-ip')
  if (realIp) return realIp
  return 'unknown'
}

export function getUserAgent(req: NextRequest): string | null {
  return req.headers.get('user-agent')
}

export function authenticate(req: NextRequest): JWTPayload {
  const token = getTokenFromRequest(req)
  if (!token) throw new Error('No token provided')
  return verifyAccessToken(token)
}

export function requireAuth(
  handler: (req: NextRequest, user: JWTPayload, ...args: unknown[]) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: unknown[]) => {
    const requestId = getRequestId(req)
    const start = Date.now()
    const method = req.method
    const path = new URL(req.url).pathname

    logger.info('request received', { requestId, method, path })

    try {
      const user = authenticate(req)
      const response = await handler(req, user, ...args)
      const durationMs = Date.now() - start
      logger.info('request completed', {
        requestId,
        method,
        path,
        statusCode: response.status,
        durationMs,
        userId: user.userId,
        tenantId: user.tenantId ?? undefined,
      })
      return setRequestIdHeader(response, requestId)
    } catch {
      const durationMs = Date.now() - start
      logger.warn('request unauthorized', { requestId, method, path, durationMs, statusCode: 401 })
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return setRequestIdHeader(response, requestId)
    }
  }
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

export function apiSuccess(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function handleOptions(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:5173',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
