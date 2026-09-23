import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { analyticsService } from '../services/analyticsService.js'
import { dbCompactAnalyticsSnapshots } from '../db/analyticsDb.js'

vi.mock('../db/analyticsDb', () => ({
    dbCompactAnalyticsSnapshots: vi.fn(),
}))

vi.mock('../services/portfolioStorage', () => ({
    portfolioStorage: {
        getAllPortfolios: vi.fn(),
        getPortfolio: vi.fn(),
    }
}))

describe('Analytics Compaction Service', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.clearAllMocks()
    })

    describe('compactAnalyticsForPortfolio', () => {
        it('should call dbCompactAnalyticsSnapshots with correct parameters', async () => {
            const portfolioId = 'test-portfolio'
            const cutoffDays = 90
            const recentDays = 7

            vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                portfolioId,
                deletedCount: 100,
                retainedCount: 50,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            const result = await analyticsService.compactAnalyticsForPortfolio(
                portfolioId,
                cutoffDays,
                recentDays
            )

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                portfolioId,
                cutoffDays,
                recentDays
            )
            expect(result.deletedCount).toBe(100)
            expect(result.retainedCount).toBe(50)
        })

        it('should use default parameters when not provided', async () => {
            const portfolioId = 'test-portfolio'

            vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                portfolioId,
                deletedCount: 50,
                retainedCount: 30,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            await analyticsService.compactAnalyticsForPortfolio(portfolioId)

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                portfolioId,
                90, // default cutoffDays
                7   // default recentDays
            )
        })

        it('should respect configured retention settings from environment when parameters are omitted', async () => {
            const originalCutoff = process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS
            const originalRecent = process.env.ANALYTICS_COMPACTION_RECENT_DAYS
            try {
                process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS = '30'
                process.env.ANALYTICS_COMPACTION_RECENT_DAYS = '3'

                const portfolioId = 'test-portfolio-configured'
                vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                    portfolioId,
                    deletedCount: 20,
                    retainedCount: 15,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })

                await analyticsService.compactAnalyticsForPortfolio(portfolioId)

                expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                    portfolioId,
                    30,
                    3
                )
            } finally {
                if (originalCutoff === undefined) {
                    delete process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS
                } else {
                    process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS = originalCutoff
                }
                if (originalRecent === undefined) {
                    delete process.env.ANALYTICS_COMPACTION_RECENT_DAYS
                } else {
                    process.env.ANALYTICS_COMPACTION_RECENT_DAYS = originalRecent
                }
            }
        })

        it('should verify boundary behavior for short retention settings (30 days cutoff, 3 days recent)', async () => {
            const portfolioId = 'short-retention-portfolio'
            vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                portfolioId,
                deletedCount: 500,
                retainedCount: 72,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            const result = await analyticsService.compactAnalyticsForPortfolio(portfolioId, 30, 3)

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                portfolioId,
                30,
                3
            )
            expect(result.deletedCount).toBe(500)
            expect(result.retainedCount).toBe(72)
        })

        it('should verify boundary behavior for long retention settings (180 days cutoff, 14 days recent)', async () => {
            const portfolioId = 'long-retention-portfolio'
            vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                portfolioId,
                deletedCount: 120,
                retainedCount: 336,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            const result = await analyticsService.compactAnalyticsForPortfolio(portfolioId, 180, 14)

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                portfolioId,
                180,
                14
            )
            expect(result.deletedCount).toBe(120)
            expect(result.retainedCount).toBe(336)
        })

        it('should allow equal cutoffDays and recentDays (exact boundary)', async () => {
            const portfolioId = 'boundary-retention-portfolio'
            vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                portfolioId,
                deletedCount: 10,
                retainedCount: 20,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            await analyticsService.compactAnalyticsForPortfolio(portfolioId, 14, 14)

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                portfolioId,
                14,
                14
            )
        })

        it('should reject when cutoffDays < recentDays', async () => {
            const portfolioId = 'test-portfolio'

            await expect(
                analyticsService.compactAnalyticsForPortfolio(
                    portfolioId,
                    7,  // cutoffDays
                    90  // recentDays > cutoffDays
                )
            ).rejects.toThrow('cutoffDays (7) must be >= recentDays (90)')

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).not.toHaveBeenCalled()
        })

        it('should handle database errors gracefully', async () => {
            const portfolioId = 'test-portfolio'
            const error = new Error('Database connection failed')

            vi.mocked(dbCompactAnalyticsSnapshots).mockRejectedValue(error)

            await expect(
                analyticsService.compactAnalyticsForPortfolio(portfolioId)
            ).rejects.toThrow('Database connection failed')
        })
    })

    describe('compactAllPortfolios', () => {
        it('should process multiple portfolios and aggregate results', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')

            vi.mocked(portfolioStorage.getAllPortfolios).mockReturnValue([
                { id: 'portfolio-1', name: 'P1', balances: {} },
                { id: 'portfolio-2', name: 'P2', balances: {} },
                { id: 'portfolio-3', name: 'P3', balances: {} },
            ] as any[])

            vi.mocked(dbCompactAnalyticsSnapshots)
                .mockResolvedValueOnce({
                    portfolioId: 'portfolio-1',
                    deletedCount: 100,
                    retainedCount: 50,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })
                .mockResolvedValueOnce({
                    portfolioId: 'portfolio-2',
                    deletedCount: 80,
                    retainedCount: 40,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })
                .mockResolvedValueOnce({
                    portfolioId: 'portfolio-3',
                    deletedCount: 60,
                    retainedCount: 30,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })

            const results = await analyticsService.compactAllPortfolios(90, 7)

            expect(results).toHaveLength(3)
            expect(results[0].portfolioId).toBe('portfolio-1')
            expect(results[1].portfolioId).toBe('portfolio-2')
            expect(results[2].portfolioId).toBe('portfolio-3')
            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledTimes(3)
        })

        it('should use default parameters when not provided', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')

            vi.mocked(portfolioStorage.getAllPortfolios).mockReturnValue([
                { id: 'portfolio-1', name: 'P1', balances: {} },
            ] as any[])

            vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                portfolioId: 'portfolio-1',
                deletedCount: 50,
                retainedCount: 30,
                compactionCutoffTimestamp: new Date().toISOString(),
            })

            await analyticsService.compactAllPortfolios()

            expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                'portfolio-1',
                90, // default cutoffDays
                7   // default recentDays
            )
        })

        it('should respect environment retention settings in compactAllPortfolios when not provided', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')
            const originalCutoff = process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS
            const originalRecent = process.env.ANALYTICS_COMPACTION_RECENT_DAYS

            try {
                process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS = '60'
                process.env.ANALYTICS_COMPACTION_RECENT_DAYS = '5'

                vi.mocked(portfolioStorage.getAllPortfolios).mockReturnValue([
                    { id: 'portfolio-env-1', name: 'P-ENV', balances: {} },
                ] as any[])

                vi.mocked(dbCompactAnalyticsSnapshots).mockResolvedValue({
                    portfolioId: 'portfolio-env-1',
                    deletedCount: 30,
                    retainedCount: 20,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })

                await analyticsService.compactAllPortfolios()

                expect(vi.mocked(dbCompactAnalyticsSnapshots)).toHaveBeenCalledWith(
                    'portfolio-env-1',
                    60,
                    5
                )
            } finally {
                if (originalCutoff === undefined) {
                    delete process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS
                } else {
                    process.env.ANALYTICS_COMPACTION_CUTOFF_DAYS = originalCutoff
                }
                if (originalRecent === undefined) {
                    delete process.env.ANALYTICS_COMPACTION_RECENT_DAYS
                } else {
                    process.env.ANALYTICS_COMPACTION_RECENT_DAYS = originalRecent
                }
            }
        })

        it('should handle empty portfolio list', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')

            vi.mocked(portfolioStorage.getAllPortfolios).mockReturnValue([])

            const results = await analyticsService.compactAllPortfolios(90, 7)

            expect(results).toHaveLength(0)
            expect(vi.mocked(dbCompactAnalyticsSnapshots)).not.toHaveBeenCalled()
        })

        it('should reject on first portfolio failure (fail-fast)', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')

            vi.mocked(portfolioStorage.getAllPortfolios).mockReturnValue([
                { id: 'portfolio-1', name: 'P1', balances: {} },
                { id: 'portfolio-2', name: 'P2', balances: {} },
            ] as any[])

            vi.mocked(dbCompactAnalyticsSnapshots)
                .mockResolvedValueOnce({
                    portfolioId: 'portfolio-1',
                    deletedCount: 100,
                    retainedCount: 50,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })
                .mockRejectedValueOnce(new Error('Database error for portfolio-2'))

            await expect(
                analyticsService.compactAllPortfolios(90, 7)
            ).rejects.toThrow('Database error for portfolio-2')
        })

        it('should aggregate statistics correctly', async () => {
            const { portfolioStorage } = await import('../services/portfolioStorage.js')

            vi.mocked(portfolioStorage.getAllPortfolios).mockReturnValue([
                { id: 'portfolio-1', name: 'P1', balances: {} },
                { id: 'portfolio-2', name: 'P2', balances: {} },
            ] as any[])

            vi.mocked(dbCompactAnalyticsSnapshots)
                .mockResolvedValueOnce({
                    portfolioId: 'portfolio-1',
                    deletedCount: 100,
                    retainedCount: 50,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })
                .mockResolvedValueOnce({
                    portfolioId: 'portfolio-2',
                    deletedCount: 80,
                    retainedCount: 40,
                    compactionCutoffTimestamp: new Date().toISOString(),
                })

            const results = await analyticsService.compactAllPortfolios(90, 7)

            const totalDeleted = results.reduce((sum: number, r: any) => sum + r.deletedCount, 0)
            const totalRetained = results.reduce((sum: number, r: any) => sum + r.retainedCount, 0)

            expect(totalDeleted).toBe(180)
            expect(totalRetained).toBe(90)
        })
    })
})
