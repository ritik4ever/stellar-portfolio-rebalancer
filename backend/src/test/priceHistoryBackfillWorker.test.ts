import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../services/priceHistory.js', () => ({
    backfillPriceHistory: vi.fn(),
}))

vi.mock('../connection.js', () => ({
    isRedisAvailable: vi.fn(),
    getConnectionOptions: vi.fn(() => ({ url: 'redis://localhost:6379' })),
}))

vi.mock('../queues.js', () => ({
    getPriceHistoryBackfillQueue: vi.fn(),
}))

import { Job } from 'bullmq'
import {
    processPriceHistoryBackfillJob,
    schedulePriceHistoryBackfill,
} from '../workers/priceHistoryWorker.js'
import { backfillPriceHistory } from '../../services/priceHistory.js'
import { isRedisAvailable } from '../connection.js'
import { getPriceHistoryBackfillQueue } from '../queues.js'

const backfillMock = backfillPriceHistory as unknown as ReturnType<typeof vi.fn>
const redisMock = isRedisAvailable as unknown as ReturnType<typeof vi.fn>
const queueGetterMock = getPriceHistoryBackfillQueue as unknown as ReturnType<typeof vi.fn>

describe('schedulePriceHistoryBackfill', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        redisMock.mockResolvedValue(true)
    })

    it('returns false without enqueuing when Redis is unavailable', async () => {
        redisMock.mockResolvedValue(false)

        const ok = await schedulePriceHistoryBackfill('XLM')

        expect(ok).toBe(false)
        expect(queueGetterMock).not.toHaveBeenCalled()
    })

    it('enqueues a backfill job when Redis and the queue are available', async () => {
        const add = vi.fn().mockResolvedValue(undefined)
        queueGetterMock.mockReturnValue({ add })

        const ok = await schedulePriceHistoryBackfill('XLM', 30)

        expect(ok).toBe(true)
        expect(queueGetterMock).toHaveBeenCalled()
        expect(add).toHaveBeenCalledWith(
            'backfill',
            { asset: 'XLM', days: 30, triggeredBy: 'asset_added' },
            expect.objectContaining({ attempts: 3 }),
        )
    })

    it('returns false when the queue getter returns null', async () => {
        queueGetterMock.mockReturnValue(null)

        const ok = await schedulePriceHistoryBackfill('XLM')

        expect(ok).toBe(false)
    })

    it('returns false when enqueue throws', async () => {
        redisMock.mockResolvedValue(true)
        queueGetterMock.mockReturnValue({
            add: vi.fn().mockRejectedValue(new Error('Redis OOM')),
        })

        const ok = await schedulePriceHistoryBackfill('XLM')

        expect(ok).toBe(false)
    })
})

describe('processPriceHistoryBackfillJob', () => {
    it('delegates to the backfill service with the job payload', async () => {
        backfillMock.mockResolvedValue({ asset: 'XLM', backfilled: 3, days: 90 })

        const job = { id: 'abc', data: { asset: 'XLM', days: 90 } } as unknown as Job<{
            asset: string
            days?: number
        }>

        const result = await processPriceHistoryBackfillJob(job)

        expect(backfillMock).toHaveBeenCalledWith('XLM', 90)
        expect(result).toEqual({ asset: 'XLM', backfilled: 3, days: 90 })
    })

    it('throws when the job has no asset', async () => {
        const job = { id: 'x', data: {} } as unknown as Job<{ asset: string }>

        await expect(processPriceHistoryBackfillJob(job)).rejects.toThrow(
            'asset is required',
        )
    })
})