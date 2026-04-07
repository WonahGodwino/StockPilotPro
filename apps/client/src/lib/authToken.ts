function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

export function getTokenExpiryMs(token: string): number | null {
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp

  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null
  }

  return exp * 1000
}

export function isTokenExpired(token: string): boolean {
  const expiryMs = getTokenExpiryMs(token)
  if (!expiryMs) return false
  return Date.now() >= expiryMs
}
