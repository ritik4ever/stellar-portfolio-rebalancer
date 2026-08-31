/**
 * Per-channel delivery success/failure metrics (#1394).
 *
 * Asserts the Prometheus counters move correctly for simulated successes and
 * failures, that the failure reason label is a bounded classification rather
 * than a raw error string, and that the counters reach the metrics endpoint.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../utils/logger.js', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logAudit: vi.fn(),
}))

vi.mock('../db/notificationDb.js', () => ({
    dbLogNotificationOutcome: vi.fn(),
}))

const M = 'stellar_portfolio_notification_delivery_total'
const M_ATTEMPTS = 'stellar_portfolio_notification_delivery_attempts_total'

const FAST_POLICY = {
    maxAttempts: 3,
    initialBackoffMs: 1,
    maxBackoffMs: 2,
    multiplier: 2,
    jitterRatio: 0,
    requestTimeoutMs: 1000,
}

/** Read one counter's value out of the Prometheus text exposition. */
async function counterValue(metric: string, labels: Record<string, string>): Promise<number> {
    const { getMetricsPayload } = await import('../observability/metrics.js')
    const payload = await getMetricsPayload()

    const wanted = Object.entries(labels).map(([k, v]) => `${k}="${v}"`)

    for (const line of payload.split('\n')) {
        if (line.startsWith('#') || !line.startsWith(metric)) continue
        const match = line.match(/^[^{]+\{([^}]*)\}\s+(\S+)$/)
        if (!match) continue
        const present = match[1].split(',').map(s => s.trim())
        if (wanted.every(w => present.includes(w))) return Number(match[2])
    }
    return 0
}

describe('notification delivery metrics (#1394)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('success path', () => {
        it('increments the success counter for the delivering channel', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M, { channel: 'email', outcome: 'success' })

            await deliverWithBackoff(
                { provider: 'email', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                async () => undefined,
            )

            expect(await counterValue(M, { channel: 'email', outcome: 'success' })).toBe(before + 1)
        })

        it('does not increment the failure counter on success', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M, { channel: 'webhook', outcome: 'failure' })

            await deliverWithBackoff(
                { provider: 'webhook', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                async () => undefined,
            )

            expect(await counterValue(M, { channel: 'webhook', outcome: 'failure' })).toBe(before)
        })

        it('keeps channels separate', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const emailBefore = await counterValue(M, { channel: 'email', outcome: 'success' })

            await deliverWithBackoff(
                { provider: 'webhook', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                async () => undefined,
            )

            expect(await counterValue(M, { channel: 'email', outcome: 'success' })).toBe(emailBefore)
        })

        it('records the delivery duration', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const { getMetricsPayload } = await import('../observability/metrics.js')

            await deliverWithBackoff(
                { provider: 'email', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                async () => undefined,
            )

            const payload = await getMetricsPayload()
            expect(payload).toMatch(
                /stellar_portfolio_notification_delivery_duration_seconds_count\{[^}]*channel="email"/,
            )
        })
    })

    describe('failure path', () => {
        it('increments the failure counter once retries are exhausted', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M, { channel: 'webhook', outcome: 'failure' })

            await expect(
                deliverWithBackoff(
                    { provider: 'webhook', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                    async () => { throw new Error('ECONNREFUSED connect') },
                ),
            ).rejects.toThrow()

            expect(await counterValue(M, { channel: 'webhook', outcome: 'failure' })).toBe(before + 1)
        })

        it('counts a single terminal failure, not one per attempt', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M, { channel: 'email', outcome: 'failure' })

            await expect(
                deliverWithBackoff(
                    { provider: 'email', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                    async () => { throw new Error('boom') },
                ),
            ).rejects.toThrow()

            expect(await counterValue(M, { channel: 'email', outcome: 'failure' })).toBe(before + 1)
        })

        it('counts every retry as an attempt', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M_ATTEMPTS, { channel: 'webhook', outcome: 'retried' })

            await expect(
                deliverWithBackoff(
                    { provider: 'webhook', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                    async () => { throw new Error('boom') },
                ),
            ).rejects.toThrow()

            // maxAttempts 3 → two retries before the terminal failure.
            expect(await counterValue(M_ATTEMPTS, { channel: 'webhook', outcome: 'retried' })).toBe(before + 2)
        })

        it('labels the failure with a classified reason', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M, {
                channel: 'webhook',
                outcome: 'failure',
                reason: 'timeout',
            })

            await expect(
                deliverWithBackoff(
                    { provider: 'webhook', userId: 'GUSER', eventType: 'riskChange', policy: FAST_POLICY },
                    async () => { throw new Error('Request timed out after 5000ms') },
                ),
            ).rejects.toThrow()

            expect(
                await counterValue(M, { channel: 'webhook', outcome: 'failure', reason: 'timeout' }),
            ).toBe(before + 1)
        })

        it('recovers on a later attempt without recording a failure', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const failBefore = await counterValue(M, { channel: 'email', outcome: 'failure' })
            const okBefore = await counterValue(M, { channel: 'email', outcome: 'success' })

            let calls = 0
            await deliverWithBackoff(
                { provider: 'email', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                async () => {
                    calls++
                    if (calls === 1) throw new Error('transient')
                },
            )

            expect(calls).toBe(2)
            expect(await counterValue(M, { channel: 'email', outcome: 'success' })).toBe(okBefore + 1)
            expect(await counterValue(M, { channel: 'email', outcome: 'failure' })).toBe(failBefore)
        })
    })

    describe('failure classification', () => {
        it.each([
            [{ status: 401 }, 'auth'],
            [{ status: 429 }, 'rate_limited'],
            [{ status: 503 }, 'server_error'],
            [{ status: 422 }, 'client_error'],
            [{ code: 'ETIMEDOUT' }, 'timeout'],
            [{ code: 'ECONNREFUSED' }, 'connection_refused'],
            [{ code: 'ENOTFOUND' }, 'dns'],
            [new Error('Email transport is not configured'), 'not_configured'],
            [new Error('something entirely new'), 'unknown'],
        ])('classifies %j as %s', async (error, expected) => {
            const { classifyFailureReason } = await import('../services/notificationDelivery.js')
            expect(classifyFailureReason(error)).toBe(expected)
        })

        it('never leaks a raw error string into the label', async () => {
            const { classifyFailureReason } = await import('../services/notificationDelivery.js')

            // Raw messages are unbounded cardinality — the reason must stay inside
            // the small classified vocabulary.
            const reason = classifyFailureReason(new Error('user 12345 rejected at 2026-08-29T10:00:00Z'))

            expect(reason).toBe('unknown')
            expect(reason).not.toContain('12345')
        })
    })

    describe('channels without the backoff wrapper', () => {
        it.each(['slack', 'sms', 'telegram'] as const)(
            'records a success for %s',
            async (channel) => {
                const { recordChannelDelivery } = await import('../services/notificationDelivery.js')
                const before = await counterValue(M, { channel, outcome: 'success' })

                recordChannelDelivery({ channel, success: true, eventType: 'rebalance' })

                expect(await counterValue(M, { channel, outcome: 'success' })).toBe(before + 1)
            },
        )

        it('records a classified failure for a non-backoff channel', async () => {
            const { recordChannelDelivery } = await import('../services/notificationDelivery.js')
            const before = await counterValue(M, {
                channel: 'slack',
                outcome: 'failure',
                reason: 'rate_limited',
            })

            recordChannelDelivery({
                channel: 'slack',
                success: false,
                error: { status: 429 },
                eventType: 'priceMovement',
            })

            expect(
                await counterValue(M, { channel: 'slack', outcome: 'failure', reason: 'rate_limited' }),
            ).toBe(before + 1)
        })
    })

    describe('Prometheus exposition', () => {
        it('exposes the delivery metrics with help and type metadata', async () => {
            const { deliverWithBackoff } = await import('../services/notificationDelivery.js')
            const { getMetricsPayload } = await import('../observability/metrics.js')

            await deliverWithBackoff(
                { provider: 'email', userId: 'GUSER', eventType: 'rebalance', policy: FAST_POLICY },
                async () => undefined,
            )

            const payload = await getMetricsPayload()

            expect(payload).toContain(`# HELP ${M}`)
            expect(payload).toContain(`# TYPE ${M} counter`)
            expect(payload).toContain(M_ATTEMPTS)
            expect(payload).toContain('stellar_portfolio_notification_delivery_duration_seconds')
            expect(payload).toMatch(new RegExp(`${M}\\{[^}]*channel="email"`))
        })
    })
})
