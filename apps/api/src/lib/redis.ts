import Redis from 'ioredis'

let redisClient: Redis | null = null
let redisDisabled = false

export function getRedisClient(): Redis | null {
  const url = process.env.REDIS_URL
  if (!url || redisDisabled) return null

  if (!redisClient) {
    redisClient = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })

    redisClient.on('error', () => {
      redisDisabled = true
      try {
        redisClient?.disconnect()
      } catch {
        // ignore disconnect errors
      }
      redisClient = null
    })
  }

  return redisClient
}

export async function withRedis<T>(fn: (redis: Redis) => Promise<T>): Promise<T | null> {
  const redis = getRedisClient()
  if (!redis) return null

  try {
    if (redis.status === 'wait') {
      await redis.connect()
    }
    return await fn(redis)
  } catch {
    return null
  }
}
