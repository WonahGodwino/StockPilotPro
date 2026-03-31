import { withRedis } from './redis'

type RateLimitRecord = {
  count: number
  resetAt: number
}

type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

type LockoutState = {
  locked: boolean
  retryAfterSec: number
  reason?: 'account' | 'ip'
}

const store = new Map<string, RateLimitRecord>()

function nowMs() {
  return Date.now()
}

function gc(now: number) {
  for (const [k, v] of store.entries()) {
    if (v.resetAt <= now) store.delete(k)
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = nowMs()
  gc(now)

  const existing = store.get(key)
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterSec: Math.ceil(windowMs / 1000),
    }
  }

  existing.count += 1
  store.set(key, existing)

  const remaining = Math.max(0, limit - existing.count)
  const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))

  return {
    allowed: existing.count <= limit,
    remaining,
    retryAfterSec,
  }
}

export function resetRateLimit(key: string) {
  store.delete(key)
}

export async function consumeRateLimitDistributed(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redisResult = await withRedis(async (redis) => {
    const current = await redis.incr(key)
    if (current === 1) {
      await redis.pexpire(key, windowMs)
    }
    const ttlMs = await redis.pttl(key)
    const retryAfterSec = Math.max(1, Math.ceil(ttlMs / 1000))
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      retryAfterSec,
    }
  })

  if (redisResult) return redisResult
  return consumeRateLimit(key, limit, windowMs)
}

const ACCOUNT_FAIL_LIMIT = Number(process.env.AUTH_LOCKOUT_ACCOUNT_THRESHOLD || 8)
const IP_FAIL_LIMIT = Number(process.env.AUTH_LOCKOUT_IP_THRESHOLD || 20)
const FAIL_WINDOW_MS = Number(process.env.AUTH_LOCKOUT_WINDOW_MS || 15 * 60 * 1000)
const LOCKOUT_MS = Number(process.env.AUTH_LOCKOUT_DURATION_MS || 30 * 60 * 1000)

function accountFailKey(email: string) {
  return `auth:fail:account:${email.toLowerCase()}`
}

function ipFailKey(ip: string) {
  return `auth:fail:ip:${ip}`
}

function accountLockKey(email: string) {
  return `auth:lock:account:${email.toLowerCase()}`
}

function ipLockKey(ip: string) {
  return `auth:lock:ip:${ip}`
}

export async function getAuthLockoutState(email: string, ip: string): Promise<LockoutState> {
  const redisState = await withRedis(async (redis) => {
    const [accountTtlMs, ipTtlMs] = await redis
      .multi()
      .pttl(accountLockKey(email))
      .pttl(ipLockKey(ip))
      .exec()
      .then((res) => (res || []).map((r) => Number(r[1])))

    if (accountTtlMs > 0) {
      return {
        locked: true,
        retryAfterSec: Math.ceil(accountTtlMs / 1000),
        reason: 'account' as const,
      }
    }
    if (ipTtlMs > 0) {
      return {
        locked: true,
        retryAfterSec: Math.ceil(ipTtlMs / 1000),
        reason: 'ip' as const,
      }
    }
    return { locked: false, retryAfterSec: 0 }
  })

  if (redisState) return redisState

  const now = nowMs()
  const accountLock = store.get(accountLockKey(email))
  const ipLock = store.get(ipLockKey(ip))
  if (accountLock && accountLock.resetAt > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((accountLock.resetAt - now) / 1000),
      reason: 'account',
    }
  }
  if (ipLock && ipLock.resetAt > now) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((ipLock.resetAt - now) / 1000),
      reason: 'ip',
    }
  }
  return { locked: false, retryAfterSec: 0 }
}

export async function recordAuthFailure(email: string, ip: string): Promise<void> {
  const redisDone = await withRedis(async (redis) => {
    const accountKey = accountFailKey(email)
    const ipKey = ipFailKey(ip)

    const accountCount = await redis.incr(accountKey)
    if (accountCount === 1) await redis.pexpire(accountKey, FAIL_WINDOW_MS)

    const ipCount = await redis.incr(ipKey)
    if (ipCount === 1) await redis.pexpire(ipKey, FAIL_WINDOW_MS)

    if (accountCount >= ACCOUNT_FAIL_LIMIT) {
      await redis.psetex(accountLockKey(email), LOCKOUT_MS, '1')
    }
    if (ipCount >= IP_FAIL_LIMIT) {
      await redis.psetex(ipLockKey(ip), LOCKOUT_MS, '1')
    }
  })
  if (redisDone !== null) return

  const account = consumeRateLimit(accountFailKey(email), ACCOUNT_FAIL_LIMIT, FAIL_WINDOW_MS)
  const ipRate = consumeRateLimit(ipFailKey(ip), IP_FAIL_LIMIT, FAIL_WINDOW_MS)
  const now = nowMs()
  if (!account.allowed) {
    store.set(accountLockKey(email), { count: 1, resetAt: now + LOCKOUT_MS })
  }
  if (!ipRate.allowed) {
    store.set(ipLockKey(ip), { count: 1, resetAt: now + LOCKOUT_MS })
  }
}

export async function clearAuthFailures(email: string, ip: string): Promise<void> {
  const redisDone = await withRedis(async (redis) => {
    await redis.del(accountFailKey(email), ipFailKey(ip), accountLockKey(email), ipLockKey(ip))
  })
  if (redisDone !== null) return

  for (const key of [
    accountFailKey(email),
    ipFailKey(ip),
    accountLockKey(email),
    ipLockKey(ip),
  ]) {
    store.delete(key)
  }
}
