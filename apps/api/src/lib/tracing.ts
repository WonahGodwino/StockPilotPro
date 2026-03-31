/**
 * Request-tracing utilities for StockPilot API.
 *
 * Every inbound HTTP request is assigned a unique `requestId` that is:
 *   - Read from the `x-request-id` request header when provided by an upstream
 *     proxy or load-balancer (allows end-to-end trace correlation).
 *   - Generated fresh with `crypto.randomUUID()` when not present.
 *
 * The resolved ID is forwarded in the `x-request-id` response header so
 * clients can correlate their own logs with server-side log entries.
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Extract an existing request ID from the incoming request or generate a new
 * one using the Web Crypto API (available in Next.js Edge & Node runtimes).
 */
export function getRequestId(req: NextRequest): string {
  return req.headers.get('x-request-id') || crypto.randomUUID()
}

/**
 * Injects `x-request-id` into the response headers.
 * Call this before returning any NextResponse.
 */
export function setRequestIdHeader(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('x-request-id', requestId)
  return response
}

/**
 * Higher-order function that wraps a route handler with request-ID extraction
 * and header injection.  The `requestId` is forwarded to the inner handler so
 * it can be included in log entries.
 *
 * The `...args` rest parameter forwards any additional arguments that Next.js
 * passes to route handlers — most notably the route-context object containing
 * dynamic segment params (e.g. `{ params: { id: '...' } }` for `[id]` routes).
 *
 * Usage:
 *   export const GET = withTracing(async (req, requestId) => { ... })
 */
export function withTracing(
  handler: (req: NextRequest, requestId: string, ...args: unknown[]) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: unknown[]): Promise<NextResponse> => {
    const requestId = getRequestId(req)
    const response = await handler(req, requestId, ...args)
    return setRequestIdHeader(response, requestId)
  }
}
