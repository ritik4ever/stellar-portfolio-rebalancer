/**
 * Rate limit dashboard tests.
 *
 * Covers the combined per-IP + per-API-key aggregation in rateLimitMonitor
 * (correctness against seeded counters, near-limit/throttled classification,
 * filtering and pagination) plus the admin endpoint that serves it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { rateLimitMonitor } from '../services/rateLimitMonitor.js'
import type { Request } from 'express'

vi.mock('../utils/logger.js', () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const ORIGINAL_ENV = { ...process.env }

/** Seed `count` requests for an identifier, the last `throttled` of them 429'd. */
function seed(
    type: 'ip' | 'apiKey',
    identifier: string,
    count: number,
    throttled = 0,
): void {
    for (let i = 0; i < count - throttled; i++) {
        rateLimitMonitor.recordConsumption(type, identifier)
    }
    for (let i = 0; i < throttled; i++) {
        rateLimitMonitor.recordConsumption(type, identifier, { throttled: true })
    }
}

function makeReq(overrides: Partial<Request> = {}): Request {
    return {
        ip: '127.0.0.1',
        method: 'GET',
        path: '/api/test',
        route: { path: '/api/test' },
        user: undefined,
        get: vi.fn(),
        ...overrides,
    } as unknown as Request
}

describe('rateLimitMonitor consumption dashboard', () => {
    beforeEach(() => {
        process.env.RATE_LIMIT_MAX = '100'
        process.env.RATE_LIMIT_WINDOW_MS = '900000'
        process.env.RATE_LIMIT_NEAR_LIMIT_RATIO = '0.8'
        rateLimitMonitor.resetConsumption()
    })

    afterEach(() => {
        rateLimitMonitor.resetConsumption()
        process.env = { ...ORIGINAL_ENV }
        vi.useRealTimers()
    })

    describe('aggregation', () => {
        it('counts consumption per identifier and separates IPs from API keys', () => {
            seed('ip', '10.0.0.1', 5)
            seed('ip', '10.0.0.2', 3)
            seed('apiKey', 'key-abc', 7)

            const { summary, entries } = rateLimitMonitor.getRateLimitDashboard()

            expect(summary.trackedIdentifiers).toBe(3)
            expect(summary.trackedIPs).toBe(2)
            expect(summary.trackedApiKeys).toBe(1)

            const byId = Object.fromEntries(entries.map(e => [e.identifier, e]))
            expect(byId['10.0.0.1']).toMatchObject({ type: 'ip', consumed: 5, remaining: 95 })
            expect(byId['10.0.0.2']).toMatchObject({ type: 'ip', consumed: 3 })
            expect(byId['key-abc']).toMatchObject({ type: 'apiKey', consumed: 7, remaining: 93 })
        })

        it('tracks the same identifier string separately per type', () => {
            seed('ip', 'shared-id', 2)
            seed('apiKey', 'shared-id', 4)

            const { entries } = rateLimitMonitor.getRateLimitDashboard()
            const matching = entries.filter(e => e.identifier === 'shared-id')

            expect(matching).toHaveLength(2)
            expect(matching.find(e => e.type === 'ip')!.consumed).toBe(2)
            expect(matching.find(e => e.type === 'apiKey')!.consumed).toBe(4)
        })

        it('computes utilization against the configured limit', () => {
            seed('ip', '10.0.0.3', 25)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === '10.0.0.3')!

            expect(entry.utilization).toBeCloseTo(0.25, 4)
            expect(entry.limit).toBe(100)
        })

        it('honours a per-identifier limit override', () => {
            rateLimitMonitor.recordConsumption('apiKey', 'key-limited', { limit: 10 })
            seed('apiKey', 'key-limited', 8)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === 'key-limited')!

            expect(entry.limit).toBe(10)
            expect(entry.consumed).toBe(9)
            expect(entry.status).toBe('near-limit')
        })
    })

    describe('status classification', () => {
        it('marks identifiers below the near-limit ratio as ok', () => {
            seed('ip', '10.0.1.1', 10)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === '10.0.1.1')!

            expect(entry.status).toBe('ok')
        })

        it('marks identifiers at or above the ratio as near-limit', () => {
            seed('ip', '10.0.1.2', 80)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === '10.0.1.2')!

            expect(entry.status).toBe('near-limit')
        })

        it('marks any identifier with a 429 as throttled', () => {
            seed('apiKey', 'key-throttled', 5, 2)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === 'key-throttled')!

            expect(entry.status).toBe('throttled')
            expect(entry.throttledCount).toBe(2)
        })

        it('surfaces throttled and near-limit identifiers in the attention block', () => {
            seed('ip', '10.0.2.1', 3)
            seed('ip', '10.0.2.2', 85)
            seed('apiKey', 'key-hot', 20, 4)

            const { summary, attention } = rateLimitMonitor.getRateLimitDashboard()

            expect(summary.throttled).toBe(1)
            expect(summary.nearLimit).toBe(1)
            expect(attention.throttled.map(e => e.identifier)).toEqual(['key-hot'])
            expect(attention.nearLimit.map(e => e.identifier)).toEqual(['10.0.2.2'])
        })

        it('orders entries most-at-risk first', () => {
            seed('ip', 'calm', 1)
            seed('ip', 'busy', 90)
            seed('ip', 'blocked', 10, 1)

            const { entries } = rateLimitMonitor.getRateLimitDashboard()

            expect(entries.map(e => e.identifier)).toEqual(['blocked', 'busy', 'calm'])
        })

        it('respects a custom near-limit ratio', () => {
            process.env.RATE_LIMIT_NEAR_LIMIT_RATIO = '0.5'
            seed('ip', '10.0.3.1', 55)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === '10.0.3.1')!

            expect(entry.status).toBe('near-limit')
        })
    })

    describe('filtering and pagination', () => {
        beforeEach(() => {
            for (let i = 1; i <= 30; i++) {
                seed('ip', `10.1.0.${i}`, i)
            }
            seed('apiKey', 'key-one', 90)
            seed('apiKey', 'key-two', 4, 1)
        })

        it('filters by identifier type', () => {
            const ips = rateLimitMonitor.getRateLimitDashboard({ type: 'ip', pageSize: 200 })
            const keys = rateLimitMonitor.getRateLimitDashboard({ type: 'apiKey', pageSize: 200 })

            expect(ips.entries.every(e => e.type === 'ip')).toBe(true)
            expect(ips.pagination.total).toBe(30)
            expect(keys.entries.map(e => e.identifier).sort()).toEqual(['key-one', 'key-two'])
        })

        it('filters by status', () => {
            const throttled = rateLimitMonitor.getRateLimitDashboard({ status: 'throttled' })
            const atRisk = rateLimitMonitor.getRateLimitDashboard({ status: 'at-risk' })

            expect(throttled.entries.map(e => e.identifier)).toEqual(['key-two'])
            expect(atRisk.entries.map(e => e.identifier).sort()).toEqual(['key-one', 'key-two'])
        })

        it('filters by identifier substring', () => {
            const res = rateLimitMonitor.getRateLimitDashboard({ search: 'key-' })

            expect(res.pagination.total).toBe(2)
            expect(res.entries.every(e => e.identifier.startsWith('key-'))).toBe(true)
        })

        it('pages through results without overlap or gaps', () => {
            const pageSize = 10
            const first = rateLimitMonitor.getRateLimitDashboard({ pageSize, page: 1 })
            const second = rateLimitMonitor.getRateLimitDashboard({ pageSize, page: 2 })
            const last = rateLimitMonitor.getRateLimitDashboard({ pageSize, page: 4 })

            expect(first.pagination).toMatchObject({ page: 1, pageSize: 10, total: 32, totalPages: 4, hasMore: true })
            expect(first.entries).toHaveLength(10)
            expect(second.entries).toHaveLength(10)
            expect(last.entries).toHaveLength(2)
            expect(last.pagination.hasMore).toBe(false)

            const ids = [...first.entries, ...second.entries].map(e => e.identifier)
            expect(new Set(ids).size).toBe(20)
        })

        it('clamps out-of-range paging inputs', () => {
            const res = rateLimitMonitor.getRateLimitDashboard({ page: 999, pageSize: 5 })

            expect(res.pagination.page).toBe(res.pagination.totalPages)
            expect(res.entries.length).toBeGreaterThan(0)
        })
    })

    describe('window handling', () => {
        it('drops identifiers whose window has elapsed', () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
            seed('ip', '10.0.9.1', 10)

            vi.setSystemTime(new Date('2026-01-01T00:20:00Z')) // > 15 min window

            const res = rateLimitMonitor.getRateLimitDashboard()
            expect(res.entries.find(e => e.identifier === '10.0.9.1')).toBeUndefined()
        })

        it('starts a fresh window instead of accumulating across windows', () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
            seed('ip', '10.0.9.2', 10)

            vi.setSystemTime(new Date('2026-01-01T00:20:00Z'))
            seed('ip', '10.0.9.2', 2)

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === '10.0.9.2')!

            expect(entry.consumed).toBe(2)
        })
    })

    describe('request integration', () => {
        it('records the IP of a monitored request', () => {
            rateLimitMonitor.recordRequest(makeReq({ ip: '203.0.113.7' }))

            const entry = rateLimitMonitor
                .getRateLimitDashboard()
                .entries.find(e => e.identifier === '203.0.113.7')!

            expect(entry).toMatchObject({ type: 'ip', consumed: 1, status: 'ok' })
        })

        it('records both the IP and API key when the request is API-key authenticated', () => {
            rateLimitMonitor.recordRequest(
                makeReq({
                    ip: '203.0.113.8',
                    apiKeyUser: { address: 'GABC', scope: 'read-only', keyId: 'key-xyz' },
                } as Partial<Request>),
            )

            const { entries } = rateLimitMonitor.getRateLimitDashboard()
            expect(entries.find(e => e.identifier === '203.0.113.8')?.type).toBe('ip')
            expect(entries.find(e => e.identifier === 'key-xyz')?.type).toBe('apiKey')
        })

        it('marks both identifiers throttled when a request is rejected', () => {
            rateLimitMonitor.recordThrottle(
                makeReq({
                    ip: '203.0.113.9',
                    apiKeyUser: { address: 'GABC', scope: 'read-write', keyId: 'key-429' },
                } as Partial<Request>),
                'global',
            )

            const { entries } = rateLimitMonitor.getRateLimitDashboard()
            expect(entries.find(e => e.identifier === '203.0.113.9')?.status).toBe('throttled')
            expect(entries.find(e => e.identifier === 'key-429')?.status).toBe('throttled')
        })

        it('keeps the no-argument recordRequest signature working', () => {
            const before = rateLimitMonitor.getMetrics().totalRequests
            rateLimitMonitor.recordRequest()

            expect(rateLimitMonitor.getMetrics().totalRequests).toBe(before + 1)
            expect(rateLimitMonitor.getRateLimitDashboard().summary.trackedIdentifiers).toBe(0)
        })
    })
})

// ── admin endpoint ─────────────────────────────────────────────────────────────

vi.mock('../middleware/auth.js', () => ({
    requireAdmin: (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../services/assetRegistryService.js', () => ({
    assetRegistryService: { list: vi.fn(() => []) },
}))

// Keeps the suite off the native sqlite binding — the dashboard route touches none of it.
vi.mock('../services/databaseService.js', () => ({
    databaseService: {
        recordAdminAuditEntry: vi.fn(),
        getAssetBySymbol: vi.fn(() => null),
    },
}))

vi.mock('../middleware/idempotency.js', () => ({
    idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}))

vi.mock('../queue/workers/priceHistoryWorker.js', () => ({
    schedulePriceHistoryBackfill: vi.fn(),
}))

describe('GET /admin/rate-limits/dashboard', () => {
    let app: express.Express

    beforeEach(async () => {
        process.env.RATE_LIMIT_MAX = '100'
        process.env.RATE_LIMIT_NEAR_LIMIT_RATIO = '0.8'
        rateLimitMonitor.resetConsumption()

        const { assetsRouter } = await import('../api/assets.routes.js')
        app = express()
        app.use(express.json())
        app.use('/api', assetsRouter)
    })

    afterEach(() => {
        rateLimitMonitor.resetConsumption()
        process.env = { ...ORIGINAL_ENV }
    })

    it('returns the combined IP + API key view', async () => {
        seed('ip', '198.51.100.1', 5)
        seed('apiKey', 'key-dash', 95)

        const res = await request(app).get('/api/admin/rate-limits/dashboard')

        expect(res.status).toBe(200)
        expect(res.body.success).toBe(true)
        expect(res.body.data.summary).toMatchObject({ trackedIPs: 1, trackedApiKeys: 1, nearLimit: 1 })
        expect(res.body.data.attention.nearLimit[0].identifier).toBe('key-dash')
        expect(res.body.data.entries).toHaveLength(2)
    })

    it('applies type, status and pagination query params', async () => {
        seed('ip', '198.51.100.2', 90)
        seed('ip', '198.51.100.3', 2)
        seed('apiKey', 'key-filtered', 8, 1)

        const typed = await request(app).get('/api/admin/rate-limits/dashboard?type=apiKey')
        expect(typed.body.data.entries.map((e: any) => e.identifier)).toEqual(['key-filtered'])

        const risky = await request(app).get('/api/admin/rate-limits/dashboard?status=at-risk')
        expect(risky.body.data.entries.map((e: any) => e.identifier).sort()).toEqual([
            '198.51.100.2',
            'key-filtered',
        ])

        const paged = await request(app).get('/api/admin/rate-limits/dashboard?page=2&pageSize=1')
        expect(paged.body.data.pagination).toMatchObject({ page: 2, pageSize: 1, total: 3, totalPages: 3 })
        expect(paged.body.data.entries).toHaveLength(1)
    })

    it('rejects an invalid type or status', async () => {
        const badType = await request(app).get('/api/admin/rate-limits/dashboard?type=user')
        const badStatus = await request(app).get('/api/admin/rate-limits/dashboard?status=angry')

        expect(badType.status).toBe(400)
        expect(badStatus.status).toBe(400)
    })
})
