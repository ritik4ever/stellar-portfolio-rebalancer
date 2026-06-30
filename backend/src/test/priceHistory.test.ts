import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB layer
vi.mock('../db/priceHistoryDb.js', () => ({
    insertPriceSnapshot: vi.fn().mockResolvedValue(undefined),
    pruneOldPriceSnapshots: vi.fn().mockResolvedValue(7),
}))

// Mock the reflector (oracle) price feed
vi.mock('../services/reflector.js', () => ({
    ReflectorService: vi.fn().mockImplementation(function(this: any) {
        this.getCurrentPrices = vi.fn().mockResolvedValue({
            XLM: 0.12,
            BTC: 65000,
            ETH: 3200,
            USDC: 1.0,
        })
        return this
    }),
}))

import { snapshotPrices, pruneStaleSnapshots } from '../services/priceHistory.js'
import { insertPriceSnapshot, pruneOldPriceSnapshots } from '../db/priceHistoryDb.js'

describe('priceHistory service (#885)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('snapshotPrices inserts a snapshot for each tracked asset', async () => {
        await snapshotPrices()

        expect(insertPriceSnapshot).toHaveBeenCalledTimes(4)
        expect(insertPriceSnapshot).toHaveBeenCalledWith('XLM', 0.12)
        expect(insertPriceSnapshot).toHaveBeenCalledWith('BTC', 65000)
        expect(insertPriceSnapshot).toHaveBeenCalledWith('ETH', 3200)
        expect(insertPriceSnapshot).toHaveBeenCalledWith('USDC', 1.0)
    })

    it('snapshotPrices skips assets with missing prices', async () => {
        const { ReflectorService } = await import('../services/reflector.js')
        const mockInstance = (ReflectorService as ReturnType<typeof vi.fn>).mock.results[0].value
        mockInstance.getCurrentPrices.mockResolvedValueOnce({ XLM: 0.12 }) // only XLM

        await snapshotPrices()

        expect(insertPriceSnapshot).toHaveBeenCalledTimes(1)
        expect(insertPriceSnapshot).toHaveBeenCalledWith('XLM', 0.12)
    })

    it('snapshotPrices does not throw when price fetch fails', async () => {
        const { ReflectorService } = await import('../services/reflector.js')
        const mockInstance = (ReflectorService as ReturnType<typeof vi.fn>).mock.results[0].value
        mockInstance.getCurrentPrices.mockRejectedValueOnce(new Error('oracle down'))

        await expect(snapshotPrices()).resolves.not.toThrow()
        expect(insertPriceSnapshot).not.toHaveBeenCalled()
    })

    it('pruneStaleSnapshots calls pruneOldPriceSnapshots with 90 days', async () => {
        await pruneStaleSnapshots()
        expect(pruneOldPriceSnapshots).toHaveBeenCalledWith(90)
    })
})
