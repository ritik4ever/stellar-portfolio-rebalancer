/**
 * SPR-2026-173 — Preserve state consistency in webhook delivery retry.
 *
 * The dead-letter record, the delivery log rows and the request the endpoint
 * actually received must all tell the same story after a retry:
 *   * one stable idempotency id per delivery, reused on every attempt/replay,
 *   * a dead-letter entry only for outcomes that are known to have failed,
 *   * exactly one entry per delivery even when work is duplicated or a retry is
 *     interrupted, and the attempt count that was really used.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NotificationService, type NotificationPayload } from '../services/notificationService.js'
import * as notificationDb from '../db/notificationDb.js'
import {
    webhookDeadLetterQueue,
    postDeadLetterPayload,
    type DeadLetterItem,
} from '../services/webhookDeadLetter.js'
import { _resetDeliveriesForTest } from '../services/notificationDelivery.js'
import {
    deriveWebhookDeliveryId,
    isAmbiguousWebhookFailure,
} from '../services/webhookDeliverySafety.js'
import type { NotificationDeliveryConfig } from '../config/notificationDeliveryConfig.js'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../queue/connection.js', () => ({
    REDIS_URL: 'redis://localhost:6379',
    isRedisAvailable: vi.fn(async () => false),
}))

vi.mock('nodemailer', () => ({
    default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}))

const userId = 'G_WEBHOOK_STATE_USER'
const webhookUrl = 'https://hooks.example.com/notify'

const payload: NotificationPayload = {
    userId,
    eventType: 'rebalance',
    title: 'Rebalance Complete',
    message: 'Portfolio rebalanced successfully.',
    timestamp: '2026-10-22T00:00:00.000Z',
}

function deliveryConfig(maxAttempts: number): NotificationDeliveryConfig {
    return {
        email: { maxAttempts: 1, initialBackoffMs: 1, maxBackoffMs: 5, backoffMultiplier: 1 },
        webhook: {
            maxAttempts,
            initialBackoffMs: 5,
            maxBackoffMs: 10,
            backoffMultiplier: 1,
            requestTimeoutMs: 1000,
        },
    }
}

function makeItem(overrides: Partial<DeadLetterItem> = {}): DeadLetterItem {
    return {
        id: `dl-${Math.random().toString(36).slice(2)}`,
        payload: { event: 'rebalance' },
        errorMessage: 'Webhook responded with status 500',
        attemptsExhausted: 2,
        timestamp: new Date().toISOString(),
        webhookUrl,
        userId,
        eventType: 'rebalance',
        ...overrides,
    }
}

describe('SPR-2026-173: webhook delivery retry state consistency', () => {
    let getPrefsSpy: ReturnType<typeof vi.spyOn>
    let logOutcomeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        _resetDeliveriesForTest()
        webhookDeadLetterQueue._resetForTest()

        getPrefsSpy = vi.spyOn(notificationDb, 'dbGetNotificationPreferences').mockReturnValue({
            userId,
            emailEnabled: false,
            webhookEnabled: true,
            webhookUrl,
            events: { rebalance: true, circuitBreaker: true, priceMovement: true, riskChange: true },
        } as never)
        logOutcomeSpy = vi.spyOn(notificationDb, 'dbLogNotificationOutcome').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
        webhookDeadLetterQueue._resetForTest()
        _resetDeliveriesForTest()
    })

    describe('stable delivery identity', () => {
        it('derives one id per notification and separates different events', () => {
            const first = deriveWebhookDeliveryId(payload)
            const again = deriveWebhookDeliveryId({ ...payload })
            const later = deriveWebhookDeliveryId({
                ...payload,
                timestamp: '2026-10-22T00:05:00.000Z',
            })

            expect(first).toBe(again)
            expect(first).toMatch(/^whk_[0-9a-f]{32}$/)
            expect(later).not.toBe(first)
        })

        it('reuses the same X-Webhook-Delivery-Id on every retry attempt', async () => {
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce({ ok: false, status: 503 })
                .mockResolvedValueOnce({ ok: true, status: 200 })
            vi.stubGlobal('fetch', fetchMock)

            const service = new NotificationService(deliveryConfig(3))
            await service.notify({ ...payload })

            expect(fetchMock).toHaveBeenCalledTimes(2)
            const ids = fetchMock.mock.calls.map(([, init]) => init.headers['X-Webhook-Delivery-Id'])
            expect(new Set(ids).size).toBe(1)
            expect(ids[0]).toBe(deriveWebhookDeliveryId(payload))
            expect(await webhookDeadLetterQueue.list()).toEqual([])
        })

        it('uses the caller deliveryId as the idempotency id when one is supplied', async () => {
            const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
            vi.stubGlobal('fetch', fetchMock)

            const service = new NotificationService(deliveryConfig(1))
            await service.notify({ ...payload, deliveryId: 'manual-rebalance-p1-1' })

            expect(fetchMock.mock.calls[0][1].headers['X-Webhook-Delivery-Id'])
                .toBe('manual-rebalance-p1-1')
        })
    })


    describe('dead-letter record agrees with the delivery outcome', () => {
        it('dead-letters a definitive failure with its delivery id and real attempt count', async () => {
            const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
            vi.stubGlobal('fetch', fetchMock)

            const service = new NotificationService(deliveryConfig(3))
            await service.notify({ ...payload })

            const entries = await webhookDeadLetterQueue.list()
            expect(fetchMock).toHaveBeenCalledTimes(3)
            expect(entries).toHaveLength(1)
            expect(entries[0]).toMatchObject({
                userId,
                eventType: 'rebalance',
                webhookUrl,
                attemptsExhausted: 3,
                stoppedEarly: false,
                deliveryId: deriveWebhookDeliveryId(payload),
            })
            expect(entries[0].errorMessage).toContain('500')
            expect(logOutcomeSpy).toHaveBeenCalledWith(
                userId,
                'webhook',
                'rebalance',
                'failed',
                expect.stringContaining('500'),
                expect.objectContaining({ attempt: 3 }),
            )
        })

        it('never queues an unknown outcome for replay', async () => {
            const abortError = Object.assign(new Error('This operation was aborted'), {
                name: 'AbortError',
            })
            const fetchMock = vi.fn().mockRejectedValue(abortError)
            vi.stubGlobal('fetch', fetchMock)

            const service = new NotificationService(deliveryConfig(3))
            await service.notify({ ...payload })

            // A timeout after dispatch is not retried and must not become a
            // replayable record: the endpoint may already have processed it.
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(await webhookDeadLetterQueue.list()).toEqual([])
            expect(logOutcomeSpy).toHaveBeenCalledWith(
                userId,
                'webhook',
                'rebalance',
                'uncertain',
                expect.stringContaining('aborted'),
                expect.objectContaining({ stoppedEarly: true }),
            )
        })

        it('records a single entry when the same delivery is triggered twice', async () => {
            const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })

            vi.stubGlobal('fetch', fetchMock)

            const service = new NotificationService(deliveryConfig(1))
            const event = { ...payload, deliveryId: 'rebalance-job-42' }

            await Promise.all([service.notify({ ...event }), service.notify({ ...event })])

            const entries = await webhookDeadLetterQueue.list()
            expect(entries).toHaveLength(1)
            expect(entries[0].deliveryId).toBe('rebalance-job-42')
        })
        it('records an interrupted delivery without pretending it was attempted', async () => {
            const fetchMock = vi.fn()
            vi.stubGlobal('fetch', fetchMock)

            const controller = new AbortController()
            controller.abort(new Error('worker shutting down'))

            const service = new NotificationService(deliveryConfig(3))
            await service.notify({ ...payload, signal: controller.signal })

            expect(fetchMock).not.toHaveBeenCalled()

            const entries = await webhookDeadLetterQueue.list()
            expect(entries).toHaveLength(1)
            expect(entries[0]).toMatchObject({
                attemptsExhausted: 0,
                stoppedEarly: true,
                deliveryId: deriveWebhookDeliveryId(payload),
            })
            // The delivery layer records the interrupted attempt itself; the
            // dead-letter entry must agree with it instead of claiming the full
            // retry budget was spent.
            expect(logOutcomeSpy).toHaveBeenCalledWith(
                userId,
                'webhook',
                'rebalance',
                'failed',
                expect.stringContaining('aborted'),
                expect.objectContaining({ attempt: 1 }),
            )
        })
    })


    describe('queue deduplication and replay bookkeeping', () => {
        it('keeps at most one entry per delivery id and frees the slot on delete', async () => {
            const first = makeItem({ id: 'dl-a', deliveryId: 'whk_duplicate' })
            const duplicate = makeItem({ id: 'dl-b', deliveryId: 'whk_duplicate' })

            expect(await webhookDeadLetterQueue.push(first)).toBe(true)
            expect(await webhookDeadLetterQueue.push(duplicate)).toBe(false)
            expect(await webhookDeadLetterQueue.list()).toHaveLength(1)

            expect(await webhookDeadLetterQueue.delete('dl-a')).toBe(true)

            // The delivery may legitimately fail again after an operator removed
            // the entry, so the slot must be free again.
            expect(await webhookDeadLetterQueue.push(duplicate)).toBe(true)
            expect(await webhookDeadLetterQueue.list()).toHaveLength(1)
        })

        it('re-queues a failed replay without duplicating it', async () => {
            await webhookDeadLetterQueue.push(makeItem({ id: 'dl-r', deliveryId: 'whk_replay', attemptsExhausted: 2 }))

            const claimed = await webhookDeadLetterQueue.replay('dl-r')
            expect(claimed?.id).toBe('dl-r')
            expect(await webhookDeadLetterQueue.list()).toEqual([])

            await webhookDeadLetterQueue.requeue(claimed!)
            // A duplicate push for the same delivery is still refused after requeue.
            await webhookDeadLetterQueue.push(makeItem({ id: 'dl-r2', deliveryId: 'whk_replay' }))

            const entries = await webhookDeadLetterQueue.list()
            expect(entries).toHaveLength(1)
            expect(entries[0].id).toBe('dl-r')
            expect(entries[0].attemptsExhausted).toBe(3)
        })

        it('replaces an existing entry for the delivery when re-queueing', async () => {
            const item = makeItem({ id: 'dl-replace', deliveryId: 'whk_replace', attemptsExhausted: 2 })
            await webhookDeadLetterQueue.push(item)

            // Even if a caller re-queues without replaying first, the queue must
            // never hold two replayable copies of one delivery.
            await webhookDeadLetterQueue.requeue(item)

            const entries = await webhookDeadLetterQueue.list()
            expect(entries).toHaveLength(1)
            expect(entries[0].attemptsExhausted).toBe(3)
        })

        it('replays with the original delivery id so the receiver can deduplicate', async () => {
            const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
            vi.stubGlobal('fetch', fetchMock)

            await postDeadLetterPayload(makeItem({ deliveryId: 'whk_replayed' }), 500)

            const [url, init] = fetchMock.mock.calls[0]
            expect(url).toBe(webhookUrl)
            expect(init.headers['X-Webhook-Delivery-Id']).toBe('whk_replayed')
            expect(init.headers['X-Webhook-Replay']).toBe('true')
        })
    })

    describe('failure classification', () => {
        it('treats timeouts and dropped sockets after dispatch as unknown', () => {
            expect(isAmbiguousWebhookFailure(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true)
            expect(isAmbiguousWebhookFailure(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true)
            expect(isAmbiguousWebhookFailure(
                Object.assign(new TypeError('fetch failed'), {
                    cause: Object.assign(new Error('socket'), { code: 'UND_ERR_SOCKET' }),
                }),
            )).toBe(true)
        })

        it('keeps unreachable endpoints and explicit rejections replayable', () => {
            expect(isAmbiguousWebhookFailure(new Error('Webhook responded with status 500'))).toBe(false)
            expect(isAmbiguousWebhookFailure(
                Object.assign(new TypeError('fetch failed'), {
                    cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
                }),
            )).toBe(false)
            expect(isAmbiguousWebhookFailure(undefined)).toBe(false)
        })
    })
    })
