import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../db/priceHistoryDb.js', () => ({
    insertPriceSnapshot: vi.fn(),
    insertPriceSnapshotsAt: vi.fn(),
    pruneOldPriceSnapshots: vi.fn(),
}))

vi.mock('../services/reflector.js', () => ({
    ReflectorService: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.getCurrentPrices = vi.fn()
        this.getPriceHistory = vi.fn()
        return this
    }),
}))

import { backfillPriceHistory } from '../services/priceHistory.js'
import { insertPriceSnapshotsAt } from '../db/priceHistoryDb.js'
import { ReflectorService } from '../services/reflector.js'
import {
    parsePriceHistoryConfig,
    PRICE_HISTORY_BACKFILL_DEFAULT_DAYS,
} from '../config/priceHistoryConfig.js'

const mockReflectorInstance = (
    ReflectorService as unknown as ReturnType<typeof vi.fn>
).mock.results[0].value as {
    getPriceHistory: ReturnType<typeof vi.fn>
    getCurrentPrices: ReturnType<typeof vi.fn>
}

const insertMock = insertPriceSnapshotsAt as unknown as ReturnType<typeof vi.fn>

describe('backfillPriceHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env.PRICE_HISTORY_BACKFILL_DAYS
        mockReflectorInstance.getPriceHistory.mockResolvedValue([
            { timestamp: 1710000000, price: 0.12 },
            { timestamp: 1710003600, price: 0.13 },
        ])
        insertMock.mockResolvedValue(2)
    })

    afterEach(() => {
        delete process.env.PRICE_HISTORY_BACKFILL_DAYS
    })

    it('backfills fetched points for the asset using the default window', async () => {
        const result = await backfillPriceHistory('XLM')

        expect(mockReflectorInstance.getPriceHistory).toHaveBeenCalledWith(
            'XLM',
            PRICE_HISTORY_BACKFILL_DEFAULT_DAYS,
        )
        expect(insertMock).toHaveBeenCalledWith('XLM', [
            { timestamp: 1710000000, price: 0.12 },
            { timestamp: 1710003600, price: 0.13 },
        ])
        expect(result).toEqual({
            asset: 'XLM',
            backfilled: 2,
            days: PRICE_HISTORY_BACKFILL_DEFAULT_DAYS,
        })
    })

    it('uses the configured window when days is not passed', async () => {
        process.env.PRICE_HISTORY_BACKFILL_DAYS = '30'

        await backfillPriceHistory('BTC')

        expect(mockReflectorInstance.getPriceHistory).toHaveBeenCalledWith('BTC', 30)
        expect(insertMock).toHaveBeenCalled()
    })

    it('clamps an over-large window to the configured maximum', async () => {
        await backfillPriceHistory('ETH', 5000)

        expect(mockReflectorInstance.getPriceHistory).toHaveBeenCalledWith('ETH', 365)
    })

    it('clamps a too-small window to the configured minimum', async () => {
        await backfillPriceHistory('ETH', 0)

        expect(mockReflectorInstance.getPriceHistory).toHaveBeenCalledWith('ETH', 1)
    })

    it('returns zero without inserting when the oracle fails', async () => {
        mockReflectorInstance.getPriceHistory.mockRejectedValue(new Error('CoinGecko down'))

        const result = await backfillPriceHistory('XLM')

        expect(result).toEqual({
            asset: 'XLM',
            backfilled: 0,
            days: PRICE_HISTORY_BACKFILL_DEFAULT_DAYS,
        })
        expect(insertMock).not.toHaveBeenCalled()
    })

    it('returns zero without inserting when the oracle returns no points', async () => {
        mockReflectorInstance.getPriceHistory.mockResolvedValue([])

        const result = await backfillPriceHistory('XLM')

        expect(result.backfilled).toBe(0)
        expect(insertMock).not.toHaveBeenCalled()
    })
})

describe('parsePriceHistoryConfig', () => {
    it('defaults to 90 days when unset', () => {
        const { config, errors } = parsePriceHistoryConfig({})
        expect(config.backfillDays).toBe(PRICE_HISTORY_BACKFILL_DEFAULT_DAYS)
        expect(errors).toEqual([])
    })

    it('accepts a valid value within range', () => {
        const { config, errors } = parsePriceHistoryConfig({ PRICE_HISTORY_BACKFILL_DAYS: '120' })
        expect(config.backfillDays).toBe(120)
        expect(errors).toEqual([])
    })

    it('falls back to default and reports an error for a non-numeric value', () => {
        const { config, errors } = parsePriceHistoryConfig({ PRICE_HISTORY_BACKFILL_DAYS: 'abc' })
        expect(config.backfillDays).toBe(PRICE_HISTORY_BACKFILL_DEFAULT_DAYS)
        expect(errors.length).toBeGreaterThan(0)
    })

    it('falls back to default and reports an error for an out-of-range value', () => {
        const { config, errors } = parsePriceHistoryConfig({ PRICE_HISTORY_BACKFILL_DAYS: '10000' })
        expect(config.backfillDays).toBe(PRICE_HISTORY_BACKFILL_DEFAULT_DAYS)
        expect(errors.length).toBeGreaterThan(0)
    })
})