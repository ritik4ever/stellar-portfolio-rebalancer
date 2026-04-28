import { describe, it, expect, beforeEach, vi } from 'vitest'
import { analyticsService } from '../services/analyticsService'
import { portfolioStorage } from '../services/portfolioStorage'
import { ReflectorService } from '../services/reflector'

vi.mock('../services/portfolioStorage', () => ({
    portfolioStorage: {
        getPortfolio: vi.fn(),
        getAllPortfolios: vi.fn(),
    }
}))

vi.mock('../services/reflector', () => ({
    ReflectorService: vi.fn().mockImplementation(() => ({
        getCurrentPrices: vi.fn()
    }))
}))

describe('AnalyticsService', () => {
    const portfolioId = 'test-portfolio'

    beforeEach(() => {
        vi.clearAllMocks()
        vi.useFakeTimers()
        
        // Clear internal state of analyticsService
        ;(analyticsService as any).snapshots.clear()
        ;(analyticsService as any).lastSnapshotTimes.clear()
    })

    describe('snapshot aggregation', () => {
        it('should aggregate daily intervals correctly', () => {
            const snapshots = [
                { timestamp: '2023-10-01T10:00:00Z', totalValue: 1000, portfolioId, allocations: {}, balances: {} },
                { timestamp: '2023-10-01T15:00:00Z', totalValue: 1050, portfolioId, allocations: {}, balances: {} }, // Last of day 1
                { timestamp: '2023-10-02T08:00:00Z', totalValue: 1020, portfolioId, allocations: {}, balances: {} }, // Last of day 2
                // Skip day 3
                { timestamp: '2023-10-04T12:00:00Z', totalValue: 1100, portfolioId, allocations: {}, balances: {} }  // Last of day 4
            ]
            
            ;(analyticsService as any).snapshots.set(portfolioId, snapshots)
            vi.setSystemTime(new Date('2023-10-05T00:00:00Z'))

            const result = analyticsService.getAggregatedAnalytics(portfolioId, 'daily', 30)
            
            expect(result.length).toBe(4)
            expect(result[0].timestamp).toBe('2023-10-01T00:00:00.000Z')
            expect(result[0].totalValue).toBe(1050) // Last known of day 1
            
            expect(result[1].timestamp).toBe('2023-10-02T00:00:00.000Z')
            expect(result[1].totalValue).toBe(1020) // Last known of day 2
            
            expect(result[2].timestamp).toBe('2023-10-03T00:00:00.000Z')
            expect(result[2].totalValue).toBe(1020) // Filled with last known (from day 2)
            
            expect(result[3].timestamp).toBe('2023-10-04T00:00:00.000Z')
            expect(result[3].totalValue).toBe(1100) // Last known of day 4
        })

        it('should aggregate weekly intervals correctly', () => {
            const snapshots = [
                { timestamp: '2023-10-02T10:00:00Z', totalValue: 1000, portfolioId, allocations: {}, balances: {} }, // Monday
                { timestamp: '2023-10-08T15:00:00Z', totalValue: 1100, portfolioId, allocations: {}, balances: {} }, // Sunday (end of week 1)
                { timestamp: '2023-10-16T08:00:00Z', totalValue: 1050, portfolioId, allocations: {}, balances: {} }  // Monday (start of week 3)
            ]
            
            ;(analyticsService as any).snapshots.set(portfolioId, snapshots)
            vi.setSystemTime(new Date('2023-10-20T00:00:00Z'))

            const result = analyticsService.getAggregatedAnalytics(portfolioId, 'weekly', 30)
            
            expect(result.length).toBe(3)
            expect(result[0].timestamp).toBe('2023-10-02T00:00:00.000Z')
            expect(result[0].totalValue).toBe(1100) // End of week 1
            
            expect(result[1].timestamp).toBe('2023-10-09T00:00:00.000Z')
            expect(result[1].totalValue).toBe(1100) // Gap fill from week 1
            
            expect(result[2].timestamp).toBe('2023-10-16T00:00:00.000Z')
            expect(result[2].totalValue).toBe(1050) // Week 3
        })

        it('should aggregate monthly intervals correctly', () => {
            const snapshots = [
                { timestamp: '2023-01-15T10:00:00Z', totalValue: 1000, portfolioId, allocations: {}, balances: {} },
                { timestamp: '2023-01-31T15:00:00Z', totalValue: 1100, portfolioId, allocations: {}, balances: {} }, // End of Jan
                { timestamp: '2023-03-05T08:00:00Z', totalValue: 1050, portfolioId, allocations: {}, balances: {} }  // March
            ]
            
            ;(analyticsService as any).snapshots.set(portfolioId, snapshots)
            vi.setSystemTime(new Date('2023-04-01T00:00:00Z'))

            const result = analyticsService.getAggregatedAnalytics(portfolioId, 'monthly', 100)
            
            expect(result.length).toBe(3)
            expect(result[0].timestamp).toBe('2023-01-01T00:00:00.000Z')
            expect(result[0].totalValue).toBe(1100)
            
            expect(result[1].timestamp).toBe('2023-02-01T00:00:00.000Z')
            expect(result[1].totalValue).toBe(1100) // Gap filled
            
            expect(result[2].timestamp).toBe('2023-03-01T00:00:00.000Z')
            expect(result[2].totalValue).toBe(1050)
        })

        it('should prevent negative portfolio values on gaps', () => {
            const snapshots = [
                { timestamp: '2023-10-01T10:00:00Z', totalValue: -500, portfolioId, allocations: {}, balances: {} },
                { timestamp: '2023-10-03T15:00:00Z', totalValue: -200, portfolioId, allocations: {}, balances: {} }
            ]
            
            ;(analyticsService as any).snapshots.set(portfolioId, snapshots)
            vi.setSystemTime(new Date('2023-10-05T00:00:00Z'))

            const result = analyticsService.getAggregatedAnalytics(portfolioId, 'daily', 30)
            
            expect(result[0].totalValue).toBe(0)
            expect(result[1].totalValue).toBe(0) // Day 2 filled with 0 instead of negative
            expect(result[2].totalValue).toBe(0)
        })
    })

    describe('max snapshot history limit enforcement', () => {
        it('should enforce the maximum limit of 1000 snapshots', async () => {
            vi.mocked(portfolioStorage.getPortfolio).mockReturnValue({
                id: portfolioId,
                name: 'Test',
                balances: { 'XLM': 100 }
            } as any)

            const prices = { 'XLM': { price: 1, lastUpdated: Date.now() } }

            // Add 1000 snapshots to reach the limit
            const initialSnapshots = Array.from({ length: 1000 }).map((_, i) => ({
                timestamp: new Date(Date.now() - i * 1000).toISOString(),
                totalValue: 100,
                portfolioId,
                allocations: {},
                balances: {}
            }))
            
            ;(analyticsService as any).snapshots.set(portfolioId, initialSnapshots)

            // Capture 1 more snapshot
            vi.setSystemTime(Date.now() + 600000) // pass MIN_SNAPSHOT_INTERVAL_MS
            await analyticsService.captureSnapshot(portfolioId, prices)

            const storedSnapshots = (analyticsService as any).snapshots.get(portfolioId)
            expect(storedSnapshots.length).toBe(1000)
        })
    })
})
