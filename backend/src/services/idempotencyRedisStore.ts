import Redis from 'ioredis'
import { REDIS_URL, redisProbe } from '../queue/connection.js'
import { dbStoreIdempotencyResult, dbGetIdempotencyResult } from '../db/idempotencyDb.js'
import { logger } from '../utils/logger.js'
import type { IdempotencyRecord } from '../types/index.js'

let redis: Redis | null = null
let redisAvailable: boolean | null = null
let failoverActive = false

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
            if (redisAvailable) {
                logger.warn('[IDEMPOTENCY-REDIS] Redis connection error, activating DB failover')
            }
            redisAvailable = false
            failoverActive = true
        })
    }
    return redis
}

function activateFailover(reason: string): void {
    if (!failoverActive) {
        failoverActive = true
        redisAvailable = false
        logger.warn('[IDEMPOTENCY-REDIS] Failover to DB-backed store activated', { reason })
    }
}

export function isFailoverActive(): boolean {
    return failoverActive
}

export function resetFailover(): void {
    failoverActive = false
    redisAvailable = null
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
const IDEMPOTENCY_TTL_MS = IDEMPOTENCY_TTL_SECONDS * 1000

export async function storeIdempotencyResult(
    key: string,
    requestHash: string,
    method: string,
    path: string,
    statusCode: number,
    responseBody: unknown
): Promise<void> {
    try {
        const r = await getRedis()
        if (r) {
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
            dbStoreIdempotencyResult(key, requestHash, method, path, statusCode, responseBody, IDEMPOTENCY_TTL_MS)
            return
        }
        activateFailover('Redis connection unavailable')
    } catch (err) {
        activateFailover(err instanceof Error ? err.message : String(err))
    }
    dbStoreIdempotencyResult(key, requestHash, method, path, statusCode, responseBody, IDEMPOTENCY_TTL_MS)
}

export async function getIdempotencyResult(key: string): Promise<IdempotencyRecord | undefined> {
    try {
        const r = await getRedis()
        if (r) {
            const raw = await r.get(`idempotency:${key}`)
            if (raw) {
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
            }
            return dbGetIdempotencyResult(key)
        }
        activateFailover('Redis connection unavailable')
    } catch (err) {
        activateFailover(err instanceof Error ? err.message : String(err))
    }
    return dbGetIdempotencyResult(key)
}

export async function redisStoreIdempotencyResult(
    key: string,
    requestHash: string,
    method: string,
    path: string,
    statusCode: number,
    responseBody: unknown
): Promise<void> {
    return storeIdempotencyResult(key, requestHash, method, path, statusCode, responseBody)
}

export async function redisGetIdempotencyResult(key: string): Promise<IdempotencyRecord | undefined> {
    return getIdempotencyResult(key)
}

export async function closeIdempotencyRedis(): Promise<void> {
    if (redis) {
        await redis.quit()
        redis = null
        redisAvailable = null
        failoverActive = false
    }
}
