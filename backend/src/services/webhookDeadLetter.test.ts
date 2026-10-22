import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
    webhookDeadLetterQueue,
    replayWebhookItem,
    replayAllWebhooks,
    type DeadLetterItem,
} from './webhookDeadLetter.js'

describe('webhookDeadLetterQueue', () => {
    beforeEach(() => {
        webhookDeadLetterQueue._resetForTest()
        vi.restoreAllMocks()
    })

    afterEach(async () => {
        await webhookDeadLetterQueue.deinit()
    })

    it('creates and pushes a dead-letter entry on delivery failure', async () => {
        const item: DeadLetterItem = {
            id: 'item-123',
            payload: { event: 'rebalance.completed', portfolioId: 'port-1' },
            errorMessage: 'HTTP 500 Internal Server Error',
            attemptsExhausted: 3,
            timestamp: new Date().toISOString(),
            webhookUrl: 'https://example.com/webhook',
            userId: 'user-456',
            eventType: 'rebalance.completed',
        }

        await webhookDeadLetterQueue.push(item)
        const list = await webhookDeadLetterQueue.list()

        expect(list).toHaveLength(1)
        expect(list[0].id).toBe('item-123')
        expect(list[0].attemptsExhausted).toBe(3)
        expect(list[0].webhookUrl).toBe('https://example.com/webhook')
    })

    it('successfully replays an item, makes mock outbound HTTP request, and removes entry from queue', async () => {
        const item: DeadLetterItem = {
            id: 'item-success',
            payload: { test: 'payload' },
            errorMessage: 'Timeout',
            attemptsExhausted: 3,
            timestamp: new Date().toISOString(),
            webhookUrl: 'https://api.example.com/webhook',
            userId: 'user-1',
            eventType: 'trade.executed',
        }

        await webhookDeadLetterQueue.push(item)

        // Mock global fetch to return 200 OK
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            text: async () => 'OK',
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await replayWebhookItem('item-success')
        expect(result.success).toBe(true)
        expect(result.statusCode).toBe(200)

        // Verify item was removed from DLQ
        const list = await webhookDeadLetterQueue.list()
        expect(list).toHaveLength(0)
    })

    it('requeues entry with incremented attempts on failed replay', async () => {
        const item: DeadLetterItem = {
            id: 'item-fail',
            payload: { test: 'retry' },
            errorMessage: 'Network error',
            attemptsExhausted: 3,
            timestamp: new Date().toISOString(),
            webhookUrl: 'https://failing.example.com/webhook',
            userId: 'user-1',
            eventType: 'trade.executed',
        }

        await webhookDeadLetterQueue.push(item)

        // Mock global fetch to return 503 Service Unavailable
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 503,
            text: async () => 'Service Unavailable',
        })
        vi.stubGlobal('fetch', fetchMock)

        const result = await replayWebhookItem('item-fail')
        expect(result.success).toBe(false)
        expect(result.statusCode).toBe(503)

        // Item should be requeued with attempt count = 4
        const list = await webhookDeadLetterQueue.list()
        expect(list).toHaveLength(1)
        expect(list[0].id).toBe('item-fail')
        expect(list[0].attemptsExhausted).toBe(4)
    })
})
