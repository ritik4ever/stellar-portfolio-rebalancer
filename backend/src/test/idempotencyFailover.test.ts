import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTempDbPath(): string {
    const dir = join(tmpdir(), `idem-failover-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'test.db')
}

describe('idempotencyRedisStore failover', () => {
    let dbPath: string

    beforeEach(() => {
        dbPath = makeTempDbPath()
        process.env.DB_PATH = dbPath
        vi.resetModules()
    })

    afterEach(async () => {
        const { closeIdempotencyDb } = await import('../db/idempotencyDb.js')
        closeIdempotencyDb()
        const { closeIdempotencyRedis } = await import('../services/idempotencyRedisStore.js')
        await closeIdempotencyRedis()
        if (existsSync(dbPath)) rmSync(dbPath, { force: true, recursive: true })
        delete process.env.DB_PATH
    })

    it('falls back to DB store when Redis is unavailable', async () => {
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:1',
            redisProbe: {
                isAvailable: vi.fn().mockResolvedValue(false)
            }
        }))

        const { storeIdempotencyResult, getIdempotencyResult, isFailoverActive } = await import('../services/idempotencyRedisStore.js')
        const { dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')

        await storeIdempotencyResult('failover-key-1', 'hash-1', 'POST', '/test', 200, { ok: true })

        const dbRecord = dbGetIdempotencyResult('failover-key-1')
        expect(dbRecord).toBeDefined()
        expect(dbRecord!.key).toBe('failover-key-1')
        expect(dbRecord!.requestHash).toBe('hash-1')

        const result = await getIdempotencyResult('failover-key-1')
        expect(result).toBeDefined()
        expect(result!.key).toBe('failover-key-1')
        expect(isFailoverActive()).toBe(true)
    })

    it('preserves idempotency guarantees via DB fallback on Redis outage', async () => {
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:1',
            redisProbe: {
                isAvailable: vi.fn().mockResolvedValue(false)
            }
        }))

        const { storeIdempotencyResult, getIdempotencyResult } = await import('../services/idempotencyRedisStore.js')

        await storeIdempotencyResult('idem-guarantee-key', 'hash-abc', 'POST', '/api/rebalance', 201, { id: 'r1' })

        const first = await getIdempotencyResult('idem-guarantee-key')
        expect(first).toBeDefined()
        expect(first!.requestHash).toBe('hash-abc')
        expect(first!.statusCode).toBe(201)

        const second = await getIdempotencyResult('idem-guarantee-key')
        expect(second).toBeDefined()
        expect(second!.requestHash).toBe('hash-abc')
    })

    it('stores to DB when Redis is available but setex fails', async () => {
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:6379',
            redisProbe: {
                isAvailable: vi.fn().mockResolvedValue(true)
            }
        }))

        vi.doMock('ioredis', () => {
            const MockRedis = vi.fn().mockImplementation(() => ({
                setex: vi.fn().mockRejectedValue(new Error('Redis write failed')),
                get: vi.fn().mockResolvedValue(null),
                quit: vi.fn().mockResolvedValue('OK'),
                on: vi.fn()
            }))
            return { default: MockRedis }
        })

        const { storeIdempotencyResult, getIdempotencyResult, isFailoverActive } = await import('../services/idempotencyRedisStore.js')
        const { dbGetIdempotencyResult } = await import('../db/idempotencyDb.js')

        await storeIdempotencyResult('failover-write-key', 'hash-fw', 'POST', '/test', 200, { fw: true })

        expect(isFailoverActive()).toBe(true)
        const dbRecord = dbGetIdempotencyResult('failover-write-key')
        expect(dbRecord).toBeDefined()

        const result = await getIdempotencyResult('failover-write-key')
        expect(result).toBeDefined()
        expect(result!.key).toBe('failover-write-key')
    })

    it('TTL semantics are preserved in DB fallback', async () => {
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:1',
            redisProbe: {
                isAvailable: vi.fn().mockResolvedValue(false)
            }
        }))

        const { storeIdempotencyResult, getIdempotencyResult } = await import('../services/idempotencyRedisStore.js')

        await storeIdempotencyResult('ttl-key', 'hash-ttl', 'POST', '/test', 200, { ttl: true })

        const record = await getIdempotencyResult('ttl-key')
        expect(record).toBeDefined()
        expect(record!.expiresAt).toBeDefined()

        const expiresAt = new Date(record!.expiresAt).getTime()
        const createdAt = new Date(record!.createdAt).getTime()
        const diffHours = (expiresAt - createdAt) / (1000 * 60 * 60)
        expect(diffHours).toBeGreaterThanOrEqual(23)
        expect(diffHours).toBeLessThanOrEqual(25)
    })
})
