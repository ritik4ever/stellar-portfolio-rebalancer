/**
 * Dead-letter listing: filtering, pagination and the shared replay helper (#1393).
 *
 * The list/single-replay/batch-replay flows themselves are covered by
 * webhookDeadLetterReplay.integration.test.ts; this suite covers the admin
 * listing view and the extracted replay POST that both replay paths now share.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { DeadLetterItem } from '../services/webhookDeadLetter.js'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../queue/connection.js', () => ({
    REDIS_URL: 'redis://localhost:6379',
    isRedisAvailable: async () => false,
}))

vi.mock('ioredis', () => ({ default: class { on() {} async quit() {} } }))

function item(overrides: Partial<DeadLetterItem> = {}): DeadLetterItem {
    return {
        id: 'dl-1',
        payload: { event: 'rebalance' },
        errorMessage: 'Webhook responded with status 500',
        attemptsExhausted: 3,
        timestamp: '2026-08-01T00:00:00Z',
        webhookUrl: 'https://hooks.example.com/a',
        userId: 'GUSER1',
        eventType: 'rebalance',
        ...overrides,
    }
}

describe('dead-letter listing (#1393)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('payload and failure reason', () => {
        it('keeps the failure reason and original payload on every entry', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const listing = queryDeadLetterItems([item()])

            expect(listing.items[0].errorMessage).toBe('Webhook responded with status 500')
            expect(listing.items[0].payload).toEqual({ event: 'rebalance' })
            expect(listing.items[0].attemptsExhausted).toBe(3)
        })
    })

    describe('filtering', () => {
        const all = [
            item({ id: 'a', userId: 'GUSER1', eventType: 'rebalance' }),
            item({ id: 'b', userId: 'GUSER2', eventType: 'rebalance' }),
            item({ id: 'c', userId: 'GUSER2', eventType: 'riskChange', webhookUrl: 'https://other.example.com/z' }),
        ]

        it('filters by user', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const listing = queryDeadLetterItems(all, { userId: 'GUSER2' })

            expect(listing.items.map(i => i.id)).toEqual(['b', 'c'])
            expect(listing.pagination.total).toBe(2)
        })

        it('filters by event type', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            expect(queryDeadLetterItems(all, { eventType: 'riskChange' }).items.map(i => i.id)).toEqual(['c'])
        })

        it('searches across id, user, url and error message', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            expect(queryDeadLetterItems(all, { search: 'other.example' }).items.map(i => i.id)).toEqual(['c'])
            expect(queryDeadLetterItems(all, { search: 'status 500' }).items).toHaveLength(3)
        })

        it('combines filters', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const listing = queryDeadLetterItems(all, { userId: 'GUSER2', eventType: 'rebalance' })

            expect(listing.items.map(i => i.id)).toEqual(['b'])
        })

        it('returns an empty listing when nothing matches', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const listing = queryDeadLetterItems(all, { userId: 'nobody' })

            expect(listing.items).toEqual([])
            expect(listing.pagination.totalPages).toBe(1)
            expect(listing.pagination.hasMore).toBe(false)
        })
    })

    describe('summary', () => {
        it('counts entries per event type and reports the time span', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const listing = queryDeadLetterItems([
                item({ id: 'a', eventType: 'rebalance', timestamp: '2026-08-01T00:00:00Z' }),
                item({ id: 'b', eventType: 'rebalance', timestamp: '2026-08-03T00:00:00Z' }),
                item({ id: 'c', eventType: 'riskChange', timestamp: '2026-08-02T00:00:00Z' }),
            ])

            expect(listing.summary.total).toBe(3)
            expect(listing.summary.byEventType).toEqual({ rebalance: 2, riskChange: 1 })
            expect(listing.summary.oldestTimestamp).toBe('2026-08-01T00:00:00Z')
            expect(listing.summary.newestTimestamp).toBe('2026-08-03T00:00:00Z')
        })
    })

    describe('pagination', () => {
        const many = Array.from({ length: 120 }, (_, i) => item({ id: `dl-${i}` }))

        it('applies a default page size', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const listing = queryDeadLetterItems(many)

            expect(listing.items).toHaveLength(50)
            expect(listing.pagination).toMatchObject({ page: 1, pageSize: 50, total: 120, totalPages: 3, hasMore: true })
        })

        it('pages without overlap or gaps', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            const first = queryDeadLetterItems(many, { page: 1, pageSize: 40 })
            const second = queryDeadLetterItems(many, { page: 2, pageSize: 40 })
            const third = queryDeadLetterItems(many, { page: 3, pageSize: 40 })

            const ids = [...first.items, ...second.items, ...third.items].map(i => i.id)
            expect(new Set(ids).size).toBe(120)
            expect(third.pagination.hasMore).toBe(false)
        })

        it('clamps out-of-range and oversized inputs', async () => {
            const { queryDeadLetterItems } = await import('../services/webhookDeadLetter.js')

            expect(queryDeadLetterItems(many, { page: 999, pageSize: 40 }).pagination.page).toBe(3)
            expect(queryDeadLetterItems(many, { pageSize: 100000 }).pagination.pageSize).toBe(500)
            expect(queryDeadLetterItems(many, { pageSize: 0 }).pagination.pageSize).toBe(1)
        })
    })

    describe('shared replay POST', () => {
        it('posts the original payload to the webhook url', async () => {
            const { postDeadLetterPayload } = await import('../services/webhookDeadLetter.js')
            const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
            vi.stubGlobal('fetch', fetchMock)

            await postDeadLetterPayload(item(), 1000)

            const [url, init] = fetchMock.mock.calls[0]
            expect(url).toBe('https://hooks.example.com/a')
            expect(init.method).toBe('POST')
            expect(JSON.parse(init.body)).toEqual({ event: 'rebalance' })
            expect(init.headers['X-Webhook-Event']).toBe('rebalance')
            expect(init.headers['X-Webhook-Replay']).toBe('true')

            vi.unstubAllGlobals()
        })

        it('throws on a non-2xx response so the caller can re-queue', async () => {
            const { postDeadLetterPayload } = await import('../services/webhookDeadLetter.js')
            vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }))

            await expect(postDeadLetterPayload(item(), 1000)).rejects.toThrow('502')

            vi.unstubAllGlobals()
        })
    })
})
