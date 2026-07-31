import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeTempDbPath(): string {
    const dir = join(tmpdir(), `health-summary-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    return join(dir, 'test.db')
}

describe('buildDependencyHealthSummary', () => {
    let dbPath: string

    beforeEach(() => {
        dbPath = makeTempDbPath()
        process.env.DB_PATH = dbPath
        vi.resetModules()
        vi.doMock('../queue/connection.js', () => ({
            REDIS_URL: 'redis://localhost:1',
            redisProbe: { isAvailable: vi.fn().mockResolvedValue(false) },
            isRedisAvailable: vi.fn().mockResolvedValue(false)
        }))
    })

    afterEach(async () => {
        if (existsSync(dbPath)) rmSync(dbPath, { force: true, recursive: true })
        delete process.env.DB_PATH
    })

    it('returns health summary with all dependency keys', async () => {
        const { buildDependencyHealthSummary } = await import('../services/serviceContainer.js')
        const summary = await buildDependencyHealthSummary()

        expect(summary).toBeDefined()
        expect(summary.timestamp).toBeDefined()
        expect(summary.status).toBeDefined()
        expect(summary.dependencies).toBeDefined()
        expect(summary.dependencies.database).toBeDefined()
        expect(summary.dependencies.redis).toBeDefined()
        expect(summary.dependencies.sorobanRpc).toBeDefined()
        expect(summary.dependencies.reflector).toBeDefined()
    })

    it('reports database as ok when DB is accessible', async () => {
        const { buildDependencyHealthSummary } = await import('../services/serviceContainer.js')
        const summary = await buildDependencyHealthSummary()

        expect(summary.dependencies.database.status).toBe('ok')
        expect(summary.dependencies.database.latency_ms).toBeGreaterThanOrEqual(0)
        expect(summary.dependencies.database.last_checked).toBeDefined()
    })

    it('reports redis as down when Redis is unavailable', async () => {
        const { buildDependencyHealthSummary } = await import('../services/serviceContainer.js')
        const summary = await buildDependencyHealthSummary()

        expect(summary.dependencies.redis.status).toBe('down')
        expect(summary.status).toBe('unhealthy')
    })

    it('includes latency and last_checked for each dependency', async () => {
        const { buildDependencyHealthSummary } = await import('../services/serviceContainer.js')
        const summary = await buildDependencyHealthSummary()

        for (const dep of Object.values(summary.dependencies)) {
            expect(dep.latency_ms).toBeGreaterThanOrEqual(0)
            expect(dep.last_checked).toBeDefined()
            expect(typeof dep.last_checked).toBe('string')
        }
    })
})
