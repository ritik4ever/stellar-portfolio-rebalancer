import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { Express } from 'express'
import request from 'supertest'

vi.mock('../queue/connection.js', () => ({
    REDIS_URL: 'redis://localhost:6379',
    isRedisAvailable: vi.fn().mockResolvedValue(false),
}))

vi.mock('../middleware/auth.js', () => ({
    requireAdmin: (req: any, res: any, next: () => void) => next(),
}))

vi.mock('../middleware/requireJwt.js', () => ({
    requireJwtWhenEnabled: (req: any, res: any, next: () => void) => next(),
}))

vi.mock('../middleware/idempotency.js', () => ({
    idempotencyMiddleware: (req: any, res: any, next: () => void) => next(),
}))

vi.mock('../services/authService.js', () => ({
    getAuthConfig: vi.fn(() => ({ enabled: false })),
}))

vi.mock('../services/notificationService.js', () => ({
    NotificationService: vi.fn(),
    notificationService: {
        subscribe: vi.fn(),
        isEmailTransportAvailable: vi.fn(() => false),
    },
}))

vi.mock('../services/notificationDelivery.js', () => ({
    deliverWithBackoff: vi.fn(),
}))

vi.mock('../config/notificationDeliveryConfig.js', () => ({
    getNotificationDeliveryConfig: vi.fn(() => ({
        webhook: {
            maxAttempts: 5,
            requestTimeoutMs: 5000,
        },
    })),
}))

import { webhookDeadLetterQueue } from '../services/webhookDeadLetter.js'
import { deliverWithBackoff } from '../services/notificationDelivery.js'
import { notificationsRouter } from '../api/notifications.routes.js'

const deliverMock = deliverWithBackoff as unknown as ReturnType<typeof vi.fn>

let app: Express

function makeItem(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: `item-${Math.random().toString(36).slice(2)}`,
        payload: { event: 'rebalance.completed' },
        errorMessage: 'Webhook responded with status 500',
        attemptsExhausted: 3,
        timestamp: new Date().toISOString(),
        webhookUrl: 'https://example.invalid/hook',
        userId: 'user-1',
        eventType: 'rebalance.completed',
        ...overrides,
    }
}

beforeAll(async () => {
    const express = (await import('express')).default
    app = express()
    app.use(express.json())
    app.use('/api/v1', notificationsRouter)
})

afterAll(async () => {
    webhookDeadLetterQueue._resetForTest()
})

beforeEach(async () => {
    deliverMock.mockReset()
    deliverMock.mockImplementation(async () => {})
    webhookDeadLetterQueue._resetForTest()
})

describe('admin webhook dead-letter replay (integration)', () => {
    it('replays a single dead-letter item successfully and removes it', async () => {
        const item = makeItem()
        await webhookDeadLetterQueue.push(item)

        const res = await request(app)
            .post(`/api/v1/admin/notifications/dead-letter/${item.id}/replay`)
            .expect(200)

        expect(res.body.success).toBe(true)

        const remaining = await webhookDeadLetterQueue.list()
        expect(remaining).toEqual([])
        expect(deliverMock).toHaveBeenCalledTimes(1)
    })

    it('re-queues the item with incremented attempts when single replay fails', async () => {
        const item = makeItem({ attemptsExhausted: 2 })
        await webhookDeadLetterQueue.push(item)
        deliverMock.mockImplementation(async () => {
            throw new Error('Webhook responded with status 500')
        })

        const res = await request(app)
            .post(`/api/v1/admin/notifications/dead-letter/${item.id}/replay`)
            .expect(502)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('REPLAY_FAILED')

        const remaining = await webhookDeadLetterQueue.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0].attemptsExhausted).toBe(3)
        expect(remaining[0].payload).toEqual(item.payload)
    })

    it('returns 404 when the dead-letter item does not exist', async () => {
        const res = await request(app)
            .post('/api/v1/admin/notifications/dead-letter/missing-id/replay')
            .expect(404)

        expect(res.body.success).toBe(false)
        expect(res.body.error.code).toBe('NOT_FOUND')
    })

    it('batch-replays selected ids and removes successful items', async () => {
        const itemA = makeItem()
        const itemB = makeItem()
        await webhookDeadLetterQueue.push(itemA)
        await webhookDeadLetterQueue.push(itemB)

        const res = await request(app)
            .post('/api/v1/admin/notifications/dead-letter/batch-replay')
            .send({ ids: [itemA.id] })
            .expect(200)

        expect(res.body.data.results.succeeded).toBe(1)
        expect(res.body.data.results.failed).toBe(0)

        const remaining = await webhookDeadLetterQueue.list()
        const remainingIds = remaining.map((r) => r.id)
        expect(remainingIds).toEqual([itemB.id])
    })

    it('batch-replays all items when replayAll is set', async () => {
        const itemA = makeItem()
        const itemB = makeItem()
        await webhookDeadLetterQueue.push(itemA)
        await webhookDeadLetterQueue.push(itemB)

        const res = await request(app)
            .post('/api/v1/admin/notifications/dead-letter/batch-replay')
            .send({ replayAll: true })
            .expect(200)

        expect(res.body.data.results.succeeded).toBe(2)
        const remaining = await webhookDeadLetterQueue.list()
        expect(remaining).toEqual([])
    })

    it('re-queues failed items with incremented attempts during batch replay', async () => {
        const badItem = makeItem({ id: 'bad-item', attemptsExhausted: 1 })
        await webhookDeadLetterQueue.push(badItem)
        deliverMock.mockImplementation(async () => {
            throw new Error('Webhook responded with status 500')
        })

        const res = await request(app)
            .post('/api/v1/admin/notifications/dead-letter/batch-replay')
            .send({ ids: ['bad-item'] })
            .expect(200)

        expect(res.body.data.results.succeeded).toBe(0)
        expect(res.body.data.results.failed).toBe(1)
        expect(res.body.data.results.failedIds).toEqual(['bad-item'])

        const remaining = await webhookDeadLetterQueue.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0].id).toBe('bad-item')
        expect(remaining[0].attemptsExhausted).toBe(2)
    })
})