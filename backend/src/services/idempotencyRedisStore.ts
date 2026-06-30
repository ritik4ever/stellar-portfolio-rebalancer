import Redis from 'ioredis'
import { REDIS_URL, redisProbe } from '../queue/connection.js'
import { logger } from '../utils/logger.js'

let redis: Redis | null = null
let redisAvailable: boolean | null = null

async function getRedis(): Promise<Redis | null> {
    if (redisAvailable === null) {
        try {
            redisAvailable = await redisProbe.isAvailable()
        } catch {
            redisAvailable = false
        }
    }
    if (!redisAvailable) return null
    if (!redis) {
        redis = new Redis(REDIS_URL, {
            lazyConnect: false,
            maxRetriesPerRequest: 2,
            enableReadyCheck: false
        })
        redis.on('error', () => {
            redisAvailable = false
        })
    }
    return redis
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60

export async function redisStoreIdempotencyResult(
    key: string,
    requestHash: string,
    method: string,
    path: string,
    statusCode: number,
    responseBody: unknown
): Promise<void> {
    try {
        const r = await getRedis()
        if (!r) return
        const payload = JSON.stringify({
            key,
            requestHash,
            method,
            path,
            statusCode,
            responseBody: JSON.stringify(responseBody)
        })
        const redisKey = `idempotency:${key}`
        await r.setex(redisKey, IDEMPOTENCY_TTL_SECONDS, payload)
    } catch {
        logger.warn('[IDEMPOTENCY-REDIS] Failed to store idempotency result in Redis')
    }
}

export async function redisGetIdempotencyResult(key: string): Promise<{
    key: string
    requestHash: string
    method: string
    path: string
    statusCode: number
    responseBody: string
    createdAt: string
    expiresAt: string
} | undefined> {
    try {
        const r = await getRedis()
        if (!r) return undefined
        const raw = await r.get(`idempotency:${key}`)
        if (!raw) return undefined
        const parsed = JSON.parse(raw) as {
            key: string
            requestHash: string
            method: string
            path: string
            statusCode: number
            responseBody: string
        }
        const now = new Date()
        return {
            key: parsed.key,
            requestHash: parsed.requestHash,
            method: parsed.method,
            path: parsed.path,
            statusCode: parsed.statusCode,
            responseBody: parsed.responseBody,
            createdAt: new Date(now.getTime() - IDEMPOTENCY_TTL_SECONDS * 1000).toISOString(),
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_SECONDS * 1000).toISOString()
        }
    } catch {
        return undefined
    }
}

export async function closeIdempotencyRedis(): Promise<void> {
    if (redis) {
        await redis.quit()
        redis = null
        redisAvailable = null
    }
}
