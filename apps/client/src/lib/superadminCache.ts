const SUPERADMIN_CACHE_PREFIX = 'stockpilot:superadmin'

export const getSuperadminCacheKey = (scope: string) => `${SUPERADMIN_CACHE_PREFIX}:${scope}`

export const isOnlineNow = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

export const readSuperadminCache = <T>(key: string): T | null => {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const writeSuperadminCache = <T>(key: string, value: T) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(value))
}
