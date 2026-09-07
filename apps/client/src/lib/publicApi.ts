/**
 * Lightweight public API client for storefront pages.
 * Does NOT attach auth headers — safe for unauthenticated visitors.
 */
const BASE_URL = 'http://localhost:3000'

export async function publicGet<T = unknown>(path: string): Promise<{ data: T }> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return res.json()
}

export async function publicPost<T = unknown>(path: string, body: unknown): Promise<{ data: T }> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `Request failed: ${res.status}`)
  }
  return res.json()
}
