import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

describe('DB pool exhaustion handling', () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it('defaults pool size to 10 when DB_POOL_SIZE is unset', async () => {
        delete process.env.DB_POOL_SIZE
        delete process.env.PGHOST
        process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/test'

        const mod = await import('../db/client.js')
        const pool = mod.getPool()
        expect((pool.options as any).max).toBe(10)
        await mod.closePool()
    })

    it('reads DB_POOL_SIZE from environment', async () => {
        process.env.DB_POOL_SIZE = '25'
        delete process.env.PGHOST
        process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/test'

        const mod = await import('../db/client.js')
        const pool = mod.getPool()
        expect((pool.options as any).max).toBe(25)
        await mod.closePool()
        delete process.env.DB_POOL_SIZE
    })

    it('PoolExhaustedError has statusCode 503', async () => {
        const { PoolExhaustedError } = await import('../db/client.js')
        const err = new PoolExhaustedError('pool full')
        expect(err.statusCode).toBe(503)
        expect(err.name).toBe('PoolExhaustedError')
        expect(err.message).toBe('pool full')
    })

    it('mapUnknownError maps PoolExhaustedError to 503', async () => {
        const { PoolExhaustedError } = await import('../db/client.js')
        const { mapUnknownError } = await import('../utils/apiErrors.js')

        const mapped = mapUnknownError(new PoolExhaustedError('pool exhausted'))
        expect(mapped.status).toBe(503)
        expect(mapped.code).toBe('SERVICE_UNAVAILABLE')
    })
})
